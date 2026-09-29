// Mercado Pago Checkout Pro — Lógica de servidor pura (sin dependencias del proyecto).
// Docs: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/overview

import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

/** Endpoints base según entorno. */
export const MP_BASE_URLS = {
  sandbox: "https://api.mercadopago.com",
  production: "https://api.mercadopago.com",
};

/**
 * @typedef {'sandbox'|'production'} MPEnv
 */

/**
 * @typedef {Object} MPConfig
 * @property {MPEnv} env
 * @property {string} accessToken
 * @property {string} publicKey
 * @property {string} currency
 * @property {string} baseUrl
 * @property {string|null} webhookSecret
 * @property {boolean} usingDefaults
 */

/** Error con código HTTP. */
export class MPError extends Error {
  /**
   * @param {number} http
   * @param {string} code
   * @param {string} message
   */
  constructor(http, code, message) {
    super(message);
    this.http = http;
    this.code = code;
  }
}

/** Carga configuración desde variables de entorno. Falla rápido en producción. */
export function loadMPConfig() {
  const env = (process.env.MERCADOPAGO_ENV || "sandbox").toLowerCase();
  const isProd = env === "production";

  if (isProd) {
    const missing = [];
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN_PROD) missing.push("MERCADOPAGO_ACCESS_TOKEN_PROD");
    if (!process.env.MERCADOPAGO_PUBLIC_KEY_PROD) missing.push("MERCADOPAGO_PUBLIC_KEY_PROD");
    if (missing.length > 0) {
      throw new MPError(500, "missing-prod-config", `Producción requiere: ${missing.join(", ")}`);
    }
    return {
      env: "production",
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN_PROD,
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY_PROD,
      currency: process.env.MERCADOPAGO_CURRENCY || "MXN",
      baseUrl: "https://api.mercadopago.com",
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || null,
      usingDefaults: false,
    };
  }

  // Sandbox: usa credenciales de prueba si están, si no avisa
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST;
  const publicKey = process.env.MERCADOPAGO_PUBLIC_KEY_TEST;
  return {
    env: "sandbox",
    accessToken: accessToken || "",
    publicKey: publicKey || "",
    currency: process.env.MERCADOPAGO_CURRENCY || "MXN",
    baseUrl: "https://api.mercadopago.com",
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || null,
    usingDefaults: !accessToken || !publicKey,
  };
}

/** Valida que la config sea usable (lanza si faltan credenciales). */
export function validateMPConfig(config) {
  if (!config.accessToken || !config.publicKey) {
    throw new MPError(500, "missing-credentials", "Faltan credenciales Mercado Pago (Access Token / Public Key)");
  }
  if (config.env === "production" && config.usingDefaults) {
    throw new MPError(500, "prod-requires-own-credentials", "En producción debe configurar sus propias credenciales PROD");
  }
}

/** Genera referencia única para la preferencia. */
export function generateMPReference() {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `VESTA-${time}-${rand}`;
}

/** Convierte monto a centavos (entero). */
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** Formato de monto para MP (2 decimales, string). */
export function formatMPAmount(cents) {
  return (cents / 100).toFixed(2);
}

/** Mapea estado de MP a estado interno. */
export function mapMPStatus(mpStatus) {
  switch (mpStatus) {
    case "approved":
      return "paid";
    case "rejected":
      return "rejected";
    case "pending":
    case "in_process":
      return "pending";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    default:
      return "error";
  }
}

/** Estados finales (no revierten). */
export const FINAL_MP_STATUSES = new Set(["paid", "rejected", "cancelled", "refunded", "charged_back"]);

