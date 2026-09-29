// POST /api/mercadopago/webhook — Webhook de Mercado Pago (fuente de verdad).
// Valida x-signature (HMAC-SHA256), consulta pago en MP, actualiza orden.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { getAdminDb } from "@/server/firebase-admin";
import { loadMPConfig, validateMPConfig, processMPWebhook } from "@/server/mercadopago";

async function parsePayload(req) {
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("form-urlencoded") || ctype.includes("multipart")) {
      const form = await req.formData();
      return Object.fromEntries(
        [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""])
      );
    }
    if (ctype.includes("json")) return await req.json();
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text || ""));
  } catch {
    return {};
  }
}

export async function POST(req) {
  // Extraer headers críticos para validación
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  // Parsear payload (MP envía JSON en webhooks modernos)
  const payload = await parsePayload(req);

  try {
    const config = loadMPConfig();
    validateMPConfig(config);

    if (!config.webhookSecret) {
      console.warn("[MP] webhook sin MERCADOPAGO_WEBHOOK_SECRET configurado; validación de firma deshabilitada");
    }

    const adminDb = getAdminDb();
    const result = await processMPWebhook(payload, {
      config,
      xSignature,
      xRequestId,
      adminDb,
    });

    // Log mínimo sin datos sensibles
    console.log(
      `[MP] webhook ref=${result.externalReference} code=${result.code} status=${result.status || "-"}`
    );

    const status = result.http === 200 ? 200 : result.http;
    const text =
      result.http === 200 ? "OK" : result.http === 404 ? "NOT_FOUND" : "BAD_REQUEST";
    return new NextResponse(text, { status });
  } catch (e) {
    console.error("[MP] webhook error interno:", e);
    return new NextResponse("ERROR", { status: 500 });
  }
}

export async function GET() {
  return new NextResponse("METHOD_NOT_ALLOWED", { status: 405 });
}