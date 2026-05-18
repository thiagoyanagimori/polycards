// PolyCards — Main Application Logic
// words.js is loaded before this script in index.html (both type="module",
// executed in source order per spec), so WORDS is always available here.

const WORDS = window.__POLYCARDS_WORDS__;

// URL base das Cloud Functions -- preencha no .env apos o deploy.
// Ex: https://us-central1-SEU_PROJETO.cloudfunctions.net
const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL ?? '';

// Firebase auth + db — imported as side-effect-free modules.
// Both degrade gracefully if Firebase isn't configured yet.
import('./auth.js').catch(() => {});  // pre-warm module
import('./db.js').catch(() => {});

// Lazy references — set by initAuth() after the module loads
let _auth = null;  // { loginWithGoogle, logout, getCurrentUser, onUserChanged }
let _db   = null;  // { ensureUserDoc, getUserProfile, loadProgressFromCloud,
                   //   saveProgressToCloud, saveSettingToCloud }

async function loadFirebaseModules() {
  try {
    [_auth, _db] = await Promise.all([
      import('./auth.js'),
      import('./db.js'),
    ]);
  } catch {
    // Firebase not configured or network error — offline mode continues
  }
}

// ==========================================
//  CONFIGURATION
// ==========================================

const isPremiumUser = false; // Set true to unlock all levels
const FREE_LEVELS   = 6;
const TOTAL_LEVELS  = 30;
const CARDS_PER_LEVEL = 50;

// Safety valve: if a CSS transitionend never fires (e.g. user navigates
// away mid-animation), unlock interaction after this many ms.
const TRANSITION_TIMEOUT_MS = 800;

// ==========================================
//  STATE
// ==========================================

let state = {
  direction:    'fr-en',  // 'fr-en' | 'en-fr'
  currentLevel: null,
  cards:        [],
  cardIndex:    0,
  knew:         0,
  missed:       0,
  flipped:      false,
  transitioning: false,
  premium:      isPremiumUser,
  user:         null,   // Firebase User | null
  authReady:    false,  // true after onAuthStateChanged fires once
};

// ==========================================
//  TTS ENGINE (Web Speech API)
// ==========================================

// Auto-pronounce preference — persisted independently of the sound mute toggle.
let ttsEnabled = localStorage.getItem('polycards_tts') !== 'false'; // default ON

/** Returns true if the browser supports speech synthesis. */
const hasTTS = () => 'speechSynthesis' in window;

/**
 * Speak `text` in `lang` (BCP-47 tag, e.g. 'fr-FR' or 'en-US').
 * Cancels any in-progress utterance first so voices never overlap.
 * Silent no-op when TTS is disabled or unsupported.
 */
