/* =================================================================
   SolarQuest — script.js
   Core game logic: level progression, question rendering, speech
   synthesis, localStorage, theme toggle, Brain Rest timer, XP/stars.

   Multiplayer sync lives in firebase.js (window.SQFirebase).
   QR generation/scanning lives in qrcode.js (window.SQQRCode).

   Sections:
     1. Constants & cheer phrase pools
     2. State & persistence (theme, progress)
     3. Screen navigation helpers
     4. Data loading (questions.json)
     5. Speech synthesis
     6. Quest map rendering
     7. Level flow (start / render question / answer / finish)
     8. Question type renderers
     9. Brain Rest break
    10. Reward screen
    11. Multiplayer flow
    12. Event wiring
   ================================================================= */

/* =================================================================
   1. CONSTANTS & CHEER PHRASE POOLS
   ================================================================= */
const CHILD_NAME = "Azka";

const PRAISE_CORRECT = [
  `Awesome, ${CHILD_NAME}! You got it!`,
  `Brilliant work, ${CHILD_NAME}!`,
  `${CHILD_NAME}, you're a science star!`,
  `Perfect! ${CHILD_NAME} is on fire!`,
  `Great job, ${CHILD_NAME}! Keep going!`,
  `Yes! ${CHILD_NAME} nailed it!`,
  `Amazing, ${CHILD_NAME}! You're so smart!`,
  `Correct! ${CHILD_NAME} is unstoppable!`,
  `Fantastic, ${CHILD_NAME}! Well done!`,
  `You rock, ${CHILD_NAME}!`,
  `Way to go, ${CHILD_NAME}! That's right!`,
  `${CHILD_NAME}, you're a quest master!`
];

const PRAISE_WRONG = [
  `Almost there, ${CHILD_NAME}! Try again!`,
  `Good try, ${CHILD_NAME}! You'll get the next one!`,
  `Keep going, ${CHILD_NAME}! You're learning!`,
  `Don't give up, ${CHILD_NAME}! You've got this!`,
  `Close one, ${CHILD_NAME}! Let's keep exploring!`,
  `Nice effort, ${CHILD_NAME}! Next one's yours!`,
  `You're getting better, ${CHILD_NAME}!`,
  `Stay strong, ${CHILD_NAME}! Try again!`,
  `That's okay, ${CHILD_NAME}! Explorers keep trying!`,
  `Not quite, ${CHILD_NAME} -- you'll shine on the next one!`,
  `Nice thinking, ${CHILD_NAME}! Let's try the next question!`,
  `${CHILD_NAME}, every scientist makes mistakes -- keep exploring!`
];

const BURST_EMOJI = ["✨", "⭐", "🎉", "🌟", "💫"];

const QUESTION_DELAY_MS = 1500; // pause after answering before advancing

const QUESTIONS_PER_ROUND = 5; // random subset of each topic's bank shown per play

/* =================================================================
   2. STATE & PERSISTENCE
   ================================================================= */
let questionsData = null; // loaded from questions.json

const state = {
  mode: null,          // 'solo' | 'multiplayer'
  levelId: null,
  levelIndex: -1,
  questions: [],
  qIndex: 0,
  correctCount: 0,
  locked: false,        // guards double answers while feedback plays
  mp: {
    code: null,
    role: null,          // 'p1' (creator) | 'p2' (joiner)
    finished: false,
    myScore: 0,
    opponentScore: 0,
    opponentFinished: false
  }
};

const $ = id => document.getElementById(id);

function loadTheme() {
  return localStorage.getItem("solarquest.theme") || "colorful";
}
function saveTheme(theme) {
  localStorage.setItem("solarquest.theme", theme);
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll("#theme-seg .seg-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === theme);
  });
}

function loadProgress() {
  try {
    const raw = localStorage.getItem("solarquest.progress");
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt data -- fall through to fresh progress */ }
  return { xp: 0, levels: {} };
}
function saveProgress(progress) {
  localStorage.setItem("solarquest.progress", JSON.stringify(progress));
}
let progress = loadProgress();

function refreshXpBadge() {
  $("xp-total").textContent = progress.xp;
  $("xp-badge").classList.remove("hidden");
}

/* =================================================================
   3. SCREEN NAVIGATION HELPERS
   ================================================================= */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

document.querySelectorAll("[data-back]").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});

