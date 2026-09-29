// POST /api/mercadopago/preference — Crea preferencia de pago Checkout Pro.
// Body: { items: [{kind, refId, qty}], email, note?, idToken? }

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";
import { getAdminDb, verifyIdTokenSafe } from "@/server/firebase-admin";
import {
  loadMPConfig,
  validateMPConfig,
  computeOrderFromItems,
  createMPOrder,
  MPError,
} from "@/server/mercadopago";

function baseFromRequest(req) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Petición inválida." }, { status: 400 });
  }

  try {
    const config = loadMPConfig();
    validateMPConfig(config);

    // Comprador: token verificado si viene, si no invitado con email validado
    const verified = await verifyIdTokenSafe(body.idToken);
    const email = body.email?.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Email inválido." }, { status: 400 });
    }
    const buyer = {
      userId: verified?.uid || null,
      email,
      name: verified?.name || "",
    };

    const adminDb = getAdminDb();
    // Total calculado desde Firestore. Se ignoran precios del cliente.
    const computed = await computeOrderFromItems(adminDb, body.items);

    // Crear orden interna (pending, sin descontar stock)
    const order = await createMPOrder(adminDb, {
      buyer,
      computed,
      note: body.note,
      mp: config,
    });

    const base = baseFromRequest(req);
    const successUrl = process.env.MERCADOPAGO_SUCCESS_URL || `${base}/pago/resultado?reference=${order.externalReference}&status=approved`;
    const failureUrl = process.env.MERCADOPAGO_FAILURE_URL || `${base}/pago/resultado?reference=${order.externalReference}&status=rejected`;
    const pendingUrl = process.env.MERCADOPAGO_PENDING_URL || `${base}/pago/resultado?reference=${order.externalReference}&status=pending`;
    const notificationUrl = process.env.MERCADOPAGO_NOTIFICATION_URL || `${base}/api/mercadopago/webhook`;

    if (notificationUrl.includes("localhost") || notificationUrl.startsWith("http://")) {
      console.warn(`[MP] webhook URL no pública (${notificationUrl}). MP no podrá notificar; usa túnel en local.`);
    }

    // Items para la preferencia
    const mpItems = computed.items.map((it) => ({
      id: it.refId,
      title: it.name,
      quantity: it.qty,
      unit_price: it.price,
      currency_id: config.currency,
      description: `${it.kind === "combo" ? "Outfit" : "Prenda"} - ${it.name}`,
    }));

    // Crear preferencia en MP
    const mpClient = new MercadoPagoConfig({ accessToken: config.accessToken, options: { timeout: 15000 } });
    const preference = new Preference(mpClient);

    const prefData = {
      items: mpItems,
      payer: { email: buyer.email },
      external_reference: order.externalReference,
      back_urls: {
        success: successUrl,
        failure: failureUrl,
        pending: pendingUrl,
      },
      auto_return: "approved",
      binary_mode: true,
      notification_url: notificationUrl,
      expires: true,
      expiration_time_from: new Date().toISOString(),
      expiration_time_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    const preferenceResult = await preference.create({ body: prefData });

    // Log mínimo
    console.log(
      `[MP] pref ${preferenceResult.id} para orden ${order.externalReference}: ${computed.count} ítems, ${computed.total} ${config.currency}`
    );

    return NextResponse.json({
      ok: true,
      preferenceId: preferenceResult.id,
      initPoint: config.env === "sandbox" ? preferenceResult.sandbox_init_point : preferenceResult.init_point,
      reference: order.externalReference,
      total: computed.total,
      currency: config.currency,
    });
  } catch (e) {
    if (e instanceof MPError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.http });
    }
    console.error("[MP] preference error:", e);
    const notConfigured = String(e?.message || "").includes("Faltan credenciales") || String(e?.message || "").includes("Producción requiere");
    return NextResponse.json(
      {
        ok: false,
        error: notConfigured
          ? "Pagos no configurados. Completa MERCADOPAGO_ACCESS_TOKEN_TEST/PROD y PUBLIC_KEY en .env.local."
          : "No se pudo crear la preferencia. Intenta de nuevo.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Método no permitido." }, { status: 405 });
}