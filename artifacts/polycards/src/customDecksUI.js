// src/customDecksUI.js
// All UI logic for the My Decks feature.
// Wired into script.js via three exports: openMyDecks, onAuthChanged, initEventListeners.
// Does NOT touch state, decks, progress, Stripe, or Firebase Auth from script.js.

import * as DB from './customDecks.js';

// ── Helpers ───────────────────────────────────────────────────────

const el = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el(id)?.classList.add('active');
}

function escHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function onTransformEnd(element, callback) {
  let done = false;
  const finish = () => { if (done) return; done = true; element.removeEventListener('transitionend', handler); callback(); };
  function handler(e) { if (e.propertyName === 'transform') finish(); }
  element.addEventListener('transitionend', handler);
  setTimeout(finish, 800);
}

// ── Module-level state ────────────────────────────────────────────

let _user    = null;   // Firebase user or null
let _decks   = [];     // cached list from Firestore
let _editing = null;   // { id|null, name, cards: [{id,front,back}] }

let _study = {
  deck:          null,
  cards:         [],
  index:         0,
  knew:          0,
  missed:        0,
  flipped:       false,
  transitioning: false,
};

// Lazy-loaded auth module (same firebase instance, no duplication)
let _authMod = null;
async function getAuth() {
  if (_authMod) return _authMod;
  try { _authMod = await import('./auth.js'); } catch {}
  return _authMod;
}

// ── Public API ────────────────────────────────────────────────────

/** Called by script.js whenever auth state changes. */
export function onAuthChanged(user) {
  _user = user;
  // If user logs out while inside a My Decks screen, redirect to the gate
  const active = document.querySelector('.screen.active');
  if (!user && active && active.id.startsWith('screen-my-decks') && active.id !== 'screen-my-decks-login') {
    showScreen('screen-my-decks-login');
  }
  // If user just logged in while on the login gate, proceed to list
  if (user && active && active.id === 'screen-my-decks-login') {
    loadAndShowList();
  }
}

/** Called when user clicks "My Decks" on the landing screen. */
export async function openMyDecks() {
  if (!_user) {
    showScreen('screen-my-decks-login');
  } else {
    await loadAndShowList();
  }
}

/** Registers all DOM event listeners. Call once on app init. */
export function initEventListeners() {
  // ── Login gate ──────────────────────────────────────────────────
  el('back-from-mydecks-login')?.addEventListener('click', () => showScreen('screen-landing'));
  el('cd-btn-google-login')?.addEventListener('click', async () => {
    const auth = await getAuth();
    if (!auth) return;
    try { await auth.loginWithGoogle(); }
    catch (e) { if (e.code !== 'auth/popup-closed-by-user') alert('Sign-in failed. Please try again.'); }
  });

  // ── Deck list ───────────────────────────────────────────────────
  el('back-from-mydecks-list')?.addEventListener('click', () => showScreen('screen-landing'));
  el('cd-btn-create')?.addEventListener('click', () => openEditor(null));

  // ── Editor ──────────────────────────────────────────────────────
  el('back-from-mydecks-editor')?.addEventListener('click', () => loadAndShowList());
  el('cd-deck-name-input')?.addEventListener('input', (e) => { if (_editing) _editing.name = e.target.value; });
  el('cd-btn-add-card')?.addEventListener('click', addCard);
  el('cd-btn-save')?.addEventListener('click', handleSaveDeck);

  // ── Custom study ────────────────────────────────────────────────
  el('cs-back')?.addEventListener('click', () => loadAndShowList());
  el('cs-flashcard')?.addEventListener('click', () => { if (!_study.flipped && !_study.transitioning) flipCustomCard(); });
  el('cs-btn-knew')?.addEventListener('click',   () => csAdvance('knew'));
  el('cs-btn-missed')?.addEventListener('click', () => csAdvance('missed'));
  el('cs-btn-next')?.addEventListener('click',   () => csAdvance('skip'));

  // ── Custom end screen ───────────────────────────────────────────
  el('cs-btn-retry')?.addEventListener('click', () => _study.deck && startCustomStudy(_study.deck.id));
  el('cs-btn-back-list')?.addEventListener('click', () => loadAndShowList());
}

// ── Deck list screen ──────────────────────────────────────────────

