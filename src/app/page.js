"use client";

import { useEffect, useMemo, useState } from "react";
import {
  subscribeProducts,
  subscribeCombos,
  createSale,
  money,
} from "@/lib/shop";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SORTS = [
  { id: "new", label: "Novedades" },
  { id: "price-asc", label: "Precio: menor a mayor" },
  { id: "price-desc", label: "Precio: mayor a menor" },
  { id: "name", label: "A–Z" },
];

function badgeStock(stock) {
  if ((stock ?? 0) <= 0)
    return "border-red-200 bg-red-50 text-red-600";
  if ((stock ?? 0) <= 5)
    return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function stockLabel(stock) {
  if ((stock ?? 0) <= 0) return "AGOTADO";
  if ((stock ?? 0) <= 5) return `¡Solo ${stock}!`;
  return `${stock} disp.`;
}

export default function TiendaRopa() {
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fbError, setFbError] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("todas");
  const [size, setSize] = useState("todas");
  const [sort, setSort] = useState("new");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [section, setSection] = useState("catalogo"); // catalogo | outfits

  const [cart, setCart] = useState({}); // key `${kind}:${id}` -> qty
  const [cartOpen, setCartOpen] = useState(false);
  const [quickView, setQuickView] = useState(null); // {kind, item}
  const [quickQty, setQuickQty] = useState(1);
  const [note, setNote] = useState("");
  const [buying, setBuying] = useState(false);
  const [cartError, setCartError] = useState("");
  const [orderOk, setOrderOk] = useState(null); // {total, count}
  const [toast, setToast] = useState("");

  useEffect(() => {
    const offP = subscribeProducts(
      (list) => {
        setProducts(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setFbError(
          "No se pudo conectar a la base de datos. Revisa las Rules de Firestore."
        );
        setLoading(false);
      }
    );
    const offC = subscribeCombos(
      (list) => setCombos(list),
      (err) => console.error(err)
    );
    return () => {
      offP && offP();
      offC && offC();
    };
  }, []);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  }

  const visibleProducts = useMemo(
    () => products.filter((p) => p.active !== false),
    [products]
  );
  const visibleCombos = useMemo(
    () => combos.filter((c) => c.active !== false),
    [combos]
  );

  const categories = useMemo(() => {
    const s = new Set(visibleProducts.map((p) => p.category || "General"));
    return ["todas", ...Array.from(s)];
  }, [visibleProducts]);

  const sizesAvailable = useMemo(() => {
    const set = new Set();
    for (const p of visibleProducts) {
      const raw = p.size || p.talla || "";
      String(raw)
        .split(/[/,]/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean)
        .forEach((x) => set.add(x));
    }
    return ["todas", ...SIZES.filter((s) => set.has(s)), ...[...set].filter((s) => !SIZES.includes(s))];
  }, [visibleProducts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = visibleProducts.filter((p) => {
      if (onlyAvailable && (p.stock ?? 0) <= 0) return false;
      if (category !== "todas" && (p.category || "General") !== category)
        return false;
      if (size !== "todas") {
        const raw = String(p.size || p.talla || "").toUpperCase();
        if (!raw) return false;
        const parts = raw.split(/[/, ]/).map((x) => x.trim());
        if (!parts.includes(size)) return false;
      }
      if (!q) return true;
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.color || "").toLowerCase().includes(q)
      );
    });
    if (sort === "price-asc")
      list = [...list].sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (sort === "price-desc")
      list = [...list].sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (sort === "name")
      list = [...list].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );
    return list;
  }, [visibleProducts, search, category, size, sort, onlyAvailable]);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([key, qty]) => {
          const sep = key.indexOf(":");
          const kind = key.slice(0, sep);
          const id = key.slice(sep + 1);
          const pool = kind === "combo" ? visibleCombos : visibleProducts;
          const found = pool.find((x) => x.id === id);
          if (!found || qty <= 0) return null;
          return {
            kind,
            refId: id,
            name: found.name,
            price: Number(found.price) || 0,
            qty,
            stock: found.stock ?? 0,
            imageUrl: found.imageUrl || "",
          };
        })
        .filter(Boolean),
    [cart, visibleProducts, visibleCombos]
  );

  const total = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);

  function addToCart(kind, id, qty = 1) {
    const pool = kind === "combo" ? visibleCombos : visibleProducts;
    const found = pool.find((x) => x.id === id);
    if (!found) return;
    const stock = Number(found.stock) || 0;
    const key = `${kind}:${id}`;
    setCart((c) => {
      const next = (c[key] || 0) + qty;
      if (next > stock) {
        setCartError(`Solo quedan ${stock} de "${found.name}".`);
        return c;
      }
      setCartError("");
      return { ...c, [key]: next };
    });
    flash(`${found.name} agregado al carrito`);
  }

  function setLineQty(key, v) {
    const sep = key.indexOf(":");
    const kind = key.slice(0, sep);
    const id = key.slice(sep + 1);
    const pool = kind === "combo" ? visibleCombos : visibleProducts;
    const max = Number(pool.find((x) => x.id === id)?.stock) || 0;
    const q = Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    setCart((c) => {
      const n = { ...c };
      if (q <= 0) delete n[key];
      else n[key] = q;
      return n;
    });
  }

  async function checkout(e) {
    e?.preventDefault();
    setCartError("");
    if (lines.length === 0) return setCartError("Tu carrito está vacío.");
    setBuying(true);
    try {
      await createSale(lines, note);
      setOrderOk({ total, count });
      setCart({});
      setNote("");
      setCartOpen(false);
    } catch (err) {
      console.error(err);
      setCartError(err?.message || "No se pudo completar la compra.");
    } finally {
      setBuying(false);
    }
  }

  function openQuick(kind, item) {
    setQuickView({ kind, item });
    setQuickQty(1);
  }

  const heroProduct = visibleProducts.find((p) => (p.stock ?? 0) > 0);

  return (
    <div className="relative min-h-screen">
      <div className="texture-grid pointer-events-none fixed inset-0" />

      {/* ANUNCIO */}
      <div className="relative bg-stone-900 py-2 text-center text-[12px] font-medium tracking-wide text-stone-200">
        Envío gratis en pedidos +$999 · Devoluciones hasta 15 días · Nueva
        colección ya disponible
      </div>

      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#faf7f2]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 font-serif text-lg font-black text-amber-100">
            V
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-xl font-black tracking-tight">
              VESTA
            </h1>
            <p className="text-[11px] uppercase tracking-[0.25em] text-stone-500">
              Tienda de ropa
            </p>
          </div>
          <nav className="ml-6 hidden gap-1 md:flex">
            {[
              { id: "catalogo", label: "Catálogo" },
              { id: "outfits", label: `Outfits (${visibleCombos.length})` },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setSection(t.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  section === t.id
                    ? "bg-stone-900 text-white"
                    : "text-stone-500 hover:bg-stone-200/60 hover:text-stone-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-full border border-stone-200 bg-white px-3 py-1.5 font-mono text-[11px] text-stone-500 sm:block">
              {visibleProducts.length} prendas · {visibleCombos.length} outfits
            </span>
            <button
              onClick={() => setCartOpen(true)}
              className="btn-shop relative rounded-full px-5 py-2.5 text-sm font-bold"
            >
              Carrito
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-600 px-1.5 text-xs font-black text-white">
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>
        {/* nav móvil */}
        <nav className="mx-auto flex max-w-7xl gap-2 px-4 pb-3 md:hidden">
          {[
            { id: "catalogo", label: "Catálogo" },
            { id: "outfits", label: `Outfits (${visibleCombos.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${
                section === t.id
                  ? "bg-stone-900 text-white"
                  : "bg-white text-stone-500 border border-stone-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="relative mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        {/* HERO */}
        <section className="mt-6 grid gap-4 overflow-hidden rounded-3xl bg-stone-900 p-6 text-stone-100 sm:grid-cols-2 sm:p-10">
          <div className="flex flex-col justify-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-400">
              Nueva temporada
            </p>
            <h2 className="mt-2 font-serif text-4xl font-black leading-tight sm:text-5xl">
              Viste tu
              <br />
              mejor versión
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-stone-300">
              Prendas y outfits con inventario en vivo. Lo que ves es lo que
              hay: al comprar, el stock se descuenta automáticamente.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setSection("catalogo");
                  document
                    .getElementById("catalogo")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="btn-accent rounded-full px-6 py-3 text-sm font-bold"
              >
                Ver catálogo
              </button>
              <button
                onClick={() => {
                  setSection("outfits");
                  document
                    .getElementById("outfits")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-full border border-stone-600 px-6 py-3 text-sm font-bold text-stone-200 hover:border-amber-400 hover:text-white"
              >
                Ver outfits
              </button>
            </div>
            <div className="mt-6 flex gap-6 text-center">
              {[
                { v: `${visibleProducts.length}`, k: "prendas" },
                { v: `${visibleCombos.length}`, k: "outfits" },
                { v: money(heroProduct?.price || 0), k: "desde" },
              ].map((s) => (
                <div key={s.k}>
                  <p className="font-serif text-2xl font-black text-amber-200">
                    {s.v}
                  </p>
                  <p className="text-[11px] uppercase tracking-widest text-stone-400">
                    {s.k}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative min-h-64 overflow-hidden rounded-2xl bg-stone-800">
            {heroProduct?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroProduct.imageUrl}
                alt={heroProduct.name}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-center sm:h-full">
                <div>
                  <p className="font-serif text-6xl">◍</p>
                  <p className="mt-2 text-sm text-stone-400">
                    Agrega fotos a tus productos
                    <br />
                    desde el panel admin
                  </p>
                </div>
              </div>
            )}
            {heroProduct && (
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-2xl bg-black/60 p-3 backdrop-blur">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {heroProduct.name}
                  </p>
                  <p className="text-xs text-stone-300">
                    {heroProduct.category || "General"} ·{" "}
                    {money(heroProduct.price)}
                  </p>
                </div>
                <button
                  onClick={() => addToCart("product", heroProduct.id, 1)}
                  disabled={(heroProduct.stock ?? 0) <= 0}
                  className="btn-accent shrink-0 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40"
                >
                  Agregar
                </button>
              </div>
            )}
          </div>
        </section>

        {/* BENEFICIOS */}
        <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { t: "Stock en vivo", d: "Compra tranquila: validamos disponibilidad al pagar." },
            { t: "Outfits con ahorro", d: "Combina prendas y paga menos que por separado." },
            { t: "Misma base de datos", d: "Lee products, combos y crea orders como el admin." },
          ].map((b) => (
            <div key={b.t} className="card-shop rounded-2xl p-4">
              <p className="font-serif font-bold">{b.t}</p>
              <p className="mt-1 text-sm text-stone-500">{b.d}</p>
            </div>
          ))}
        </section>

        {fbError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-bold">Sin conexión a la base de datos</p>
            <p className="mt-1">{fbError}</p>
          </div>
        )}

        {/* ============ CATÁLOGO ============ */}
        {(section === "catalogo" || true) && (
          <section id="catalogo" className="mt-10 scroll-mt-28">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-serif text-3xl font-black">Catálogo</h3>
                <p className="text-sm text-stone-500">
                  {filtered.length} de {visibleProducts.length} prendas
                  {category !== "todas" ? ` · ${category}` : ""}
                  {size !== "todas" ? ` · talla ${size}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="input-shop rounded-full px-4 py-2 text-sm"
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* FILTROS */}
            <div className="card-shop mt-4 rounded-2xl p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar: vestido, jeans, lino, negro..."
                  className="input-shop flex-1 rounded-full px-5 py-2.5 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="input-shop rounded-full px-4 py-2.5 text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c === "todas" ? "Todas las categorías" : c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="input-shop rounded-full px-4 py-2.5 text-sm"
                  >
                    {sizesAvailable.map((s) => (
                      <option key={s} value={s}>
                        {s === "todas" ? "Todas las tallas" : `Talla ${s}`}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setOnlyAvailable(!onlyAvailable)}
                    className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                      onlyAvailable
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 bg-white text-stone-500"
                    }`}
                  >
                    {onlyAvailable ? "● Disponibles" : "○ Ver todo"}
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div
                    key={i}
                    className="h-80 animate-pulse rounded-2xl bg-stone-200/70"
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="card-shop mt-6 rounded-3xl p-12 text-center">
                <p className="font-serif text-5xl">◌</p>
                <p className="mt-3 font-serif text-xl font-bold">
                  Sin resultados
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {visibleProducts.length === 0
                    ? "Aún no hay prendas. Créalas en el panel admin (colección products)."
                    : "Prueba con otra búsqueda, talla o categoría."}
                </p>
                <button
                  onClick={() => {
                    setSearch("");
                    setCategory("todas");
                    setSize("todas");
                    setOnlyAvailable(false);
                  }}
                  className="btn-shop mx-auto mt-5 rounded-full px-6 py-2.5 text-sm font-bold"
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                {filtered.map((p) => {
                  const out = (p.stock ?? 0) <= 0;
                  const tallas = String(p.size || p.talla || "")
                    .split(/[/,]/)
                    .map((x) => x.trim())
                    .filter(Boolean);
                  return (
                    <article
                      key={p.id}
                      className="card-shop fade-up flex flex-col overflow-hidden rounded-2xl"
                    >
                      <button
                        onClick={() => openQuick("product", p)}
                        className="relative block h-60 bg-stone-100 text-left sm:h-72"
                      >
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-stone-400">
                            SIN FOTO
                          </div>
                        )}
                        <span
                          className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-bold ${badgeStock(p.stock)}`}
                        >
                          {stockLabel(p.stock)}
                        </span>
                        {p.color && (
                          <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                            {p.color}
                          </span>
                        )}
                      </button>
                      <div className="flex flex-1 flex-col p-3 sm:p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">
                          {(p.category || "General").toUpperCase()}
                        </p>
                        <button
                          onClick={() => openQuick("product", p)}
                          className="mt-0.5 truncate text-left font-serif font-bold hover:underline"
                        >
                          {p.name}
                        </button>
                        <p className="line-clamp-2 mt-1 min-h-10 text-xs text-stone-500 sm:text-sm">
                          {p.description || "Sin descripción."}
                        </p>
                        {tallas.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tallas.slice(0, 6).map((t) => (
                              <span
                                key={t}
                                className="rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] text-stone-600"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between">
                          <span className="font-serif text-lg font-black">
                            {money(p.price)}
                          </span>
                          <button
                            onClick={() => addToCart("product", p.id, 1)}
                            disabled={out}
                            className="btn-shop rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40"
                          >
                            {out ? "Agotado" : "+ Agregar"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ============ OUTFITS ============ */}
        <section id="outfits" className="mt-12 scroll-mt-28">
          <h3 className="font-serif text-3xl font-black">Outfits armados</h3>
          <p className="mt-1 text-sm text-stone-500">
            Nuestros combos (colección{" "}
            <span className="font-mono">combos</span>): varias prendas, un solo
            precio especial.
          </p>
          {visibleCombos.length === 0 ? (
            <div className="card-shop mt-4 rounded-3xl p-10 text-center">
              <p className="font-serif text-4xl">✦</p>
              <p className="mt-2 font-bold">Aún no hay outfits</p>
              <p className="mt-1 text-sm text-stone-500">
                Arma combos de 2+ prendas en el panel admin y aparecen aquí
                automáticamente.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {visibleCombos.map((c) => {
                const sum = (c.items || []).reduce((a, it) => {
                  const pr =
                    visibleProducts.find((p) => p.id === it.productId)?.price ||
                    0;
                  return a + Number(pr) * (Number(it.qty) || 1);
                }, 0);
                const ahorro = sum > (c.price || 0) ? sum - c.price : 0;
                const out = (c.stock ?? 0) <= 0;
                return (
                  <article
                    key={c.id}
                    className="card-shop fade-up overflow-hidden rounded-3xl"
                  >
                    <div className="flex gap-4 p-4">
                      <button
                        onClick={() => openQuick("combo", c)}
                        className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-stone-100"
                      >
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.imageUrl}
                            alt={c.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center font-serif text-3xl text-stone-300">
                            ✦
                          </div>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate font-serif font-bold">
                            {c.name}
                          </h4>
                          <span className="shrink-0 rounded-full bg-stone-900 px-3 py-1 font-mono text-xs font-bold text-white">
                            {money(c.price)}
                          </span>
                        </div>
                        <p className="line-clamp-2 mt-0.5 text-sm text-stone-500">
                          {c.description || "Set curado por la tienda."}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-stone-500">
                          {sum > 0 && (
                            <>
                              <s>{money(sum)}</s> ·{" "}
                              <span className="font-bold text-emerald-600">
                                ahorras {money(ahorro)}
                              </span>{" "}
                              ·{" "}
                            </>
                          )}
                          stock {c.stock ?? 0}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(c.items || []).map((it, i) => (
                            <span
                              key={i}
                              className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[11px] text-amber-800"
                            >
                              {it.qty}×{" "}
                              {visibleProducts.find(
                                (p) => p.id === it.productId
                              )?.name || "prenda"}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 p-4 pt-0">
                      <button
                        onClick={() => openQuick("combo", c)}
                        className="flex-1 rounded-full border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600 hover:border-stone-900"
                      >
                        Ver detalle
                      </button>
                      <button
                        onClick={() => addToCart("combo", c.id, 1)}
                        disabled={out}
                        className="btn-accent flex-1 rounded-full px-3 py-2 text-xs font-bold disabled:opacity-40"
                      >
                        {out ? "Agotado" : `Agregar · ${money(c.price)}`}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="mt-14 rounded-3xl bg-stone-900 p-6 text-sm text-stone-300 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="font-serif text-lg font-black text-white">VESTA</p>
              <p className="mt-1">
                Tienda conectada a Firestore [{process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "e-commerce1-b487f"}].
              </p>
            </div>
            <div>
              <p className="font-bold text-white">Estructura de datos</p>
              <p className="mt-1 font-mono text-xs leading-relaxed">
                products: name, price, stock, category, imageUrl, active
                <br />
                combos: name, price, stock, items[]
                <br />
                orders: items[], total, status
              </p>
            </div>
            <div>
              <p className="font-bold text-white">Ayuda</p>
              <p className="mt-1">
                El admin (yucaconsuero2) gestiona inventario; esta tienda solo
                lee y crea ventas.
              </p>
            </div>
          </div>
        </footer>
      </main>

      {/* QUICK VIEW */}
      {quickView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setQuickView(null)}
          />
          <div className="fade-up relative grid max-h-[92vh] w-full max-w-3xl gap-0 overflow-y-auto rounded-3xl bg-white sm:grid-cols-2">
            <div className="relative min-h-72 bg-stone-100">
              {quickView.item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={quickView.item.imageUrl}
                  alt={quickView.item.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-72 items-center justify-center text-sm text-stone-400 sm:h-full">
                  SIN FOTO
                </div>
              )}
            </div>
            <div className="flex flex-col p-6">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-700">
                    {quickView.kind === "combo"
                      ? "Outfit"
                      : quickView.item.category || "Prenda"}
                  </p>
                  <h3 className="mt-1 font-serif text-2xl font-black">
                    {quickView.item.name}
                  </h3>
                </div>
                <button
                  onClick={() => setQuickView(null)}
                  className="rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-500 hover:border-stone-900"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {quickView.item.description || "Sin descripción."}
              </p>
              {quickView.kind === "combo" ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(quickView.item.items || []).map((it, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 font-mono text-[11px]"
                    >
                      {it.qty}×{" "}
                      {visibleProducts.find((p) => p.id === it.productId)
                        ?.name || "prenda"}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-600">
                  {quickView.item.color && (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      Color: {quickView.item.color}
                    </span>
                  )}
                  {(quickView.item.size || quickView.item.talla) && (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      Tallas: {quickView.item.size || quickView.item.talla}
                    </span>
                  )}
                  <span
                    className={`rounded-full border px-3 py-1 font-bold ${badgeStock(quickView.item.stock)}`}
                  >
                    {stockLabel(quickView.item.stock)}
                  </span>
                </div>
              )}
              <p className="mt-4 font-serif text-3xl font-black">
                {money(quickView.item.price)}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => setQuickQty(Math.max(1, quickQty - 1))}
                  className="h-10 w-10 rounded-full border border-stone-200 text-lg font-bold hover:border-stone-900"
                >
                  −
                </button>
                <span className="w-12 text-center font-mono font-bold">
                  {quickQty}
                </span>
                <button
                  onClick={() =>
                    setQuickQty(
                      Math.min(Number(quickView.item.stock) || 1, quickQty + 1)
                    )
                  }
                  className="h-10 w-10 rounded-full border border-stone-200 text-lg font-bold hover:border-stone-900"
                >
                  +
                </button>
                <span className="ml-auto font-mono text-xs text-stone-500">
                  máx {quickView.item.stock ?? 0}
                </span>
              </div>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setQuickView(null)}
                  className="flex-1 rounded-full border border-stone-200 px-4 py-3 text-sm font-bold text-stone-600"
                >
                  Seguir viendo
                </button>
                <button
                  onClick={() => {
                    addToCart(quickView.kind, quickView.item.id, quickQty);
                    setQuickView(null);
                    setCartOpen(true);
                  }}
                  disabled={(quickView.item.stock ?? 0) <= 0}
                  className="btn-shop flex-1 rounded-full px-4 py-3 text-sm font-bold disabled:opacity-40"
                >
                  Agregar · {money((quickView.item.price || 0) * quickQty)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CARRITO */}
      {cartOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />
          <aside className="slide-in absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-[#faf7f2] shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 p-5">
              <div>
                <h3 className="font-serif text-xl font-black">
                  Tu carrito ({count})
                </h3>
                <p className="text-xs text-stone-500">
                  El stock se valida al pagar
                </p>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {lines.length === 0 && (
                <div className="py-16 text-center">
                  <p className="font-serif text-5xl">◍</p>
                  <p className="mt-3 font-bold">Carrito vacío</p>
                  <p className="mt-1 text-sm text-stone-500">
                    Agrega prendas u outfits para empezar.
                  </p>
                  <button
                    onClick={() => setCartOpen(false)}
                    className="btn-shop mx-auto mt-5 rounded-full px-6 py-2.5 text-sm font-bold"
                  >
                    Ver catálogo
                  </button>
                </div>
              )}
              {lines.map((l) => (
                <div
                  key={`${l.kind}:${l.refId}`}
                  className="card-shop flex gap-3 rounded-2xl p-3"
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.imageUrl}
                        alt={l.name}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {l.qty}× {l.name}
                    </p>
                    <p className="font-mono text-[11px] text-stone-500">
                      {l.kind === "combo" ? "Outfit" : "Prenda"} ·{" "}
                      {money(l.price)} c/u = {money(l.price * l.qty)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          setLineQty(`${l.kind}:${l.refId}`, l.qty - 1)
                        }
                        className="h-7 w-7 rounded-lg border border-stone-200 bg-white font-bold"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="0"
                        max={l.stock}
                        value={l.qty}
                        onChange={(e) =>
                          setLineQty(`${l.kind}:${l.refId}`, e.target.value)
                        }
                        className="input-shop w-14 rounded-lg px-1 py-1 text-center font-mono text-xs"
                      />
                      <button
                        onClick={() =>
                          setLineQty(`${l.kind}:${l.refId}`, l.qty + 1)
                        }
                        className="h-7 w-7 rounded-lg border border-stone-200 bg-white font-bold"
                      >
                        +
                      </button>
                      <button
                        onClick={() => setLineQty(`${l.kind}:${l.refId}`, 0)}
                        className="ml-auto text-xs text-red-500 hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {lines.length > 0 && (
              <form
                onSubmit={checkout}
                className="border-t border-stone-200 bg-white p-5"
              >
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Nombre + dirección / nota de entrega (opcional)"
                  className="input-shop w-full rounded-xl px-4 py-2.5 text-sm"
                />
                {cartError && (
                  <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {cartError}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-stone-500">
                    Total ({count} prendas)
                  </span>
                  <span className="font-serif text-3xl font-black">
                    {money(total)}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={buying || lines.length === 0}
                  className="btn-accent mt-3 w-full rounded-full px-4 py-3.5 text-sm font-bold"
                >
                  {buying ? "Procesando pago..." : `Pagar ${money(total)}`}
                </button>
                <p className="mt-2 text-center font-mono text-[11px] text-stone-400">
                  Crea una orden en Firestore · descuenta stock
                </p>
              </form>
            )}
          </aside>
        </div>
      )}

      {/* PEDIDO OK */}
      {orderOk && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOrderOk(null)}
          />
          <div className="fade-up relative w-full max-w-sm rounded-3xl bg-white p-8 text-center">
            <p className="font-serif text-6xl">✓</p>
            <h3 className="mt-2 font-serif text-2xl font-black">
              ¡Pedido confirmado!
            </h3>
            <p className="mt-2 text-sm text-stone-500">
              {orderOk.count} prendas · total {money(orderOk.total)}. El
              inventario ya se actualizó.
            </p>
            <button
              onClick={() => setOrderOk(null)}
              className="btn-shop mt-5 w-full rounded-full px-4 py-3 text-sm font-bold"
            >
              Seguir comprando
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