function speak(text, lang) {
  if (!ttsEnabled || !hasTTS() || isMuted) return;
  window.speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = lang;
  utt.rate   = 0.9;   // slightly slower than default for clarity
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

/** Speak the front face of the current card. */
function speakFront() {
  const card = state.cards[state.cardIndex];
  if (!card) return;
  if (state.direction === 'fr-en') {
    speak(card.french,  'fr-FR');
  } else {
    speak(card.english, 'en-US');
  }
}

/** Speak the back face of the current card. */
function speakBack() {
  const card = state.cards[state.cardIndex];
  if (!card) return;
  if (state.direction === 'fr-en') {
    speak(card.english, 'en-US');
  } else {
    speak(card.french,  'fr-FR');
  }
}

function toggleTts() {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem('polycards_tts', String(ttsEnabled));
  if (!ttsEnabled) window.speechSynthesis?.cancel();
  updateTtsBtn();
}

function updateTtsBtn() {
  const btn = document.getElementById('btn-tts');
  if (!btn) return;
  if (!hasTTS()) { btn.style.display = 'none'; return; }
  btn.textContent = ttsEnabled ? '\u{1F5E3}\uFE0F' : '\u{1F515}';
  btn.title       = ttsEnabled ? 'Disable auto-pronounce' : 'Enable auto-pronounce';
  btn.setAttribute('aria-label', btn.title);
  btn.style.opacity = ttsEnabled ? '1' : '0.45';
}

// ==========================================
//  UTILS
// ==========================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Query a required DOM element; throws a clear error if missing. */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

// ==========================================
//  FLAG HELPER
// ==========================================

const FLAG_URLS = {
  fr: 'https://flagcdn.com/w40/fr.png',
  gb: 'https://flagcdn.com/w40/gb.png',
};

function flagHTML(code, size = 'sm') {
  const alt = code === 'fr' ? 'French' : 'English';
  return `<img src="${FLAG_URLS[code]}" alt="${alt}" class="flag-${size}" />`;
}

// ==========================================
//  SOUND ENGINE (Web Audio API)
// ==========================================

let _audioCtx = null;
let isMuted = localStorage.getItem('polycards_muted') === 'true';

function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playTone({ type = 'sine', freq, freqEnd, gain = 0.12, duration, delay = 0 }) {
  if (isMuted) return;
  try {
    const ctx      = getAudioCtx();
    const osc      = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    const t = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  } catch (_) {}
}

function soundClick()  { playTone({ type: 'sine',     freq: 880, freqEnd: 660, gain: 0.1,  duration: 0.07 }); }
function soundFlip()   {
  playTone({ type: 'sine', freq: 280, freqEnd: 520, gain: 0.07, duration: 0.13 });
  playTone({ type: 'sine', freq: 520, freqEnd: 380, gain: 0.04, duration: 0.10, delay: 0.08 });
}
function soundCorrect() {
  playTone({ type: 'sine', freq: 523.25, gain: 0.11, duration: 0.16 });
  playTone({ type: 'sine', freq: 783.99, gain: 0.11, duration: 0.20, delay: 0.11 });
}
function soundWrong()  { playTone({ type: 'triangle', freq: 220, freqEnd: 140, gain: 0.09, duration: 0.18 }); }
function soundLevelComplete() {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
    playTone({ type: 'sine', freq, gain: 0.13, duration: 0.22, delay: i * 0.13 })
  );
}

function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem('polycards_muted', String(isMuted));
  if (isMuted) window.speechSynthesis?.cancel();
  updateMuteBtn();
}

function updateMuteBtn() {
  const btn = el('btn-mute');
  btn.textContent = isMuted ? '🔇' : '🔊';
  btn.title       = isMuted ? 'Unmute sounds' : 'Mute sounds';
  btn.setAttribute('aria-label', isMuted ? 'Unmute sounds' : 'Mute sounds');
}

// ==========================================
//  PROGRESS (localStorage)
// ==========================================

// ── localStorage (always) ────────────────────────────────────────

function loadProgress() {
  try { return JSON.parse(localStorage.getItem('polycards_progress') || '{}'); }
  catch { return {}; }
}

function _writeLocalProgress(level, data) {
  const progress = loadProgress();
  progress[level] = { ...progress[level], ...data };
  localStorage.setItem('polycards_progress', JSON.stringify(progress));
}

function resetProgress() {
  localStorage.removeItem('polycards_progress');
  // Cloud reset is intentionally not automatic — data is the user's property.
}

function isLevelCompleted(level) {
  return !!(loadProgress()[level]?.completed);
}

/**
 * saveProgress — dual-write strategy:
 *   1. Write localStorage immediately (no await, no block)
 *   2. Fire-and-forget to Firestore if user is logged in
 */
function saveProgress(level, data) {
  _writeLocalProgress(level, data);
  if (state.user && _db) {
    _db.saveProgressToCloud(state.user.uid, level, data);
  }
}

/**
 * syncCloudProgressToLocal — called once after login.
 * Merges cloud progress into localStorage without overwriting newer local data.
 */
async function syncCloudProgressToLocal() {
  if (!state.user || !_db) return;
  const cloud = await _db.loadProgressFromCloud(state.user.uid);
  if (!cloud) return;

  const local = loadProgress();
  let merged  = false;
  for (const [level, data] of Object.entries(cloud)) {
    if (!local[level]) {
      local[level] = data;
      merged = true;
    }
  }
  if (merged) {
    localStorage.setItem('polycards_progress', JSON.stringify(local));
    renderLevels(); // reflect newly synced levels in UI
  }
}

// ==========================================
//  WORD DATA HELPERS
// ==========================================