$("btn-home").addEventListener("click", () => {
  stopScannerIfRunning();
  showScreen("screen-landing");
});
$("btn-settings").addEventListener("click", () => showScreen("screen-settings"));

/* =================================================================
   4. DATA LOADING
   ================================================================= */
async function loadQuestions() {
  if (questionsData) return questionsData;
  const res = await fetch("questions.json");
  questionsData = await res.json();
  return questionsData;
}

function levelIndexOf(levelId) {
  return questionsData.levels.findIndex(l => l.id === levelId);
}

/* =================================================================
   5. SPEECH SYNTHESIS
   -----------------------------------------------------------------
   Picks a warm female English voice when available, with a slightly
   higher pitch and natural pacing so it doesn't sound robotic.
   ================================================================= */
let cachedVoice = null;

function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  const femaleHints = [
    "female", "samantha", "victoria", "karen", "moira", "tessa",
    "zira", "susan", "fiona", "kate", "serena", "allison", "ava",
    "google uk english female", "google us english"
  ];

  let voice =
    voices.find(v => v.lang.startsWith("en") && femaleHints.some(h => v.name.toLowerCase().includes(h))) ||
    voices.find(v => v.lang.startsWith("en-US") || v.lang.startsWith("en-GB")) ||
    voices.find(v => v.lang.startsWith("en"));

  return voice || voices[0];
}

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => { cachedVoice = pickVoice(); };
  cachedVoice = pickVoice();
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel(); // don't stack overlapping cheers
  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = cachedVoice || pickVoice();
  utter.pitch = 1.2;
  utter.rate = 1.0;
  utter.volume = 1;
  speechSynthesis.speak(utter);
}

/* =================================================================
   Feedback popup: celebratory (green) or calm (blue), + tiny burst
   ================================================================= */
function showFeedback(isCorrect) {
  const pool = isCorrect ? PRAISE_CORRECT : PRAISE_WRONG;
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  speak(phrase);

  const popup = $("feedback-popup");
  popup.className = "feedback-popup " + (isCorrect ? "correct" : "wrong");
  $("feedback-text").textContent = (isCorrect ? "✅ " : "💙 ") + phrase;
  popup.classList.remove("hidden");

  if (isCorrect) spawnBurst();

  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => popup.classList.add("hidden"), QUESTION_DELAY_MS - 150);
}

