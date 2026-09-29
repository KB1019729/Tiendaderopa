"use client";

// Login con Google + rol (admin/user) + tracking, compartido con el dashboard.
// Colección `users`: doc id = uid
//   { email, name, photoURL, role, loginCount, lastLogin, createdAt, updatedAt }

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { db, auth } from "./firebase";

export { auth };
export const USERS_COL = "users";

const googleProvider = new GoogleAuthProvider();

export const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").toLowerCase());
}

function profileFromUser(fbUser, role) {
  return {
    email: fbUser.email || "",
    name: fbUser.displayName || "",
    photoURL: fbUser.photoURL || "",
    role,
    updatedAt: serverTimestamp(),
  };
}

/** Crea el perfil si no existe; si existe, refresca datos + tracking de login. */
export async function ensureUserProfile(fbUser) {
  if (!fbUser) return null;
  const ref = doc(db, USERS_COL, fbUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const role = isAdminEmail(fbUser.email) ? "admin" : "user";
    await setDoc(ref, {
      ...profileFromUser(fbUser, role),
      loginCount: 1,
      lastLogin: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    return role;
  }

  const data = snap.data();
  const role =
    isAdminEmail(fbUser.email) && data.role !== "admin" ? "admin" : data.role;
  await updateDoc(ref, {
    ...profileFromUser(fbUser, role),
    loginCount: (Number(data.loginCount) || 0) + 1,
    lastLogin: serverTimestamp(),
  });
  return role;
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(cred.user);
  return cred.user;
}

export function signOutUser() {
  return signOut(auth);
}

/** Sesión + perfil con rol. Si el doc no existe (sesión persistida), lo crea. */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let offProfile = null;
    const offAuth = onAuthStateChanged(auth, (u) => {
      offProfile && offProfile();
      offProfile = null;
      setUser(u);
      if (!u) {
        setProfile(null);
        setAuthLoading(false);
        return;
      }
      offProfile = onSnapshot(
        doc(db, USERS_COL, u.uid),
        (snap) => {
          if (!snap.exists()) {
            ensureUserProfile(u).catch((e) => {
              console.error(e);
              setAuthLoading(false);
            });
            return;
          }
          setProfile({ id: snap.id, ...snap.data() });
          setAuthLoading(false);
        },
        (err) => {
          console.error(err);
          setAuthLoading(false);
        }
      );
    });
    return () => {
      offAuth();
      offProfile && offProfile();
    };
  }, []);

  return { user, profile, authLoading };
}
