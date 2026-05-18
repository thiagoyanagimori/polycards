// src/auth.js
// ─────────────────────────────────────────────────────────────────
//  Autenticação com Google via Firebase Auth.
//
//  API pública:
//    getCurrentUser()          → User | null (síncrono, do cache)
//    onUserChanged(callback)   → unsubscribe fn — chame no init do app
//    loginWithGoogle()         → Promise<User>
//    logout()                  → Promise<void>
// ─────────────────────────────────────────────────────────────────

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';

import { auth } from './firebase.js';

// Sessão persistida no localStorage do browser — sobrevive a reloads e
// fechamento de aba. O Firebase revalida silenciosamente com o servidor.
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

const provider = auth ? new GoogleAuthProvider() : null;

/** Retorna o usuário atual de forma síncrona (pode ser null antes do listener disparar). */
export function getCurrentUser() {
  return auth?.currentUser ?? null;
}

/**
 * Registra um callback para mudanças de estado de autenticação.
 * Dispara imediatamente com o estado atual (null se não logado).
 * Retorna a função de cancelamento do listener.
 */
export function onUserChanged(callback) {
  if (!auth) {
    // Firebase não configurado — chama callback com null imediatamente
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

/**
 * Abre popup de login com Google.
 * Retorna o User do Firebase ou lança um erro.
 */
export async function loginWithGoogle() {
  if (!auth || !provider) throw new Error('Firebase não configurado.');
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

/** Faz logout e limpa a sessão local. */
export async function logout() {
  if (!auth) return;
  await signOut(auth);
}