function spawnBurst() {
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.28;
  for (let i = 0; i < 8; i++) {
    const el = document.createElement("span");
    el.className = "burst";
    el.textContent = BURST_EMOJI[Math.floor(Math.random() * BURST_EMOJI.length)];
    const angle = (Math.PI * 2 * i) / 8;
    const dist = 70 + Math.random() * 40;
    el.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    el.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    el.style.left = `${originX}px`;
    el.style.top = `${originY}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
}

/* =================================================================
   6. QUEST MAP RENDERING
   ================================================================= */
function isLevelUnlocked(index) {
  if (index === 0) return true;
  const prevLevel = questionsData.levels[index - 1];
  return !!(progress.levels[prevLevel.id] && progress.levels[prevLevel.id].completed);
}

function starsMarkup(count) {
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += i < count ? "★" : `<span class="empty">★</span>`;
  }
  return out;
}

function renderQuestMap(container, { lockable, onSelect }) {
  container.innerHTML = "";
  questionsData.levels.forEach((level, i) => {
    const unlocked = !lockable || isLevelUnlocked(i);
    const levelProgress = progress.levels[level.id];
    const btn = document.createElement("button");
    btn.className = "quest-node" + (unlocked ? "" : " locked");
    btn.innerHTML = `
      <span class="quest-node-icon">${level.emoji}</span>
      <span class="quest-node-body">
        <span class="quest-node-name">${level.name}</span>
        <span class="quest-node-stars">${lockable ? starsMarkup(levelProgress ? levelProgress.stars : 0) : "Tap to pick this topic"}</span>
      </span>
      ${lockable && !unlocked ? '<span class="quest-node-lock">🔒</span>' : ""}
    `;
    if (unlocked) {
      btn.addEventListener("click", () => onSelect(level, i));
    } else {
      btn.disabled = true;
    }
    container.appendChild(btn);
  });
}

async function openSoloMap() {
  await loadQuestions();
  renderQuestMap($("quest-map"), {
    lockable: true,
    onSelect: (level) => startLevel(level.id, "solo")
  });
  showScreen("screen-solo-map");
}

/* =================================================================
   7. LEVEL FLOW
   ================================================================= */
function startLevel(levelId, mode) {
  state.mode = mode;
  state.levelId = levelId;
  state.levelIndex = levelIndexOf(levelId);

  const bank = questionsData.levels[state.levelIndex].questions;
  // Solo: a fresh random subset every play, so replaying doesn't feel like
  // memorization. Multiplayer: shuffled the same way on both devices (seeded
  // by the pairing code) so racers still see the identical 5 questions.
  const shuffled = mode === "multiplayer" ? seededShuffle(bank, state.mp.code) : shuffle(bank);
  state.questions = pickRoundAvoidingRepeatTypes(shuffled, QUESTIONS_PER_ROUND);
  state.qIndex = 0;
  state.correctCount = 0;
  state.locked = false;

  const level = questionsData.levels[state.levelIndex];
  $("play-level-emoji").textContent = level.emoji;
  $("play-level-name").textContent = level.name;
  $("q-total").textContent = state.questions.length;
  $("mp-race-row").classList.toggle("hidden", mode !== "multiplayer");

  if (mode === "multiplayer") {
    state.mp.finished = false;
    state.mp.myScore = 0;
    state.mp.opponentScore = 0;
    state.mp.opponentFinished = false;
    updateMpRaceUI();
  }

  showScreen("screen-play");
  renderQuestion();
}

function renderQuestion() {
  state.locked = false;
  const q = state.questions[state.qIndex];
  $("q-index").textContent = state.qIndex + 1;
  $("progress-fill").style.width = `${(state.qIndex / state.questions.length) * 100}%`;

  const stage = $("question-stage");
  stage.innerHTML = "";

  if (q.type === "mc") renderMC(stage, q);
  else if (q.type === "fill") renderFill(stage, q);
  else if (q.type === "match") renderMatch(stage, q);
  else if (q.type === "flashcard") renderFlashcard(stage, q);
}

function handleAnswer(isCorrect) {
  if (state.locked) return;
  state.locked = true;
  if (isCorrect) state.correctCount++;

  showFeedback(isCorrect);

  if (state.mode === "multiplayer") {
    state.mp.myScore = state.correctCount;
    window.SQFirebase.updateMyProgress(state.mp.code, state.mp.role, {
      index: state.qIndex + 1,
      score: state.mp.myScore,
      total: state.questions.length
    });
    updateMpRaceUI();
  }

  setTimeout(() => {
    state.qIndex++;
    if (state.qIndex >= state.questions.length) finishLevel();
    else renderQuestion();
  }, QUESTION_DELAY_MS);
}

function finishLevel() {
  const total = state.questions.length;
  const pct = state.correctCount / total;
  const stars = pct >= 0.9 ? 3 : pct >= 0.6 ? 2 : 1;
  const xpEarned = state.correctCount * 10 + stars * 20;

  if (state.mode === "solo") {
    progress.xp += xpEarned;
    const existing = progress.levels[state.levelId] || { stars: 0, completed: false };
    progress.levels[state.levelId] = {
      completed: true,
      stars: Math.max(existing.stars, stars)
    };
    saveProgress(progress);
    refreshXpBadge();

    showBrainRest(() => showReward(stars, xpEarned, "screen-solo-map"));
  } else {
    state.mp.finished = true;
    window.SQFirebase.updateMyProgress(state.mp.code, state.mp.role, {
      index: total,
      score: state.correctCount,
      total,
      finished: true
    });
    showBrainRest(() => showMpGameOver());
  }
}

/* =================================================================
   8. QUESTION TYPE RENDERERS
   ================================================================= */
function renderMC(stage, q) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<p class="question-text">${q.question}</p><div class="options-grid"></div>`;
  const grid = wrap.querySelector(".options-grid");

  // Shuffle option order each time this question is shown (doesn't mutate q).
  const order = shuffle(q.options.map((_, i) => i));

  order.forEach((originalIndex, displayIndex) => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.textContent = q.options[originalIndex];
    btn.addEventListener("click", () => {
      if (state.locked) return;
      const isCorrect = originalIndex === q.answer;
      [...grid.children].forEach((b, bi) => {
        b.disabled = true;
        if (order[bi] === q.answer) b.classList.add("correct");
        else if (bi === displayIndex) b.classList.add("wrong");
      });
      handleAnswer(isCorrect);
    });
    grid.appendChild(btn);
  });

  stage.appendChild(wrap);
}

