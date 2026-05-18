// src/db.js
// ─────────────────────────────────────────────────────────────────
//  Camada de persistência com dual-write: Firestore + localStorage.
//
//  Estratégia:
//    • localStorage é sempre escrito primeiro (instantâneo, offline-safe)
//    • Firestore é escrito/lido de forma assíncrona quando o usuário está logado
//    • Se o Firestore falhar, o app continua funcionando com localStorage
//    • "premium" é somente leitura para o frontend — nunca é escrito aqui
//
//  Estrutura Firestore:
//    users/{uid}/
//      email:       string
//      displayName: string
//      photoURL:    string
//      createdAt:   timestamp
//      lastSeenAt:  timestamp
//      premium:     boolean   ← readonly no cliente, escrito só pela Cloud Function
//      settings/
//        muted:     boolean
//        ttsEnabled:boolean
//      progress/
//        {level}:   { completed, score, knew, missed, total, updatedAt }
//
//  API pública:
//    ensureUserDoc(user)              → cria/atualiza doc do usuário
//    getUserProfile(uid)              → { premium, ... } | null
//    loadProgressFromCloud(uid)       → { [level]: {...} } | null
//    saveProgressToCloud(uid, level, data) → void (fire-and-forget)
//    saveSettingToCloud(uid, key, val)     → void (fire-and-forget)
// ─────────────────────────────────────────────────────────────────

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from './firebase.js';

// ── Helpers ───────────────────────────────────────────────────────

function isReady() {
  return !!db;
}

/** Silencia erros do Firestore — o app nunca deve crashar por falha de rede. */
async function safeRun(fn) {
  if (!isReady()) return null;
  try {
    return await fn();
  } catch (e) {
    console.warn('[PolyCards/db]', e.message);
    return null;
  }
}

// ── User document ─────────────────────────────────────────────────

/**
 * Garante que o documento users/{uid} existe.
 * Usa setDoc com merge:true — não sobrescreve campos existentes (incluindo premium).
 * Chamado logo após o login, não bloqueia a UI.
 */
export async function ensureUserDoc(user) {
  return safeRun(() =>
    setDoc(
      doc(db, 'users', user.uid),
      {
        email:       user.email,
        displayName: user.displayName,
        photoURL:    user.photoURL,
        lastSeenAt:  serverTimestamp(),
        // createdAt é setado apenas na criação, não no merge
      },
      { merge: true }
    )
  );
}

/**
 * Lê o perfil completo do usuário, incluindo o campo premium.
 * O campo premium é READONLY — o frontend nunca o escreve.
 */
export async function getUserProfile(uid) {
  return safeRun(async () => {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  });
}

/**
 * watchUserProfile — listener em tempo real no documento users/{uid}.
 *
 * Dispara o callback imediatamente com o estado atual e toda vez que
 * qualquer campo mudar (incluindo premium apos o webhook Stripe escrever).
 *
 * Retorna a funcao de cancelamento — chame-a no logout para evitar leaks.
 *
 * Uso:
 *   const unsub = watchUserProfile(uid, (data) => {
 *     if (data?.premium) activatePremium();
 *   });
 */
export function watchUserProfile(uid, callback) {
  if (!db) {
    callback(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err)  => console.warn('[PolyCards/db] watchUserProfile erro:', err.message)
  );
}

// ── Progress ──────────────────────────────────────────────────────

/**
 * Carrega todo o progresso do usuário do Firestore.
 * Retorna objeto { [level]: data } ou null se falhar.
 */
export async function loadProgressFromCloud(uid) {
  return safeRun(async () => {
    const snap = await getDocs(collection(db, 'users', uid, 'progress'));
    if (snap.empty) return null;
    const result = {};
    snap.forEach(d => { result[d.id] = d.data(); });
    return result;
  });
}

/**
 * Salva progresso de um nível no Firestore.
 * Fire-and-forget — não bloqueia a UI.
 * O localStorage já foi atualizado antes desta chamada.
 */
export function saveProgressToCloud(uid, level, data) {
  safeRun(() =>
    setDoc(
      doc(db, 'users', uid, 'progress', String(level)),
      { ...data, updatedAt: serverTimestamp() },
      { merge: true }
    )
  );
}

// ── Settings ──────────────────────────────────────────────────────

/**
 * Persiste uma configuração (muted, ttsEnabled, etc.) no Firestore.
 * Fire-and-forget.
 */
export function saveSettingToCloud(uid, key, value) {
  safeRun(() =>
    setDoc(
      doc(db, 'users', uid, 'settings', 'preferences'),
      { [key]: value, updatedAt: serverTimestamp() },
      { merge: true }
    )
  );
}
