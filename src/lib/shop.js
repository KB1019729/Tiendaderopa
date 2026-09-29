import {
  collection,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  limit,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// Misma estructura de datos que yucaconsuero2:
// products: { name, description, price, stock, category, imageUrl, storagePath, active, size?, color?, createdAt, updatedAt }
// combos (aquí = outfits/sets): { name, description, price, stock, imageUrl, storagePath, active, items: [{productId, qty}], createdAt, updatedAt }
// orders: { items: [{kind:'product'|'combo', refId, name, price, qty, components?}], total, count, note, status, userId?, userEmail?, userName?, createdAt }
// carts: doc id = uid → { items: { "kind:id": qty }, updatedAt }
// users: doc id = uid → { email, name, photoURL, role: 'admin'|'user', loginCount, lastLogin, ... }

export const PRODUCTS_COL = "products";
export const COMBOS_COL = "combos";
export const ORDERS_COL = "orders";
export const CARTS_COL = "carts";

export function subscribeProducts(cb, onError) {
  const q = query(collection(db, PRODUCTS_COL), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export function subscribeCombos(cb, onError) {
  const q = query(collection(db, COMBOS_COL), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// ---------- Carrito por usuario (loguado) ----------
// Invitados usan localStorage; logueados persisten en `carts/{uid}`.
export async function getCart(uid) {
  if (!uid) return {};
  const snap = await getDoc(doc(db, CARTS_COL, uid));
  const items = snap.exists() ? snap.data().items : null;
  return items && typeof items === "object" ? items : {};
}

export async function saveCart(uid, items) {
  if (!uid) return;
  await setDoc(
    doc(db, CARTS_COL, uid),
    { items: items || {}, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function clearCart(uid) {
  if (!uid) return;
  await setDoc(
    doc(db, CARTS_COL, uid),
    { items: {}, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Misma transacción atómica de yucaconsuero2: descuenta stock y crea la orden.
// meta: { userId, userEmail, userName } para tracking de quién compró.
export async function createSale(cart, note = "", meta = {}) {
  const clean = (cart || [])
    .filter((i) => i && i.refId && Number(i.qty) > 0)
    .map((i) => ({
      kind: i.kind === "combo" ? "combo" : "product",
      refId: i.refId,
      name: i.name || "Ítem",
      price: Number(i.price) || 0,
      qty: Math.floor(Number(i.qty)),
    }));
  if (clean.length === 0) throw new Error("Carrito vacío.");

  const total = clean.reduce((a, i) => a + i.price * i.qty, 0);
  const count = clean.reduce((a, i) => a + i.qty, 0);

  await runTransaction(db, async (tx) => {
    const productIds = [
      ...new Set(clean.filter((i) => i.kind === "product").map((i) => i.refId)),
    ];
    const comboIds = [
      ...new Set(clean.filter((i) => i.kind === "combo").map((i) => i.refId)),
    ];

    const productSnaps = new Map();
    for (const pid of productIds) {
      const s = await tx.get(doc(db, PRODUCTS_COL, pid));
      if (!s.exists()) throw new Error("Una prenda ya no está disponible.");
      productSnaps.set(pid, s.data());
    }
    const comboSnaps = new Map();
    for (const cid of comboIds) {
      const s = await tx.get(doc(db, COMBOS_COL, cid));
      if (!s.exists()) throw new Error("Un outfit ya no está disponible.");
      comboSnaps.set(cid, s.data());
    }

    const required = new Map();
    const comboRequired = new Map();
    for (const item of clean) {
      if (item.kind === "product") {
        required.set(item.refId, (required.get(item.refId) || 0) + item.qty);
      } else {
        comboRequired.set(item.refId, (comboRequired.get(item.refId) || 0) + item.qty);
        const combo = comboSnaps.get(item.refId);
        for (const comp of combo.items || []) {
          required.set(
            comp.productId,
            (required.get(comp.productId) || 0) + (Number(comp.qty) || 1) * item.qty
          );
        }
      }
    }

    for (const [pid, need] of required) {
      const p = productSnaps.get(pid);
      let stock;
      if (p) stock = Number(p.stock) || 0;
      else {
        const s = await tx.get(doc(db, PRODUCTS_COL, pid));
        if (!s.exists()) throw new Error("Una prenda del outfit ya no existe.");
        productSnaps.set(pid, s.data());
        stock = Number(s.data().stock) || 0;
      }
      if (stock < need) {
        throw new Error(
          `Stock insuficiente: ${p?.name || "prenda"} (quedan ${stock}, pides ${need}).`
        );
      }
    }
    for (const [cid, need] of comboRequired) {
      const c = comboSnaps.get(cid);
      if ((Number(c?.stock) || 0) < need)
        throw new Error(`Stock insuficiente del outfit "${c?.name}".`);
    }

    for (const [pid, need] of required) {
      tx.update(doc(db, PRODUCTS_COL, pid), {
        stock: (Number(productSnaps.get(pid)?.stock) || 0) - need,
        updatedAt: serverTimestamp(),
      });
    }
    for (const [cid, need] of comboRequired) {
      tx.update(doc(db, COMBOS_COL, cid), {
        stock: (Number(comboSnaps.get(cid)?.stock) || 0) - need,
        updatedAt: serverTimestamp(),
      });
    }

    const orderRef = doc(collection(db, ORDERS_COL));
    tx.set(orderRef, {
      items: clean.map((i) =>
        i.kind === "combo"
          ? { ...i, components: comboSnaps.get(i.refId)?.items || [] }
          : i
      ),
      total,
      count,
      note: (note || "").trim(),
      status: "completed",
      userId: meta.userId || null,
      userEmail: meta.userEmail || "",
      userName: meta.userName || "",
      createdAt: serverTimestamp(),
    });
  });
}

export function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** Escucha en vivo una orden PayU por su referencia (página de resultado). */
export function subscribeOrderByReference(reference, cb, onError) {
  const ref = String(reference || "").trim();
  if (!ref) {
    cb(null);
    return () => {};
  }
  const q = query(
    collection(db, ORDERS_COL),
    where("referenceCode", "==", ref),
    limit(1)
  );
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) cb(null);
      else {
        const d = snap.docs[0];
        cb({ id: d.id, ...d.data() });
      }
    },
    onError
  );
}