function renderFill(stage, q) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p class="question-text">${q.question}</p>
    <div class="fill-form">
      <input type="text" class="fill-input" id="fill-input" autocomplete="off" placeholder="Type your answer" />
      <button class="btn btn-primary" id="fill-submit">Check</button>
    </div>
  `;
  stage.appendChild(wrap);

  const input = $("fill-input");
  const submit = $("fill-submit");
  const check = () => {
    if (state.locked) return;
    const given = input.value.trim().toLowerCase();
    const acceptable = (q.acceptable || [q.answer]).map(a => a.toLowerCase());
    const isCorrect = acceptable.includes(given);
    input.disabled = true;
    submit.disabled = true;
    handleAnswer(isCorrect);
  };
  submit.addEventListener("click", check);
  input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic shuffle so both multiplayer devices land on the same
// question order without talking to each other — seeded by the pairing code.
function seededShuffle(arr, seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Greedily picks `n` questions from an already-shuffled pool, skipping ahead
// whenever the next candidate would repeat the previous question's type.
function pickRoundAvoidingRepeatTypes(shuffledBank, n) {
  const pool = shuffledBank.slice();
  const picked = [];
  while (picked.length < n && pool.length > 0) {
    const lastType = picked.length ? picked[picked.length - 1].type : null;
    let idx = pool.findIndex(q => q.type !== lastType);
    if (idx === -1) idx = 0; // every remaining question repeats -- no choice left
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function renderMatch(stage, q) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<p class="question-text">${q.prompt}</p><div class="match-grid"></div>
    <div class="stage-actions"><button class="btn btn-primary" id="match-submit">Check</button></div>`;
  const grid = wrap.querySelector(".match-grid");

  const shuffledMatches = shuffle(q.pairs.map(p => p.match));

  q.pairs.forEach((pair, i) => {
    const row = document.createElement("div");
    row.className = "match-row";
    row.innerHTML = `
      <span class="match-term">${pair.term}</span>
      <select class="match-select" data-correct="${pair.match.replace(/"/g, "&quot;")}">
        <option value="" disabled selected>Choose a match…</option>
        ${shuffledMatches.map(m => `<option value="${m.replace(/"/g, "&quot;")}">${m}</option>`).join("")}
      </select>
    `;
    grid.appendChild(row);
  });

  stage.appendChild(wrap);

  $("match-submit").addEventListener("click", () => {
    if (state.locked) return;
    const rows = [...grid.querySelectorAll(".match-row")];
    let allFilled = true;
    let allCorrect = true;
    rows.forEach(row => {
      const select = row.querySelector("select");
      if (!select.value) allFilled = false;
      const rowCorrect = select.value === select.dataset.correct;
      if (!rowCorrect) allCorrect = false;
      row.classList.toggle("correct", rowCorrect);
      select.disabled = true;
    });
    if (!allFilled) {
      rows.forEach(row => row.querySelector("select").disabled = false);
      return;
    }
    handleAnswer(allCorrect);
  });
}

function renderFlashcard(stage, q) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="flashcard" id="flashcard-el">
      <span id="flashcard-text">${q.front}</span>
    </div>
    <span class="flashcard-hint" id="flashcard-hint">Tap the card to reveal the answer</span>
    <div class="stage-actions">
      <button class="btn btn-primary hidden" id="flashcard-continue">Got it! Continue</button>
    </div>
  `;
  stage.appendChild(wrap);

  const card = $("flashcard-el");
  const text = $("flashcard-text");
  const hint = $("flashcard-hint");
  const continueBtn = $("flashcard-continue");
  let flipped = false;

  card.addEventListener("click", () => {
    if (flipped) return;
    flipped = true;
    card.classList.add("flipped");
    text.textContent = q.back;
    hint.textContent = "Nice! Now hit continue.";
    continueBtn.classList.remove("hidden");
  });

  continueBtn.addEventListener("click", () => {
    // Flashcards are a review, not a test -- always counts as a win.
    handleAnswer(true);
  });
}

/* =================================================================
   9. BRAIN REST BREAK — exactly 10s, skippable, full-screen
   ================================================================= */
