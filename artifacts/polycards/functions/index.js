// functions/index.js
// ─────────────────────────────────────────────────────────────────
//  Firebase Cloud Functions — PolyCards
//
//  Funções exportadas:
//    createCheckoutSession  — cria Checkout Session Stripe com metadata.uid
//    stripeWebhook          — valida assinatura HMAC, escreve premium=true
//
//  Secrets — configure antes do deploy:
//    firebase functions:secrets:set STRIPE_SECRET_KEY
//    firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//
//  Deploy:
//    cd functions && npm install
//    firebase deploy --only functions
// ─────────────────────────────────────────────────────────────────

const { onRequest }    = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin            = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const stripeSecretKey     = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

// ── CORS ──────────────────────────────────────────────────────────
// Em produção substitua '*' pelo domínio real do seu app.
function applyCors(req, res) {
  res.set('Access-Control-Allow-Origin',  '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── createCheckoutSession ─────────────────────────────────────────

/**
 * POST /createCheckoutSession
 * Body JSON: { uid: string, email?: string }
 *
 * Cria uma Checkout Session no Stripe com metadata.uid preenchido.
 * O webhook usa esse uid para saber em qual documento do Firestore
 * escrever premium=true apos o pagamento ser confirmado.
 *
 * Retorna: { url: string }
 * O frontend redireciona window.location.href para essa URL.
 */
exports.createCheckoutSession = onRequest(
  {
    secrets:        [stripeSecretKey],
    timeoutSeconds: 30,
    memory:         '256MiB',
  },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

    const { uid, email } = req.body ?? {};
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: '`uid` e obrigatorio.' });
    }

    const Stripe = require('stripe');
    const stripe = Stripe(stripeSecretKey.value());

    try {
      const session = await stripe.checkout.sessions.create({
        mode:                 'payment',
        payment_method_types: ['card'],
        ...(email ? { customer_email: email } : {}),

        line_items: [
          {
            price:    'price_1TYE33QpTwvt2GgJTLgVfJ8M',
            quantity: 1,
          },
        ],

        // uid DEVE estar aqui -- e o unico elo seguro entre o pagamento e o usuario
        metadata: { uid },

        // Apos pagamento o Stripe redireciona para estas URLs.
        // {CHECKOUT_SESSION_ID} e preenchido automaticamente pelo Stripe.
        success_url: 'https://SEU_DOMINIO.com/?premium=success&session_id={CHECKOUT_SESSION_ID}',
        cancel_url:  'https://SEU_DOMINIO.com/?premium=cancel',
      });

      console.log('[Checkout] Sessao criada: ' + session.id + ' para uid=' + uid);
      return res.status(200).json({ url: session.url });

    } catch (err) {
      console.error('[Checkout] Erro ao criar sessao:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ── stripeWebhook ─────────────────────────────────────────────────

/**
 * POST /stripeWebhook
 *
 * Endpoint registrado no Stripe Dashboard -> Webhooks.
 * Valida a assinatura HMAC antes de processar qualquer dado.
 *
 * Eventos tratados:
 *   checkout.session.completed      -> premium = true
 *   customer.subscription.deleted   -> premium = false
 *
 * Seguranca em camadas:
 *   1. constructEvent() rejeita payloads sem assinatura valida -- responde 400
 *   2. uid vem do metadata da sessao, nao de qualquer input do usuario
 *   3. Admin SDK bypassa as Firestore Security Rules -- unico caminho para
 *      escrever o campo premium
 */
exports.stripeWebhook = onRequest(
  {
    secrets:        [stripeSecretKey, stripeWebhookSecret],
    timeoutSeconds: 30,
    memory:         '256MiB',
    // rawBody:true e obrigatorio -- a verificacao HMAC usa o body bruto (bytes exatos).
    // Se o body for parseado/modificado antes, a assinatura nao bate.
    rawBody: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const Stripe = require('stripe');
    const stripe = Stripe(stripeSecretKey.value());
    const sig    = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      console.error('[Webhook] Falha na verificacao HMAC:', err.message);
      return res.status(400).send('Webhook Error: ' + err.message);
    }

    console.log('[Webhook] Evento recebido: ' + event.type + ' (id=' + event.id + ')');

    try {
      switch (event.type) {

        case 'checkout.session.completed': {
          const session = event.data.object;

          // So processa se o pagamento foi realmente confirmado
          if (session.payment_status !== 'paid') {
            console.log('[Webhook] Sessao ' + session.id + ' ainda nao paga, ignorando.');
            break;
          }

          const uid = session.metadata && session.metadata.uid;
          if (!uid) {
            console.error('[Webhook] checkout.session.completed sem metadata.uid -- session=' + session.id);
            break;
          }

          await db.collection('users').doc(uid).set(
            {
              premium:            true,
              stripeCustomerId:   session.customer   || null,
              stripeSessionId:    session.id,
              premiumActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          console.log('[Webhook] Premium ativado -- uid=' + uid + ', session=' + session.id);
          break;
        }

        case 'customer.subscription.deleted': {
          const sub        = event.data.object;
          const customerId = sub.customer;

          const snap = await db
            .collection('users')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (!snap.empty) {
            await snap.docs[0].ref.set(
              {
                premium:          false,
                premiumRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            console.log('[Webhook] Premium revogado -- uid=' + snap.docs[0].id);
          } else {
            console.warn('[Webhook] Nenhum usuario com stripeCustomerId=' + customerId);
          }
          break;
        }

        default:
          // Todos os outros eventos sao ignorados silenciosamente.
          // O Stripe espera 200 -- responder 4xx faria ele tentar de novo.
          break;
      }

      return res.status(200).json({ received: true });

    } catch (err) {
      console.error('[Webhook] Erro interno:', err);
      return res.status(500).send('Internal error');
    }
  }
);