async function loadAndShowList() {
  if (!_user) { showScreen('screen-my-decks-login'); return; }
  showScreen('screen-my-decks-list');
  el('custom-decks-grid').innerHTML = '<div class="cd-loading">Loading…</div>';
  _decks = await DB.listDecks(_user.uid);
  renderDeckList();
}

function renderDeckList() {
  const grid = el('custom-decks-grid');
  grid.innerHTML = '';

  if (!_decks.length) {
    grid.innerHTML = `
      <div class="cd-empty">
        <div class="cd-empty-icon">📚</div>
        <p class="cd-empty-text">No decks yet. Create your first one!</p>
      </div>`;
    return;
  }

  for (const deck of _decks) {
    const count = deck.cards?.length ?? 0;
    const item  = document.createElement('div');
    item.className = 'cd-deck-item';
    item.innerHTML = `
      <div class="cd-deck-meta">
        <div class="cd-deck-name">${escHtml(deck.name)}</div>
        <div class="cd-deck-count">${count} card${count !== 1 ? 's' : ''}</div>
      </div>
      <div class="cd-deck-btns">
        <button class="cd-action-btn cd-btn-study" data-id="${escHtml(deck.id)}">▶ Study</button>
        <button class="cd-action-btn cd-btn-edit"  data-id="${escHtml(deck.id)}">✎ Edit</button>
        <button class="cd-action-btn cd-btn-del"   data-id="${escHtml(deck.id)}">✕</button>
      </div>`;
    grid.appendChild(item);
  }

  grid.querySelectorAll('.cd-btn-study').forEach(b => b.addEventListener('click', () => startCustomStudy(b.dataset.id)));
  grid.querySelectorAll('.cd-btn-edit').forEach(b  => b.addEventListener('click', () => openEditor(b.dataset.id)));
  grid.querySelectorAll('.cd-btn-del').forEach(b   => b.addEventListener('click', () => confirmDelete(b.dataset.id)));
}

async function confirmDelete(deckId) {
  const deck = _decks.find(d => d.id === deckId);
  if (!deck) return;
  if (!confirm(`Delete "${deck.name}"? This cannot be undone.`)) return;
  await DB.deleteDeck(_user.uid, deckId);
  _decks = _decks.filter(d => d.id !== deckId);
  renderDeckList();
}

// ── Editor screen ─────────────────────────────────────────────────

async function openEditor(deckId) {
  if (deckId) {
    const deck = _decks.find(d => d.id === deckId) ?? await DB.getDeck(_user.uid, deckId);
    if (!deck) return;
    _editing = {
      id:    deck.id,
      name:  deck.name ?? '',
      cards: (deck.cards ?? []).map(c => ({
        id:    c.id ?? crypto.randomUUID(),
        front: c.front ?? '',
        back:  c.back  ?? '',
      })),
    };
    el('cd-editor-title').textContent = 'Edit Deck';
  } else {
    _editing = { id: null, name: '', cards: [] };
    el('cd-editor-title').textContent = 'Create Deck';
  }
  el('cd-deck-name-input').value = _editing.name;
  renderCardList();
  showScreen('screen-my-decks-editor');
}

function renderCardList() {
  const list = el('cd-cards-list');
  list.innerHTML = '';

  if (!_editing.cards.length) {
    list.innerHTML = '<p class="cd-no-cards">No cards yet — add your first card below.</p>';
    return;
  }

  _editing.cards.forEach((card, i) => {
    const row = document.createElement('div');
    row.className = 'cd-card-row';
    row.innerHTML = `
      <span class="cd-card-num">${i + 1}</span>
      <input class="cd-input" placeholder="Front" value="${escHtml(card.front)}" data-idx="${i}" data-side="front" />
      <span class="cd-card-sep">→</span>
      <input class="cd-input" placeholder="Back"  value="${escHtml(card.back)}"  data-idx="${i}" data-side="back"  />
      <button class="cd-remove-btn" data-idx="${i}" title="Remove card">✕</button>`;
    list.appendChild(row);
  });

  list.querySelectorAll('.cd-input').forEach(inp => {
    inp.addEventListener('input', () => {
      _editing.cards[+inp.dataset.idx][inp.dataset.side] = inp.value;
    });
  });

  list.querySelectorAll('.cd-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _editing.cards.splice(+btn.dataset.idx, 1);
      renderCardList();
    });
  });
}

