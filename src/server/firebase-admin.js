// Firebase Admin SDK (SOLO servidor: Route Handlers y scripts).
// Permite lecturas/escrituras privilegiadas y verificar ID tokens,
// sin depender de las Rules del cliente. NUNCA importar desde componentes.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let db = null;
let adminAuth = null;

export function adminConfigStatus() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const missing = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");
  return { ok: missing.length === 0, missing, projectId, clientEmail, privateKey };
}

function init() {
  if (db && adminAuth) return;
  const st = adminConfigStatus();
  if (!st.ok) {
    throw new Error(
      `Firebase Admin no configurado. Faltan: ${st.missing.join(", ")} (solo servidor, en .env.local).`
    );
  }
  const existing = getApps();
  const app =
    existing.length > 0
      ? existing[0]
      : initializeApp({
          credential: cert({
            projectId: st.projectId,
            clientEmail: st.clientEmail,
            privateKey: st.privateKey,
          }),
          projectId: st.projectId,
        });
  db = getFirestore(app);
  adminAuth = getAuth(app);
}

export function getAdminDb() {
  init();
  return db;
}

export function getAdminAuth() {
  init();
  return adminAuth;
}

/**
 * Verifica un Firebase ID Token. Devuelve { uid, email, name } o null si inválido.
 * Nunca lanza: un token malo solo significa "invitado".
 */
export async function verifyIdTokenSafe(token) {
  try {
    if (!token || typeof token !== "string" || token.length > 5000) return null;
    const decoded = await getAdminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email || "",
      name: decoded.name || "",
    };
  } catch {
    return null;
  }
}