function getWordsForLevel(level) {
  const real = WORDS.filter(w => w.level === level);
  if (real.length >= CARDS_PER_LEVEL) return real.slice(0, CARDS_PER_LEVEL);

  const filled = [...real];
  const categories   = ['Vocabulary', 'Grammar', 'Expressions', 'Phrases'];
  const difficulties = ['easy', 'medium', 'hard'];
  while (filled.length < CARDS_PER_LEVEL) {
    const idx = filled.length;
    filled.push({
      id:         level * 100 + idx,
      french:     `[mot ${idx + 1} — niveau ${level}]`,
      english:    `[word ${idx + 1} — level ${level}]`,
      level,
      category:   categories[idx % categories.length],
      difficulty: difficulties[idx % difficulties.length],
    });
  }
  return filled;
}

// ==========================================
//  SCREEN NAVIGATION
// ==========================================

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el(id).classList.add('active');
}

// ==========================================
//  LEVELS SCREEN
// ==========================================

function goToLevels() {
  renderLevels();
  showScreen('screen-levels');
}

function renderLevels() {
  const modeBadge = el('current-mode-badge');
  modeBadge.innerHTML = state.direction === 'fr-en'
    ? `${flagHTML('fr')} French → English ${flagHTML('gb')}`
    : `${flagHTML('gb')} English → French ${flagHTML('fr')}`;

  const grid = el('levels-grid');
  grid.innerHTML = '';  // wipes old buttons and their listeners before re-render

  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const isLocked  = !state.premium && level > FREE_LEVELS;
    const completed = isLevelCompleted(level);

    const btn = document.createElement('button');
    btn.className = 'level-btn'
      + (isLocked  ? ' locked'    : '')
      + (completed ? ' completed' : '');
    btn.setAttribute('data-level', level);
    btn.setAttribute('aria-label', `Level ${level}${isLocked ? ' (Premium)' : ''}`);

    btn.innerHTML = isLocked
      ? `<span class="level-num">${level}</span><span class="lock-icon">🔒</span>`
      : `<span class="level-num">${level}</span><span class="level-sub">${completed ? '✓' : '50 cards'}</span>`;

    // Listener is created once per button per render — no accumulation risk
    // because the parent node is wiped before each render call.
    btn.addEventListener('click', () => {
      isLocked ? openPremiumModal() : startLevel(level);
    });

    grid.appendChild(btn);
  }
}

// ==========================================
//  FLASHCARD SCREEN
// ==========================================

function startLevel(level) {
  state.currentLevel  = level;
  state.cards         = shuffle(getWordsForLevel(level));
  state.cardIndex     = 0;
  state.knew          = 0;
  state.missed        = 0;
  state.flipped       = false;
  state.transitioning = false;

  el('flashcard-level-badge').textContent = `Level ${level}`;
  el('count-total').textContent           = state.cards.length;
  updateCardUI();
  resetFlip();
  updateActionRow(false);
  showScreen('screen-flashcard');
  // Defer by one frame so the browser finishes painting before TTS fires.
  requestAnimationFrame(speakFront);
}

function flipCard() {
  if (state.transitioning) return;
  soundFlip();
  state.flipped = true;
  el('card-inner').classList.add('flipped');
  updateActionRow(true);
  el('flip-hint').style.visibility = 'hidden';
  speakBack();
}

function resetFlip() {
  state.flipped = false;
  const inner = el('card-inner');
  inner.classList.remove('flipped', 'to-edge');
  el('flip-hint').style.visibility = 'visible';
}

function updateCardUI() {
  const card   = state.cards[state.cardIndex];
  if (!card) return;
  const isFrEn = state.direction === 'fr-en';

  el('front-lang').innerHTML      = isFrEn ? `${flagHTML('fr', 'md')} French`  : `${flagHTML('gb', 'md')} English`;
  el('front-word').textContent    = isFrEn ? card.french  : card.english;
  el('front-category').textContent = card.category;

  el('back-lang').innerHTML       = isFrEn ? `${flagHTML('gb', 'md')} English` : `${flagHTML('fr', 'md')} French`;
  el('back-word').textContent     = isFrEn ? card.english : card.french;
  el('back-category').textContent = card.category;

  const diffEl = el('back-difficulty');
  diffEl.textContent = card.difficulty;
  diffEl.className   = `card-difficulty-tag diff-${card.difficulty}`;

  const pct = (state.cardIndex / state.cards.length) * 100;
  el('progress-bar').style.width  = pct + '%';
  el('card-index').textContent    = `${state.cardIndex + 1} / ${state.cards.length}`;
  el('cnt-knew').textContent      = state.knew;
  el('cnt-missed').textContent    = state.missed;
  el('count-correct').textContent = state.knew;
}

