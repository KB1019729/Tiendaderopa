"use client";

// Página de resultado del pago con Mercado Pago.
// Muestra el estado de NUESTRA orden (el webhook es la fuente de verdad),
// nunca decide por los parámetros que MP devuelve en la URL.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { subscribeOrderByReference, money } from "@/lib/shop";

const STATUS_META = {
  pending: {
    title: "Pago pendiente",
    msg: "Tu pago quedó pendiente de confirmación. Esta página se actualiza sola cuando Mercado Pago nos avise.",
    style: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  paid: {
    title: "¡Pago aprobado!",
    msg: "Gracias por tu compra. Tu pedido fue confirmado y el inventario ya se actualizó.",
    style: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  rejected: {
    title: "Pago rechazado",
    msg: "El banco o Mercado Pago rechazó el pago. No se hizo ningún cargo. Puedes intentarlo de nuevo con otro método.",
    style: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
  cancelled: {
    title: "Pago cancelado",
    msg: "Cancelaste el pago en el checkout. Tu orden quedó cancelada y no se hizo ningún cargo.",
    style: "border-stone-200 bg-stone-100 text-stone-600",
    dot: "bg-stone-400",
  },
  refunded: {
    title: "Pago reembolsado",
    msg: "El pago fue reembolsado. El monto volverá a tu cuenta según los tiempos de tu banco.",
    style: "border-blue-200 bg-blue-50 text-blue-800",
    dot: "bg-blue-500",
  },
  charged_back: {
    title: "Contracargo",
    msg: "Se recibió un contracargo por este pago. Revisaremos la situación.",
    style: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
  error: {
    title: "Hubo un problema",
    msg: "Detectamos una inconsistencia en la confirmación. Revisaremos tu orden manualmente.",
    style: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
};

function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    if (!d || Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function ResultadoInner() {
  const params = useSearchParams();
  const reference =
    params.get("reference") || params.get("referenceCode") || params.get("external_reference") || params.get("extra1") || "";
  const [order, setOrder] = useState(undefined); // undefined=cargando, null=no existe

  useEffect(() => {
    if (!reference) {
      setOrder(null);
      return;
    }
    const off = subscribeOrderByReference(
      reference,
      (o) => setOrder(o),
      (err) => {
        console.error(err);
        setOrder(null);
      }
    );
    return () => off && off();
  }, [reference]);

  const meta = order ? STATUS_META[order.status] || STATUS_META.error : null;

  return (
    <div className="relative min-h-screen">
      <div className="texture-grid pointer-events-none fixed inset-0" />
      <main className="relative mx-auto max-w-xl px-4 py-10 sm:px-6">
        <Link href="/" className="font-serif text-xl font-black tracking-tight">
          VESTA
        </Link>

        <div className="card-shop mt-6 rounded-3xl p-6 sm:p-8">
          {!reference ? (
            <div className="text-center">
              <p className="font-serif text-5xl">◌</p>
              <h1 className="mt-3 font-serif text-2xl font-black">Sin referencia</h1>
              <p className="mt-2 text-sm text-stone-500">
                Llegaste aquí sin una referencia de compra.
              </p>
            </div>
          ) : order === undefined ? (
            <div className="py-10 text-center">
              <p className="animate-pulse font-serif text-2xl font-black">Buscando tu orden...</p>
              <p className="mt-2 font-mono text-xs text-stone-500">{reference}</p>
            </div>
          ) : order === null ? (
            <div className="text-center">
              <p className="font-serif text-5xl">?</p>
              <h1 className="mt-3 font-serif text-2xl font-black">Orden no encontrada</h1>
              <p className="mt-2 break-all font-mono text-xs text-stone-500">{reference}</p>
              <p className="mt-2 text-sm text-stone-500">
                Verifica la referencia o vuelve a la tienda.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${meta.dot}`} />
                <h1 className="font-serif text-3xl font-black">{meta.title}</h1>
              </div>
              <div className={`mt-4 rounded-2xl border p-4 text-sm ${meta.style}`}>
                {meta.msg}
              </div>

              <dl className="mt-6 space-y-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500">Referencia</dt>
                  <dd className="break-all text-right font-mono font-bold">{order.externalReference || order.referenceCode}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500">Estado</dt>
                  <dd className="font-mono font-bold uppercase">{order.status}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500">Total</dt>
                  <dd className="font-serif text-xl font-black">
                    {money(order.total)} {order.currency || ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500">Prendas</dt>
                  <dd className="font-bold">{order.count}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500">Fecha</dt>
                  <dd className="text-right">{formatDate(order.createdAt)}</dd>
                </div>
                {order.payment?.paymentId && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-stone-500">Pago MP</dt>
                    <dd className="break-all text-right font-mono text-xs">
                      {order.payment.paymentId}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                {(order.items || []).map((it, i) => (
                  <p key={i} className="py-1 font-mono text-xs text-stone-600">
                    {it.qty}× {it.name} — {money((it.price || 0) * (it.qty || 0))}
                  </p>
                ))}
              </div>

              {order.status === "pending" && (
                <p className="mt-3 text-center font-mono text-[11px] text-stone-400">
                  Esperando confirmación de Mercado Pago... no cierres esta página.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <Link
              href="/"
              className="btn-shop flex-1 rounded-full px-4 py-3 text-center text-sm font-bold"
            >
              Volver a la tienda
            </Link>
            {(order?.status === "rejected" || order?.status === "cancelled") && (
              <Link
                href="/"
                className="btn-accent flex-1 rounded-full px-4 py-3 text-center text-sm font-bold"
              >
                Intentar de nuevo
              </Link>
            )}
          </div>
        </div>

        <p className="mt-4 text-center font-mono text-[11px] text-stone-400">
          Pago procesado por Mercado Pago · El estado lo confirma MP, no esta página.
        </p>
      </main>
    </div>
  );
}

export default function ResultadoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="animate-pulse font-serif text-xl font-black">Cargando...</p>
        </div>
      }
    >
      <ResultadoInner />
    </Suspense>
  );
}