let brainRestTimer = null;

function showBrainRest(onDone) {
  const screen = $("screen-brain-rest");
  screen.classList.add("active");
  playMeow();

  const finish = () => {
    clearTimeout(brainRestTimer);
    screen.classList.remove("active");
    $("btn-skip-rest").onclick = null;
    onDone();
  };

  brainRestTimer = setTimeout(finish, 10000);
  $("btn-skip-rest").onclick = finish;
}

// Synthesizes a cute "meow" with the Web Audio API (pitch rises then falls,
// like a real meow's contour) -- no external audio file needed.
let meowAudioCtx = null;

// Browsers only allow AudioContext to actually make sound if it was created
// (or resumed) during a real user gesture. Brain Rest fires from inside a
// setTimeout chain, well after the gesture that triggered it, so the very
// first tap/click anywhere in the app "unlocks" the context ahead of time.
function unlockMeowAudio() {
  meowAudioCtx = meowAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (meowAudioCtx.state === "suspended") meowAudioCtx.resume();
}
document.addEventListener("pointerdown", unlockMeowAudio, { once: true });
document.addEventListener("keydown", unlockMeowAudio, { once: true });

function playMeow() {
  try {
    unlockMeowAudio();
    const ctx = meowAudioCtx;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    // Pitch contour: starts mid, rises ("me-"), then falls ("-ow").
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.linearRampToValueAtTime(760, now + 0.12);
    osc.frequency.linearRampToValueAtTime(340, now + 0.45);

    // Loud enough to actually be heard over typical phone speaker volume.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.55, now + 0.06);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.28);
    gain.gain.linearRampToValueAtTime(0, now + 0.52);

    osc.start(now);
    osc.stop(now + 0.55);
  } catch (e) {
    // Web Audio unsupported or blocked -- silently skip, the visual cats are enough.
  }
}

/* =================================================================
   10. REWARD SCREEN
   ================================================================= */
function showReward(stars, xp, returnScreenId) {
  const level = questionsData.levels[state.levelIndex];
  $("reward-level-name").textContent = level.name;
  $("reward-xp").textContent = xp;

  const starsRow = $("reward-stars");
  starsRow.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const span = document.createElement("span");
    span.className = "star" + (i < stars ? " filled" : "");
    span.textContent = "★";
    starsRow.appendChild(span);
  }

  $("btn-reward-continue").onclick = () => {
    if (returnScreenId === "screen-solo-map") openSoloMap();
    else showScreen(returnScreenId);
  };

  showScreen("screen-reward");
}

/* =================================================================
   11. MULTIPLAYER FLOW
   ================================================================= */
function updateMpRaceUI() {
  const total = state.questions.length || 1;
  $("mp-progress-me").style.width = `${(state.qIndex / total) * 100}%`;
  $("mp-progress-them").style.width = `${(state.mp.opponentIndex || 0) / total * 100}%`;
  $("mp-score-me").textContent = state.mp.myScore;
  $("mp-score-them").textContent = state.mp.opponentScore;
}

function stopScannerIfRunning() {
  if (window.SQQRCode) window.SQQRCode.stopScanner();
}

async function openMultiplayerLanding() {
  await loadQuestions();
  showScreen("screen-mp-landing");
}

function openMpCreate() {
  $("mp-level-pick-panel").classList.remove("hidden");
  $("mp-waiting-panel").classList.add("hidden");
  renderQuestMap($("mp-level-pick-list"), {
    lockable: false,
    onSelect: (level) => createMpGame(level.id)
  });
  showScreen("screen-mp-create");
}

async function createMpGame(levelId) {
  const code = window.SQFirebase.makeCode();
  state.mp.code = code;
  state.mp.role = "p1";
  state.levelId = levelId;
  state.levelIndex = levelIndexOf(levelId);

  await window.SQFirebase.createGame(code, levelId);

  $("mp-level-pick-panel").classList.add("hidden");
  $("mp-waiting-panel").classList.remove("hidden");
  $("pairing-code-display").textContent = code;
  window.SQQRCode.renderQR("qr-code-box", buildJoinUrl(code));

  window.SQFirebase.listenGame(code, "p1", onMpGameUpdate);
}

function buildJoinUrl(code) {
  return `${location.origin}${location.pathname}?join=${code}`;
}