function updateActionRow(visible) {
  el('action-row').classList.toggle('hidden', !visible);
}

// ==========================================
//  CARD ANSWER HANDLERS
// ==========================================

function handleKnew() {
  if (!state.flipped || state.transitioning) return;
  soundCorrect();
  state.knew++;
  nextCard();
}

function handleMissed() {
  if (!state.flipped || state.transitioning) return;
  soundWrong();
  state.missed++;
  nextCard();
}

function handleNext() {
  if (state.transitioning) return;
  nextCard();
}

// ==========================================
//  CARD TRANSITION
// ==========================================

/**
 * Attaches a one-shot transitionend listener filtered to the 'transform'
 * property. A safety timeout prevents a permanent locked state if the CSS
 * transition never completes (element hidden, display:none, etc.).
 */
function onTransformEnd(element, callback) {
  let fired = false;
  const done = () => {
    if (fired) return;
    fired = true;
    element.removeEventListener('transitionend', handler);
    clearTimeout(timer);
    callback();
  };
  function handler(e) { if (e.propertyName === 'transform') done(); }
  const timer = setTimeout(done, TRANSITION_TIMEOUT_MS);
  element.addEventListener('transitionend', handler);
}

function nextCard() {
  const nextIndex = state.cardIndex + 1;
  const inner     = el('card-inner');

  // ── Last card in level ──────────────────────────────────────────────────────
  if (nextIndex >= state.cards.length) {
    if (!state.flipped) { finishLevel(); return; }

    state.transitioning = true;
    updateActionRow(false);
    inner.classList.remove('flipped');
    inner.classList.add('to-edge');
    onTransformEnd(inner, () => {
      inner.classList.remove('to-edge');
      onTransformEnd(inner, () => {
        state.flipped       = false;
        state.transitioning = false;
        finishLevel();
      });
    });
    return;
  }

  // ── Card not flipped — instant swap ────────────────────────────────────────
  if (!state.flipped) {
    state.cardIndex = nextIndex;
    updateCardUI();
    updateActionRow(false);
    el('flip-hint').style.visibility = 'visible';
    speakFront();
    return;
  }

  // ── Card is flipped — two-phase un-flip ────────────────────────────────────
  state.transitioning = true;
  updateActionRow(false);

  // Phase 1: 180° → 90° (ease-in)
  inner.classList.remove('flipped');
  inner.classList.add('to-edge');

  onTransformEnd(inner, () => {
    // Card is now edge-on and invisible — safe to swap content
    state.flipped   = false;
    state.cardIndex = nextIndex;
    updateCardUI();
    speakFront();

    // Phase 2: 90° → 0° (ease-out)
    inner.classList.remove('to-edge');

    onTransformEnd(inner, () => {
      state.transitioning = false;
      el('flip-hint').style.visibility = 'visible';
    });
  });
}

// ==========================================
//  END SCREEN
// ==========================================

