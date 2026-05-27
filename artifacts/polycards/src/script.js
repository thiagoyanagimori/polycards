// PolyCards — Main Application Logic

import { LANGUAGES } from './data/languages.js';

// URL base das Cloud Functions -- preencha no .env apos o deploy.
const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL ?? '';

// Firebase auth + db — imported as side-effect-free modules.
import('./auth.js').catch(() => {});
import('./db.js').catch(() => {});

let _auth = null;
let _db   = null;

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

const isPremiumUser   = false;
const FREE_LEVELS     = 6;
const TOTAL_LEVELS    = 30;
const CARDS_PER_LEVEL = 50;
const TRANSITION_TIMEOUT_MS = 800;

// ==========================================
//  STATE
// ==========================================

let state = {
  language:     null,   // one entry from LANGUAGES, set after language selection
  deck:         [],     // loaded deck array for the current language
  direction:    'target-en',  // 'target-en' | 'en-target'
  currentLevel: null,
  cards:        [],
  cardIndex:    0,
  knew:         0,
  missed:       0,
  flipped:      false,
  transitioning: false,
  premium:      isPremiumUser,
  user:         null,
  authReady:    false,
};

// ==========================================
//  TTS ENGINE (Web Speech API)
// ==========================================

let ttsEnabled = localStorage.getItem('polycards_tts') !== 'false';

const hasTTS = () => 'speechSynthesis' in window;