/** Genera firma HMAC-SHA256 para validar webhook (x-signature). */
export function buildWebhookSignature(secret, manifest) {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

/** Construye el manifest para validar x-signature.
 *  Formato: `id:{data.id};request-id:{x-request-id};ts:{ts};`
 *  Si falta algún valor, se omite del manifest.
 */
export function buildWebhookManifest({ dataId, requestId, ts }) {
  const parts = [];
  if (dataId) parts.push(`id:${String(dataId).toLowerCase()}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  if (ts) parts.push(`ts:${ts}`);
  return parts.join(";") + ";";
}

/** Valida firma de webhook (timing-safe). */
export function validateWebhookSignature(secret, receivedSignature, manifest) {
  if (!secret || !receivedSignature) return false;
  const expected = buildWebhookSignature(secret, manifest);
  // x-signature viene como: ts=123,v1=abc123... → extraer v1
  const match = receivedSignature.match(/v1=([a-f0-9]+)/i);
  if (!match) return false;
  const received = match[1].toLowerCase();
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/** Extrae parámetros del header x-signature. */
export function parseXSignature(header) {
  const result = { ts: undefined, v1: undefined };
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "ts") result.ts = v;
    else if (k === "v1") result.v1 = v;
  }
  return result;
}

/** Extrae data.id de query params (viene como data.id=xxx). */
export function extractDataIdFromQuery(query) {
  return query["data.id"] || query["id"];
}

/**
 * @typedef {Object} MPPreferenceItem
 * @property {string} id
 * @property {string} title
 * @property {number} quantity
 * @property {number} unit_price
 * @property {string} currency_id
 * @property {string} [description]
 * @property {string} [picture_url]
 * @property {string} [category_id]
 */

/**
 * @typedef {Object} MPPreferenceData
 * @property {MPPreferenceItem[]} items
 * @property {string} payer_email
 * @property {string} external_reference
 * @property {Object} back_urls
 * @property {string} back_urls.success
 * @property {string} back_urls.failure
 * @property {string} back_urls.pending
 * @property {string} [notification_url]
 * @property {boolean} [expires]
 * @property {string} [expiration_time_from]
 * @property {string} [expiration_time_to]
 * @property {'approved'|'all'} [auto_return]
 * @property {boolean} [binary_mode]
 */

/**
 * @typedef {Object} MPPreferenceResponse
 * @property {string} id
 * @property {string} init_point
 * @property {string} sandbox_init_point
 */

/**
 * @typedef {Object} MPPayment
 * @property {number|string} id
 * @property {string} status
 * @property {string} status_detail
 * @property {string} external_reference
 * @property {number} transaction_amount
 * @property {string} currency_id
 * @property {Object} payer
 * @property {string} payer.email
 * @property {Object} [payer.identification]
 * @property {string} payment_method_id
 * @property {string} payment_type_id
 * @property {string} date_created
 * @property {string} [date_approved]
 * @property {string} date_last_updated
 * @property {number} installments
 * @property {Array} [fee_details]
 * @property {Object} [metadata]
 */

const PRODUCTS_COL = "products";
const COMBOS_COL = "combos";
const ORDERS_COL = "orders";

/** Calcula la orden desde datos confiables (Firestore vía Admin SDK). */
export async function computeOrderFromItems(adminDb, rawItems) {
  const lines = rawItems
    .filter((i) => i && i.refId && Number(i.qty) > 0)
    .map((i) => ({
      kind: i.kind === "combo" ? "combo" : "product",
      refId: String(i.refId).trim().slice(0, 128),
      qty: Math.floor(Number(i.qty)),
    }));

  if (lines.length === 0 || lines.length > 50) {
    throw new Error("Carrito vacío o inválido.");
  }

  const items = [];
  let totalCents = 0;
  let count = 0;

  for (const line of lines) {
    const col = line.kind === "combo" ? COMBOS_COL : PRODUCTS_COL;
    const snap = await adminDb.collection(col).doc(line.refId).get();
    if (!snap.exists) {
      throw new Error("Un producto ya no está disponible.");
    }
    const p = snap.data() || {};
    if (p.active === false) {
      throw new Error("Un producto ya no está disponible.");
    }
    const price = Number(p.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("No se pudo calcular el total.");
    }
    const stock = Number(p.stock) || 0;
    if (stock < line.qty) {
      throw new Error(`Stock insuficiente: ${p.name || "producto"} (quedan ${stock}).`);
    }
    const priceCents = Math.round(price * 100);
    items.push({
      kind: line.kind,
      refId: line.refId,
      name: String(p.name || "Ítem").slice(0, 160),
      price: priceCents / 100,
      qty: line.qty,
    });
    totalCents += priceCents * line.qty;
    count += line.qty;
  }

  if (totalCents <= 0) {
    throw new Error("El total de la compra es inválido.");
  }
  return { items, totalCents, total: totalCents / 100, count };
}

/** Crea la orden interna en estado pending (SIN descontar stock). */
export async function createMPOrder(adminDb, { buyer, computed, note, mp }) {
  const externalReference = generateMPReference();

  const now = new Date();
  const doc = {
    kind: "mercadopago",
    externalReference,
    description: `Compra VESTA ${externalReference}`,
    items: computed.items,
    total: computed.total,
    totalCents: computed.totalCents,
    currency: mp.currency,
    count: computed.count,
    note: String(note || "").trim().slice(0, 500),
    buyerEmail: buyer.email,
    userId: buyer.userId || null,
    userEmail: buyer.email,
    userName: buyer.name || "",
    status: "pending",
    stockDiscounted: false,
    stockShortage: false,
    payment: {
      provider: "mercadopago",
      environment: mp.env,
      preferenceId: "",
      paymentId: "",
      mpStatus: "",
      statusDetail: "",
      lastUpdate: now.toISOString(),
    },
    paymentHistory: [
      { at: now.toISOString(), state: "pending", source: "checkout" },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const ref = await adminDb.collection(ORDERS_COL).add(doc);
  return { id: ref.id, externalReference, ...doc };
}

/**
 * @typedef {Object} MPWebhookPayload
 * @property {string} [type]
 * @property {string} [action]
 * @property {Object} [data]
 * @property {string|number} [data.id]
 */

/**
 * @typedef {Object} MPWebhookContext
 * @property {Object} config
 * @property {string|null} xSignature
 * @property {string|null} xRequestId
 * @property {Object} adminDb
 */

/**
 * @typedef {Object} MPWebhookResult
 * @property {number} http
 * @property {string} code
 * @property {string|null} externalReference
 * @property {string|null} status
 * @property {boolean} [deduped]
 */

/** Procesa webhook de MP: valida firma, consulta pago, actualiza orden de forma idempotente. */
export async function processMPWebhook(rawPayload, ctx) {
  const { config, xSignature, xRequestId, adminDb } = ctx;

  // Extraer data.id del payload (puede venir en data.id o data.id query)
  const dataId = extractDataIdFromQuery(rawPayload) || rawPayload.data?.id;
  if (!dataId) {
    return { http: 400, code: "missing-data-id", externalReference: null, status: null };
  }

  // Validar firma si hay secret configurado
  if (config.webhookSecret && xSignature) {
    const parsed = parseXSignature(xSignature);
    const manifest = buildWebhookManifest({
      dataId: String(dataId).toLowerCase(),
      requestId: xRequestId || undefined,
      ts: parsed.ts,
    });
    if (!validateWebhookSignature(config.webhookSecret, xSignature, manifest)) {
      return { http: 400, code: "bad-signature", externalReference: null, status: null };
    }
  }

  // Consultar pago en MP (fuente de verdad)
  const mpClient = new MercadoPagoConfig({ accessToken: config.accessToken, options: { timeout: 15000 } });
  const paymentClient = new Payment(mpClient);

  let payment;
  try {
    payment = await paymentClient.get({ id: String(dataId) });
  } catch (e) {
    console.error("[MP] error consultando pago:", e);
    return { http: 500, code: "mp-fetch-failed", externalReference: null, status: null };
  }

  if (!payment || !payment.external_reference) {
    return { http: 404, code: "no-external-reference", externalReference: null, status: null };
  }

  const externalReference = payment.external_reference;

  // Buscar orden interna
  const q = await adminDb.collection(ORDERS_COL).where("externalReference", "==", externalReference).limit(1).get();
  if (q.empty) {
    return { http: 404, code: "unknown-order", externalReference: null, status: null };
  }

  const orderDoc = q.docs[0];
  const order = { id: orderDoc.id, ...orderDoc.data() };

  // Mapear estado
  const mappedStatus = mapMPStatus(payment.status);
  const mpStatus = payment.status;
  const statusDetail = payment.status_detail || "";

  // Idempotencia: si ya está en estado final igual, ignorar
  const current = order.status;
  const lastHist = (order.paymentHistory || []).slice(-1)[0];
  const sameEvent =
    lastHist &&
    lastHist.paymentId === String(payment.id) &&
    lastHist.mpStatus === mpStatus;

  if (FINAL_MP_STATUSES.has(current)) {
    if (current === mappedStatus) return { http: 200, code: "duplicate-ignored", externalReference, status: current, deduped: true };
    return { http: 200, code: "final-kept", externalReference, status: current };
  }
  if (current === mappedStatus && sameEvent) return { http: 200, code: "duplicate-ignored", externalReference, status: current, deduped: true };

  // Validar monto y moneda
  const orderCents = Math.round(Number(order.totalCents ?? order.total * 100));
  const paymentCents = Math.round(payment.transaction_amount * 100);
  if (!Number.isFinite(orderCents) || orderCents !== paymentCents) {
    await adminDb.collection(ORDERS_COL).doc(order.id).update({
      status: "error",
      "payment.mpStatus": mpStatus,
      "payment.statusDetail": statusDetail,
      "payment.paymentId": String(payment.id),
      paymentHistory: FieldValue.arrayUnion({
        at: new Date().toISOString(),
        state: "error",
        source: "webhook",
        mpStatus,
        statusDetail,
        paymentId: String(payment.id),
        reason: "amount-mismatch",
      }),
      updatedAt: new Date(),
    });
    return { http: 200, code: "amount-mismatch", externalReference, status: "error" };
  }
  if (String(order.currency || "").toUpperCase() !== String(payment.currency_id || "").toUpperCase()) {
    await adminDb.collection(ORDERS_COL).doc(order.id).update({
      status: "error",
      paymentHistory: FieldValue.arrayUnion({
        at: new Date().toISOString(),
        state: "error",
        source: "webhook",
        mpStatus,
        reason: "currency-mismatch",
      }),
      updatedAt: new Date(),
    });
    return { http: 200, code: "currency-mismatch", externalReference, status: "error" };
  }

  // Aplicar actualización en transacción (para descuento de stock)
  const result = await adminDb.runTransaction(async (tx) => {
    const currentOrderSnap = await tx.get(adminDb.collection(ORDERS_COL).doc(order.id));
    if (!currentOrderSnap.exists) return { type: "not-found" };

    const currentOrder = currentOrderSnap.data();
    const currentStatus = currentOrder.status;

    // Re-verificar idempotencia dentro de la transacción
    if (FINAL_MP_STATUSES.has(currentStatus)) {
      return { type: currentStatus === mappedStatus ? "dedupe" : "conflict", status: currentStatus };
    }

    const historyEntry = {
      at: new Date().toISOString(),
      state: mappedStatus,
      source: "webhook",
      mpStatus,
      statusDetail,
      paymentId: String(payment.id),
    };

    const update = {
      status: mappedStatus,
      "payment.mpStatus": mpStatus,
      "payment.statusDetail": statusDetail,
      "payment.paymentId": String(payment.id),
      paymentHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: new Date(),
    };

    // Descuento de stock solo al entrar a paid (y no descontado antes)
    let shortage = false;
    if (mappedStatus === "paid" && !currentOrder.stockDiscounted) {
      const items = currentOrder.items || [];
      const productSnaps = new Map();
      const comboSnaps = new Map();

      // Leer snapshots necesarios
      for (const item of items) {
        if (item.kind === "combo") {
          if (!comboSnaps.has(item.refId)) {
            const s = await tx.get(adminDb.collection(COMBOS_COL).doc(item.refId));
            comboSnaps.set(item.refId, s.exists ? s.data() : null);
          }
          const combo = comboSnaps.get(item.refId);
          for (const comp of (combo && combo.items) || []) {
            if (!productSnaps.has(comp.productId)) {
              const s = await tx.get(adminDb.collection(PRODUCTS_COL).doc(comp.productId));
              productSnaps.set(comp.productId, s.exists ? { id: s.id, ...s.data() } : null);
            }
          }
        } else if (!productSnaps.has(item.refId)) {
          const s = await tx.get(adminDb.collection(PRODUCTS_COL).doc(item.refId));
          productSnaps.set(item.refId, s.exists ? { id: s.id, ...s.data() } : null);
        }
      }

      const decProducts = new Map();
      const decCombos = new Map();

      for (const item of items) {
        if (item.kind === "combo") {
          decCombos.set(item.refId, (decCombos.get(item.refId) || 0) + item.qty);
          const combo = comboSnaps.get(item.refId);
          for (const comp of (combo && combo.items) || []) {
            decProducts.set(
              comp.productId,
              (decProducts.get(comp.productId) || 0) + (Number(comp.qty) || 1) * item.qty
            );
          }
        } else {
          decProducts.set(item.refId, (decProducts.get(item.refId) || 0) + item.qty);
        }
      }

      for (const [pid, need] of decProducts) {
        const p = productSnaps.get(pid);
        if (!p) {
          shortage = true;
          continue;
        }
        const stock = Number(p.stock) || 0;
        if (stock < need) shortage = true;
        tx.update(adminDb.collection(PRODUCTS_COL).doc(p.id), {
          stock: Math.max(0, stock - need),
          updatedAt: new Date(),
        });
      }
      for (const [cid, need] of decCombos) {
        const c = comboSnaps.get(cid);
        if (!c) continue;
        const stock = Number(c.stock) || 0;
        tx.update(adminDb.collection(COMBOS_COL).doc(cid), {
          stock: Math.max(0, stock - need),
          updatedAt: new Date(),
        });
      }

      update.stockDiscounted = true;
      update.stockShortage = shortage;
    }

    tx.update(adminDb.collection(ORDERS_COL).doc(order.id), update);
    return { type: "updated", status: mappedStatus, shortage };
  });

  return {
    http: 200,
    code: result.type === "dedupe" ? "duplicate-ignored" : result.type === "conflict" ? "final-kept" : "updated",
    externalReference,
    status: result.status,
    deduped: result.type === "dedupe",
  };
}