function addCard() {
  if (!_editing) return;
  _editing.cards.push({ id: crypto.randomUUID(), front: '', back: '' });
  renderCardList();
  // Focus the new front input
  const inputs = el('cd-cards-list').querySelectorAll('.cd-input');
  inputs[inputs.length - 2]?.focus();
}

async function handleSaveDeck() {
  if (!_user || !_editing) return;
  const name = el('cd-deck-name-input').value.trim();
  if (!name) { alert('Please enter a deck name.'); el('cd-deck-name-input').focus(); return; }

  const cards = _editing.cards.filter(c => c.front.trim() || c.back.trim());

  const btn = el('cd-btn-save');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    if (_editing.id) {
      await DB.saveDeck(_user.uid, _editing.id, name, cards);
    } else {
      const ref = await DB.createDeck(_user.uid, name, cards);
      if (!ref) throw new Error('Failed to create deck.');
    }
    await loadAndShowList();
  } catch (e) {
    console.error('[customDecksUI] save error', e);
    alert('Failed to save deck. Please try again.');
    btn.disabled    = false;
    btn.textContent = 'Save Deck';
  }
}

// ── Custom study ──────────────────────────────────────────────────

async function startCustomStudy(deckId) {
  if (!_user) return;
  const deck = _decks.find(d => d.id === deckId) ?? await DB.getDeck(_user.uid, deckId);
  if (!deck) return;
  if (!deck.cards?.length) { alert('This deck has no cards. Add some cards first.'); return; }

  _study = {
    deck,
    cards:         shuffle(deck.cards),
    index:         0,
    knew:          0,
    missed:        0,
    flipped:       false,
    transitioning: false,
  };

  el('cs-deck-name').textContent = deck.name;
  updateStudyUI();
  showScreen('screen-custom-study');
}

function updateStudyUI() {
  const { cards, index, knew, missed } = _study;
  const card = cards[index];

  el('cs-front-word').textContent   = card.front;
  el('cs-back-word').textContent    = card.back;
  el('cs-count-total').textContent  = cards.length;
  el('cs-count-knew').textContent   = knew;
  el('cs-card-index').textContent   = `${index + 1} / ${cards.length}`;
  el('cs-cnt-knew').textContent     = knew;
  el('cs-cnt-missed').textContent   = missed;
  el('cs-progress-bar').style.width = `${(index / cards.length) * 100}%`;

  const inner = el('cs-card-inner');
  inner.classList.remove('flipped', 'to-edge');
  _study.flipped        = false;
  _study.transitioning  = false;

  el('cs-action-row').classList.add('hidden');
  el('cs-flip-hint').style.display = '';
}

function flipCustomCard() {
  _study.flipped = true;
  el('cs-card-inner').classList.add('flipped');
  el('cs-action-row').classList.remove('hidden');
  el('cs-flip-hint').style.display = 'none';
}

function csAdvance(result) {
  if (_study.transitioning) return;

  if (result === 'knew')   _study.knew++;
  if (result === 'missed') _study.missed++;

  if (_study.index + 1 >= _study.cards.length) {
    showCustomEnd();
    return;
  }

  _study.transitioning = true;
  const inner = el('cs-card-inner');
  inner.classList.remove('flipped');
  inner.classList.add('to-edge');

  onTransformEnd(inner, () => {
    _study.index++;
    inner.classList.remove('to-edge');
    _study.transitioning = false;
    updateStudyUI();
  });
}

function showCustomEnd() {
  const { knew, missed, cards } = _study;
  const total = cards.length;
  const pct   = total ? Math.round((knew / total) * 100) : 0;

  el('cs-end-pct').textContent    = `${pct}%`;
  el('cs-end-knew').textContent   = knew;
  el('cs-end-missed').textContent = missed;

  // Animate the ring
  const ring = el('cs-ring-fill');
  if (ring) {
    const r    = 50;
    const circ = 2 * Math.PI * r;
    ring.style.strokeDasharray  = circ;
    ring.style.strokeDashoffset = circ - (pct / 100) * circ;
  }

  showScreen('screen-custom-end');
}