function speak(text, lang) {
  if (!ttsEnabled || !hasTTS() || isMuted) return;
  window.speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = lang;
  utt.rate   = 0.9;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

function speakFront() {
  const card = state.cards[state.cardIndex];
  if (!card || !state.language) return;
  if (state.direction === 'target-en') {
    speak(card.target, state.language.ttsCode);
  } else {
    speak(card.english, 'en-US');
  }
}

function speakBack() {
  const card = state.cards[state.cardIndex];
  if (!card || !state.language) return;
  if (state.direction === 'target-en') {
    speak(card.english, 'en-US');
  } else {
    speak(card.target, state.language.ttsCode);
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
  btn.textContent = ttsEnabled ? '\u{1F5E3}️' : '\u{1F515}';
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

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

// ==========================================
//  FLAG HELPER
// ==========================================

const FLAG_BASE = 'https://flagcdn.com';

function flagHTML(code, size = 'sm') {
  const dim = size === 'md' ? 'w80' : 'w40';
  const labels = { fr:'French', gb:'English', es:'Spanish', de:'German', it:'Italian', jp:'Japanese', br:'Portuguese' };
  const alt = labels[code] ?? code.toUpperCase();
  return `<img src="${FLAG_BASE}/${dim}/${code}.png" alt="${alt}" class="flag-${size}" />`;
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
//  PROGRESS (localStorage, namespaced by language)
// ==========================================

function progressKey(langId) {
  return `polycards_progress_${langId}`;
}

/**
 * One-time migration: copies old flat key → new language-scoped key for French.
 * Safe to run multiple times (no-op after first run).
 */
function migrateOldProgress() {
  const old = localStorage.getItem('polycards_progress');
  if (!old) return;
  const newKey = progressKey('french');
  if (!localStorage.getItem(newKey)) {
    localStorage.setItem(newKey, old);
  }
  localStorage.removeItem('polycards_progress');
}

function loadProgress(langId) {
  try { return JSON.parse(localStorage.getItem(progressKey(langId)) || '{}'); }
  catch { return {}; }
}

function _writeLocalProgress(langId, level, data) {
  const progress = loadProgress(langId);
  progress[level] = { ...progress[level], ...data };
  localStorage.setItem(progressKey(langId), JSON.stringify(progress));
}

function resetProgress(langId) {
  localStorage.removeItem(progressKey(langId));
}

function isLevelCompleted(level) {
  if (!state.language) return false;
  return !!(loadProgress(state.language.id)[level]?.completed);
}

function saveProgress(level, data) {
  const langId = state.language.id;
  _writeLocalProgress(langId, level, data);
  if (state.user && _db) {
    _db.saveProgressToCloud(state.user.uid, langId, level, data);
  }
}

async function syncCloudProgressToLocal() {
  if (!state.user || !_db || !state.language) return;
  const langId = state.language.id;
  const cloud  = await _db.loadProgressFromCloud(state.user.uid, langId);
  if (!cloud) return;

  const local = loadProgress(langId);
  let merged  = false;
  for (const [level, data] of Object.entries(cloud)) {
    if (!local[level]) {
      local[level] = data;
      merged = true;
    }
  }
  if (merged) {
    localStorage.setItem(progressKey(langId), JSON.stringify(local));
    renderLevels();
  }
}

// ==========================================
//  DECK LOADING (dynamic import per language)
// ==========================================

async function loadDeck(langId) {
  const module = await import(`./data/decks/${langId}.json`);
  return module.default;
}

// ==========================================
//  WORD DATA HELPERS
// ==========================================

function getWordsForLevel(level) {
  const real = state.deck.filter(w => w.level === level);
  if (real.length >= CARDS_PER_LEVEL) return real.slice(0, CARDS_PER_LEVEL);

  const filled = [...real];
  const categories   = ['Vocabulary', 'Grammar', 'Expressions', 'Phrases'];
  const difficulties = ['easy', 'medium', 'hard'];
  while (filled.length < CARDS_PER_LEVEL) {
    const idx = filled.length;
    filled.push({
      id:         level * 100 + idx,
      target:     `[word ${idx + 1} — level ${level}]`,
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
//  LANGUAGE SCREEN
// ==========================================

function renderLanguageScreen() {
  const grid = el('language-grid');
  grid.innerHTML = '';

  for (const lang of LANGUAGES) {
    const card = document.createElement('button');
    card.className = 'lang-card' + (lang.available ? '' : ' lang-card--soon');
    card.disabled  = !lang.available;

    const flagUrl = `${FLAG_BASE}/w80/${lang.flagCode}.png`;
    card.innerHTML = `
      <img class="lang-flag" src="${flagUrl}" alt="${lang.label}" />
      <div class="lang-info">
        <span class="lang-label">${lang.label}</span>
        <span class="lang-native">${lang.nativeName}</span>
      </div>
      ${lang.available ? '' : '<span class="lang-soon-badge">Coming soon</span>'}
    `;

    if (lang.available) {
      card.addEventListener('click', () => selectLanguage(lang));
    }
    grid.appendChild(card);
  }
}

async function selectLanguage(lang) {
  const grid = el('language-grid');
  grid.style.opacity = '0.5';
  grid.style.pointerEvents = 'none';

  try {
    state.deck     = await loadDeck(lang.id);
    state.language = lang;
    localStorage.setItem('polycards_language', lang.id);

    updateDirectionScreen(lang);
    showScreen('screen-direction');

    // Sync cloud progress for this language now that it's selected
    syncCloudProgressToLocal();
  } catch (err) {
    console.error('[PolyCards] Failed to load deck:', err);
    showToast('Failed to load language deck. Please try again.');
  } finally {
    grid.style.opacity = '';
    grid.style.pointerEvents = '';
  }
}

function updateDirectionScreen(lang) {
  const flagUrl = `${FLAG_BASE}/w80/${lang.flagCode}.png`;
  const gbUrl   = `${FLAG_BASE}/w80/gb.png`;

  el('dir-target-en').querySelector('.dir-flags').innerHTML =
    `<img class="flag-img" src="${flagUrl}" alt="${lang.label}" /><span class="dir-arrow">→</span><img class="flag-img" src="${gbUrl}" alt="English" />`;
  el('dir-target-en').querySelector('.dir-label').textContent = `${lang.label} → English`;
  el('dir-target-en').querySelector('.dir-desc').textContent  = `See a ${lang.label} word, recall its English meaning`;

  el('dir-en-target').querySelector('.dir-flags').innerHTML =
    `<img class="flag-img" src="${gbUrl}" alt="English" /><span class="dir-arrow">→</span><img class="flag-img" src="${flagUrl}" alt="${lang.label}" />`;
  el('dir-en-target').querySelector('.dir-label').textContent = `English → ${lang.label}`;
  el('dir-en-target').querySelector('.dir-desc').textContent  = `See an English word, recall its ${lang.label} meaning`;
}

// ==========================================
//  LEVELS SCREEN
// ==========================================

function goToLevels() {
  renderLevels();
  showScreen('screen-levels');
}

function renderLevels() {
  const lang      = state.language;
  const modeBadge = el('current-mode-badge');
  if (lang) {
    const fc = lang.flagCode;
    modeBadge.innerHTML = state.direction === 'target-en'
      ? `${flagHTML(fc)} ${lang.label} → English ${flagHTML('gb')}`
      : `${flagHTML('gb')} English → ${lang.label} ${flagHTML(fc)}`;
  }

  const grid = el('levels-grid');
  grid.innerHTML = '';

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
  const card = state.cards[state.cardIndex];
  if (!card || !state.language) return;
  const lang        = state.language;
  const isTargetFirst = state.direction === 'target-en';

  el('front-lang').innerHTML      = isTargetFirst
    ? `${flagHTML(lang.flagCode, 'md')} ${lang.label}`
    : `${flagHTML('gb', 'md')} English`;
  el('front-word').textContent    = isTargetFirst ? card.target  : card.english;
  el('front-category').textContent = card.category;

  el('back-lang').innerHTML       = isTargetFirst
    ? `${flagHTML('gb', 'md')} English`
    : `${flagHTML(lang.flagCode, 'md')} ${lang.label}`;
  el('back-word').textContent     = isTargetFirst ? card.english : card.target;
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

  if (!state.flipped) {
    state.cardIndex = nextIndex;
    updateCardUI();
    updateActionRow(false);
    el('flip-hint').style.visibility = 'visible';
    speakFront();
    return;
  }

  state.transitioning = true;
  updateActionRow(false);

  inner.classList.remove('flipped');
  inner.classList.add('to-edge');

  onTransformEnd(inner, () => {
    state.flipped   = false;
    state.cardIndex = nextIndex;
    updateCardUI();
    speakFront();

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

function updateAuthUI() {
  const btnLogin  = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const userInfo  = document.getElementById('auth-user-info');
  if (!btnLogin) return;

  if (state.user) {
    btnLogin.style.display  = 'none';
    btnLogout.style.display = 'inline-flex';
    if (userInfo) {
      userInfo.textContent   = state.user.displayName || state.user.email;
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
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Erro ao fazer login. Tente novamente.');
    }
  }
}

async function handleLogout() {
  if (!_auth) return;
  await _auth.logout();
  showToast('Logout realizado.');
}

async function initAuth() {
  await loadFirebaseModules();
  if (!_auth) return;

  _auth.onUserChanged(async (user) => {
    state.user      = user;
    state.authReady = true;

    if (user) {
      if (_db) _db.ensureUserDoc(user);

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

      // Only sync if user already selected a language
      await syncCloudProgressToLocal();
    } else {
      if (state._unsubProfile) { state._unsubProfile(); state._unsubProfile = null; }
      state.premium = isPremiumUser;
      renderLevels();
    }

    updateAuthUI();
  });
}

// ==========================================
//  EVENT LISTENERS
// ==========================================

// Landing
el('btn-start').addEventListener('click', () => showScreen('screen-language'));

// Language screen
el('back-from-language').addEventListener('click', () => showScreen('screen-landing'));

// Direction selector
el('back-from-direction').addEventListener('click', () => showScreen('screen-language'));
el('dir-target-en').addEventListener('click', () => { soundClick(); state.direction = 'target-en'; goToLevels(); });
el('dir-en-target').addEventListener('click', () => { soundClick(); state.direction = 'en-target'; goToLevels(); });

// Levels
el('back-from-levels').addEventListener('click', () => showScreen('screen-direction'));
el('btn-reset-progress').addEventListener('click', () => {
  if (!state.language) return;
  const langLabel = state.language.label;
  if (confirm(`Reset all ${langLabel} progress? This cannot be undone.`)) {
    resetProgress(state.language.id);
    renderLevels();
  }
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

migrateOldProgress();
updateMuteBtn();
updateTtsBtn();
renderLanguageScreen();
showScreen('screen-landing');

initAuth();
