// src/firebase.js
// ─────────────────────────────────────────────────────────────────
//  Inicialização do Firebase.
//  Importado por auth.js e db.js — nunca diretamente pelo script.js.
//
//  SETUP:
//    1. Copie .env.example → .env
//    2. Preencha com os valores do seu projeto Firebase
//    3. As variáveis VITE_* são injetadas pelo Vite em build time
//       e ficam visíveis no bundle — isso é normal e seguro para
//       as chaves públicas do Firebase.
// ─────────────────────────────────────────────────────────────────

import { initializeApp }        from 'firebase/app';
import { getAuth }              from 'firebase/auth';
import { getFirestore }         from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Falha em dev com mensagem clara se as variáveis não estiverem definidas
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'COLE_AQUI') {
  console.warn(
    '[PolyCards] Firebase não configurado. ' +
    'Copie .env.example → .env e preencha com suas credenciais. ' +
    'O app roda em modo offline (localStorage) enquanto isso.'
  );
}

let app, auth, db;

try {
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
} catch (e) {
  // Configuração inválida → o app roda só em modo offline
  console.warn('[PolyCards] Firebase init falhou, modo offline ativo.', e.message);
}

export { auth, db };