function openMpJoin() {
  $("mp-join-error").textContent = "";
  $("join-code-input").value = "";
  showScreen("screen-mp-join");
  const pending = new URLSearchParams(location.search).get("join");
  if (pending) $("join-code-input").value = pending.toUpperCase();
}

async function submitJoinCode(codeRaw) {
  const code = codeRaw.trim().toUpperCase();
  $("mp-join-error").textContent = "";
  if (code.length !== 6) {
    $("mp-join-error").textContent = "Code must be 6 characters.";
    return;
  }
  const game = await window.SQFirebase.getGame(code);
  if (!game) {
    $("mp-join-error").textContent = "No game found with that code.";
    return;
  }
  if (game.players && game.players.p2) {
    $("mp-join-error").textContent = "This game already has two players.";
    return;
  }

  stopScannerIfRunning();
  state.mp.code = code;
  state.mp.role = "p2";
  state.levelId = game.levelId;
  state.levelIndex = levelIndexOf(game.levelId);

  await window.SQFirebase.joinGame(code);
  window.SQFirebase.listenGame(code, "p2", onMpGameUpdate);

  startLevel(state.levelId, "multiplayer");
}

function onMpGameUpdate(game) {
  if (!game || !game.players) return;
  const myRole = state.mp.role;
  const oppRole = myRole === "p1" ? "p2" : "p1";
  const me = game.players[myRole];
  const opp = game.players[oppRole];

  // Host: once player 2 joins, both start the race together.
  if (myRole === "p1" && opp && !state.questions.length) {
    $("mp-create-status").textContent = "Friend joined! Starting race…";
    startLevel(state.levelId, "multiplayer");
    return;
  }

  if (opp) {
    state.mp.opponentIndex = opp.index || 0;
    state.mp.opponentScore = opp.score || 0;
    state.mp.opponentFinished = !!opp.finished;
    updateMpRaceUI();

    if (state.mp.finished && state.mp.opponentFinished) {
      showMpGameOver();
    }
  }
}

function showMpGameOver() {
  const iWon = state.mp.myScore > state.mp.opponentScore;
  const tie = state.mp.myScore === state.mp.opponentScore;
  $("mp-result-badge").textContent = tie ? "🤝" : iWon ? "🏆" : "🌟";
  $("mp-result-title").textContent = tie ? "It's a Tie!" : iWon ? "You Won!" : "Great Race!";
  $("mp-final-me").textContent = state.mp.myScore;
  $("mp-final-them").textContent = state.mp.opponentScore;
  showScreen("screen-mp-gameover");
}

/* =================================================================
   12. EVENT WIRING
   ================================================================= */
$("btn-mode-solo").addEventListener("click", openSoloMap);
$("btn-mode-multiplayer").addEventListener("click", openMultiplayerLanding);

document.querySelectorAll("#theme-seg .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    applyTheme(btn.dataset.theme);
    saveTheme(btn.dataset.theme);
  });
});

$("btn-mp-create").addEventListener("click", openMpCreate);
$("btn-mp-join").addEventListener("click", openMpJoin);

document.querySelectorAll("#join-method-seg .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#join-method-seg .seg-btn").forEach(b => b.classList.toggle("active", b === btn));
    const isScan = btn.dataset.method === "scan";
    $("join-type-panel").classList.toggle("hidden", isScan);
    $("join-scan-panel").classList.toggle("hidden", !isScan);
    if (isScan) {
      window.SQQRCode.startScanner("qr-video", "qr-canvas", code => submitJoinCode(code));
    } else {
      stopScannerIfRunning();
    }
  });
});

$("btn-join-submit").addEventListener("click", () => submitJoinCode($("join-code-input").value));
$("join-code-input").addEventListener("keydown", e => { if (e.key === "Enter") submitJoinCode($("join-code-input").value); });

$("btn-mp-again").addEventListener("click", () => {
  stopScannerIfRunning();
  showScreen("screen-mp-landing");
});

/* =================================================================
   INIT
   ================================================================= */
(function init() {
  applyTheme(loadTheme());
  refreshXpBadge();
  loadQuestions();

  // Arrived via a scanned/shared QR join link.
  const pendingJoin = new URLSearchParams(location.search).get("join");
  if (pendingJoin) {
    loadQuestions().then(() => {
      showScreen("screen-mp-landing");
      openMpJoin();
    });
  }
})();
