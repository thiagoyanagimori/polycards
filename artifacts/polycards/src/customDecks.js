// src/customDecks.js
// Firestore CRUD for user-created custom decks.
// Collection path: users/{uid}/customDecks/{deckId}
// Isolated from the official decks system — no shared state.

import { db } from './firebase.js';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';

function decksCol(uid) {
  return collection(db, 'users', uid, 'customDecks');
}

async function safeRun(fn) {
  if (!db) return null;
  try {
    return await fn();
  } catch (e) {
    console.warn('[customDecks]', e.message);
    return null;
  }
}

/** Returns array of decks ordered by most recently updated, or [] on error. */
export async function listDecks(uid) {
  const result = await safeRun(async () => {
    const snap = await getDocs(query(decksCol(uid), orderBy('updatedAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
  return result ?? [];
}

/** Returns a single deck or null. */
export async function getDeck(uid, deckId) {
  return safeRun(async () => {
    const snap = await getDoc(doc(db, 'users', uid, 'customDecks', deckId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  });
}

/** Creates a new deck. Returns the DocumentReference or null. */
export async function createDeck(uid, name, cards = []) {
  return safeRun(() =>
    addDoc(decksCol(uid), {
      name,
      cards,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

/** Overwrites name + cards on an existing deck. */
export async function saveDeck(uid, deckId, name, cards) {
  return safeRun(() =>
    setDoc(
      doc(db, 'users', uid, 'customDecks', deckId),
      { name, cards, updatedAt: serverTimestamp() },
      { merge: true }
    )
  );
}

/** Permanently deletes a deck document. */
export async function deleteDeck(uid, deckId) {
  return safeRun(() =>
    deleteDoc(doc(db, 'users', uid, 'customDecks', deckId))
  );
}