function finishLevel() {
  const total = state.cards.length;
  const pct   = Math.round((state.knew / total) * 100);

  saveProgress(state.currentLevel, {
    completed: true,
    score:     pct,
    knew:      state.knew,
    missed:    state.missed,
    total,
  });

  const RESULTS = [
    { min: 90, trophy: '🌟', title: 'Outstanding!',     message: 'Incredible performance! You really know this material.' },
    { min: 70, trophy: '🏆', title: 'Great Job!',       message: "Well done! A little more practice and you'll have it mastered." },
    { min: 50, trophy: '💪', title: 'Keep Going!',      message: 'Good effort! Try again to improve your score.' },
    { min:  0, trophy: '📚', title: 'Keep Practicing!', message: "Don't give up — retry this level to reinforce the words." },
  ];
  const { trophy, title, message } = RESULTS.find(r => pct >= r.min);

  el('end-trophy').textContent    = trophy;
  el('end-title').textContent     = title;
  el('end-score-pct').textContent = pct + '%';
  el('end-knew').textContent      = state.knew;
  el('end-missed').textContent    = state.missed;
  el('end-message').textContent   = message;

  // Animate score ring
  const circumference = 2 * Math.PI * 50;
  const ringFill = el('ring-fill');
  const svg      = ringFill.closest('svg');

  if (!svg.querySelector('defs')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#a855f7"/>
      </linearGradient>`;
    svg.appendChild(defs);
    ringFill.setAttribute('stroke', 'url(#ringGrad)');
  }

  ringFill.style.strokeDashoffset = circumference;
  setTimeout(() => { ringFill.style.strokeDashoffset = circumference - (pct / 100) * circumference; }, 100);

  const nextLevel    = state.currentLevel + 1;
  const nextLevelBtn = el('btn-next-level');
  if (nextLevel > TOTAL_LEVELS) {
    nextLevelBtn.textContent = 'All Done! 🎉';
    nextLevelBtn.disabled    = true;
  } else {
    const isNextLocked       = !state.premium && nextLevel > FREE_LEVELS;
    nextLevelBtn.textContent = isNextLocked ? `Level ${nextLevel} 🔒` : `Level ${nextLevel} →`;
    nextLevelBtn.disabled    = false;
  }

  soundLevelComplete();
  showScreen('screen-end');
}

// ==========================================
//  TOAST
// ==========================================

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = Object.assign(document.createElement('div'), {
    className:   'toast',
    textContent: message,
  });
  document.body.appendChild(toast);

  if (!document.getElementById('toast-styles')) {
    const style = Object.assign(document.createElement('style'), { id: 'toast-styles' });
    style.textContent = `
      .toast {
        position:fixed;bottom:32px;left:50%;
        transform:translateX(-50%) translateY(20px);
        background:#1e2330;color:#f0f2f8;
        border:1px solid rgba(99,102,241,0.4);border-radius:999px;
        padding:12px 24px;font-size:14px;font-weight:500;
        z-index:9999;white-space:nowrap;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);
        opacity:0;transition:opacity .3s,transform .3s;
      }
      .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
    `;
    document.head.appendChild(style);
  }

  requestAnimationFrame(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 350);
    }, 3000);
  });
}

// ==========================================
//  PREMIUM MODAL
// ==========================================

function openPremiumModal() {
  const modal = el('modal-premium');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closePremiumModal() {
  const modal = el('modal-premium');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ==========================================
//  AUTH UI
// ==========================================

/** Updates the login/logout button in the landing screen. */
function updateAuthUI() {
  const btnLogin  = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const userInfo  = document.getElementById('auth-user-info');
  if (!btnLogin) return;

  if (state.user) {
    btnLogin.style.display  = 'none';
    btnLogout.style.display = 'inline-flex';
    if (userInfo) {
      userInfo.textContent  = state.user.displayName || state.user.email;
      userInfo.style.display = 'block';
    }
  } else {
    btnLogin.style.display  = 'inline-flex';
    btnLogout.style.display = 'none';
    if (userInfo) userInfo.style.display = 'none';
  }
}

async function handleLogin() {
  if (!_auth) return showToast('Firebase não configurado ainda.');
  try {
    await _auth.loginWithGoogle();
    // onUserChanged handles the rest
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Erro ao fazer login. Tente novamente.');
    }
  }
}

async function handleLogout() {
  if (!_auth) return;
  await _auth.logout();
  // onUserChanged handles state.user = null + UI update
  showToast('Logout realizado.');
}

/**
 * initAuth — called once at startup.
 * Sets up the auth state listener that drives the whole auth flow.
 */
async function initAuth() {
  await loadFirebaseModules();
  if (!_auth) return; // Firebase not configured — offline mode

  _auth.onUserChanged(async (user) => {
    state.user      = user;
    state.authReady = true;

    if (user) {
      // 1. Create/update Firestore user doc (fire-and-forget)
      if (_db) _db.ensureUserDoc(user);

      // 2. Watch premium in real time via onSnapshot.
      //    Fires immediately with current value, then again whenever
      //    the Stripe webhook writes premium=true -- no reload needed.
      if (_db) {
        if (state._unsubProfile) state._unsubProfile();
        state._unsubProfile = _db.watchUserProfile(user.uid, (profile) => {
          const wasPremium = state.premium;
          state.premium    = profile?.premium === true;
          if (state.premium !== wasPremium) {
            renderLevels();
            if (state.premium && !wasPremium) {
              showToast('Todos os niveis liberados!');
            }
          }
        });
      }

      // 3. Merge cloud progress into localStorage
      await syncCloudProgressToLocal();
    } else {
      // Logged out -- cancel listener and reset to local-only state
      if (state._unsubProfile) { state._unsubProfile(); state._unsubProfile = null; }
      state.premium = isPremiumUser;
      renderLevels();
    }

    updateAuthUI();
  });
}

// ==========================================
//  EVENT LISTENERS  — registered once at module load
// ==========================================

// Landing
el('btn-start').addEventListener('click', () => showScreen('screen-direction'));

// Direction selector
el('back-from-direction').addEventListener('click', () => showScreen('screen-landing'));
el('dir-fr-en').addEventListener('click', () => { soundClick(); state.direction = 'fr-en'; goToLevels(); });
el('dir-en-fr').addEventListener('click', () => { soundClick(); state.direction = 'en-fr'; goToLevels(); });

// Levels
el('back-from-levels').addEventListener('click', () => showScreen('screen-direction'));
el('btn-reset-progress').addEventListener('click', () => {
  if (confirm('Reset all progress? This cannot be undone.')) { resetProgress(); renderLevels(); }
});

// Flashcard
el('back-from-flashcard').addEventListener('click', goToLevels);
el('flashcard').addEventListener('click', () => { if (!state.flipped) flipCard(); });
el('btn-knew').addEventListener('click',   handleKnew);
el('btn-missed').addEventListener('click', handleMissed);
el('btn-next').addEventListener('click',   handleNext);

// End screen
el('btn-retry').addEventListener('click',      () => startLevel(state.currentLevel));
el('btn-next-level').addEventListener('click', () => {
  const next = state.currentLevel + 1;
  if (next > TOTAL_LEVELS) return;
  (!state.premium && next > FREE_LEVELS) ? openPremiumModal() : startLevel(next);
});
el('btn-back-levels').addEventListener('click', goToLevels);

// Auth
document.getElementById('btn-login')?.addEventListener('click',  handleLogin);
document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

// Premium modal
el('modal-close').addEventListener('click',   closePremiumModal);
el('modal-premium').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePremiumModal(); });
el('btn-upgrade').addEventListener('click', async () => {
  if (!state.user) {
    closePremiumModal();
    showToast('Faca login com Google para assinar o Premium.');
    return;
  }

  window.open("https://buy.stripe.com/test_00w7sNbblgM20Jr9uc1oI00", "_blank");
  return;

  const btn = el('btn-upgrade');
  btn.disabled    = true;
  btn.textContent = 'Redirecionando...';

  try {
    const resp = await fetch(FUNCTIONS_BASE_URL + '/createCheckoutSession', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ uid: state.user.uid, email: state.user.email }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Erro ' + resp.status);
    }

    const { url } = await resp.json();
    window.location.href = url;

  } catch (err) {
    console.error('[Checkout]', err);
    showToast('Erro ao iniciar checkout: ' + err.message);
    btn.disabled    = false;
    btn.textContent = 'Upgrade to Premium';
  }
});

// Mute + TTS toggle
el('btn-mute').addEventListener('click', toggleMute);
document.getElementById('btn-tts')?.addEventListener('click', toggleTts);

// Keyboard shortcuts (flashcard screen only)
document.addEventListener('keydown', (e) => {
  const active = document.querySelector('.screen.active');
  if (!active || active.id !== 'screen-flashcard') return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!state.flipped) flipCard();
  }
  if (state.flipped && !state.transitioning) {
    if (e.key === 'ArrowLeft'  || e.key === '1') handleMissed();
    if (e.key === 'ArrowRight' || e.key === '2') handleKnew();
    if (e.key === 'ArrowDown'  || e.key === 'n') handleNext();
  }
});

// ==========================================
//  INIT
// ==========================================

updateMuteBtn();
updateTtsBtn();
showScreen('screen-landing');

// Auth is initialized asynchronously — the app is already usable
// in offline mode before this resolves.
initAuth();
