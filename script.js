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
$("btn-badges").addEventListener("click", async () => {
  await loadQuestions();
  renderBadgeShelf($("badge-shelf"));
  showScreen("screen-badges");
});

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
function showFeedback(isCorrect, delayMs) {
  const delay = delayMs || QUESTION_DELAY_MS;
  const pool = isCorrect ? PRAISE_CORRECT : PRAISE_WRONG;
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  speak(phrase);

  const popup = $("feedback-popup");
  popup.className = "feedback-popup " + (isCorrect ? "correct" : "wrong");
  $("feedback-text").textContent = (isCorrect ? "✅ " : "💙 ") + phrase;
  showFunFact();
  popup.classList.remove("hidden");

  setMascotMood(isCorrect ? "happy" : "soft", isCorrect ? "pop" : "soft-nudge");

  if (isCorrect) spawnBurst();

  // Correct: popup stays until right before the next question loads. Wrong:
  // the question (and revealed correct answer) can stay up much longer, but
  // the popup itself should only linger 2s so it doesn't sit there forever.
  const hideAfter = isCorrect ? delay - 150 : Math.min(2000, delay - 150);
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => popup.classList.add("hidden"), hideAfter);
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
  renderQuestPathMap($("quest-map"));
  showScreen("screen-solo-map");
}

/* =================================================================
   6b. QUEST PATH MAP (Solo mode v2) — winding path + parallax stars
   -----------------------------------------------------------------
   Node/segment coordinates are fixed for exactly 5 topics (matches
   questionsData.levels' order: sun, mercury, earth, mars, jupiter).
   ================================================================= */
const PATH_NODE_POS = [
  { x: 50, y: 90, side: "right" },
  { x: 28, y: 320, side: "left" },
  { x: 72, y: 560, side: "right" },
  { x: 28, y: 800, side: "left" },
  { x: 72, y: 1040, side: "right" }
];
const PATH_SEGMENTS = [
  "M200,90 C260,180 260,230 110,320",
  "M110,320 C-10,390 -10,470 290,560",
  "M290,560 C480,630 480,720 110,800",
  "M110,800 C-10,860 -10,940 290,1040"
];

// Hand-drawn planet illustrations, one per topic theme (questions.json's
// `planetTheme` field). No image assets -- just inline SVG shapes.
function planetSVG(theme) {
  if (theme === "sun") {
    return `<svg viewBox="0 0 100 100"><defs>
        <radialGradient id="sunG" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stop-color="#fff3d0"/><stop offset="45%" stop-color="#ffd27a"/><stop offset="100%" stop-color="#e8912e"/>
        </radialGradient></defs>
      <g fill="none" stroke="#ffcf7e" stroke-width="2.5" opacity="0.8">
        <path d="M50 4 L50 16"/><path d="M50 84 L50 96"/>
        <path d="M4 50 L16 50"/><path d="M84 50 L96 50"/>
        <path d="M16 16 L24 24"/><path d="M76 76 L84 84"/>
        <path d="M84 16 L76 24"/><path d="M16 84 L24 76"/>
      </g>
      <circle cx="50" cy="50" r="26" fill="url(#sunG)"/></svg>`;
  }
  if (theme === "mercury") {
    return `<svg viewBox="0 0 100 100"><defs>
        <radialGradient id="atomG" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#dff0ff"/><stop offset="45%" stop-color="#7cc0ff"/><stop offset="100%" stop-color="#1266d8"/>
        </radialGradient></defs>
      <g fill="none" stroke="#bfe0ff" stroke-width="2">
        <ellipse cx="50" cy="50" rx="40" ry="15"/>
        <ellipse cx="50" cy="50" rx="40" ry="15" transform="rotate(60 50 50)"/>
        <ellipse cx="50" cy="50" rx="40" ry="15" transform="rotate(120 50 50)"/>
      </g>
      <circle cx="50" cy="50" r="20" fill="url(#atomG)"/>
      <circle cx="90" cy="50" r="3.5" fill="#fff"/></svg>`;
  }
  if (theme === "earth") {
    return `<svg viewBox="0 0 100 100"><defs>
        <radialGradient id="earthG" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#eafff2"/><stop offset="45%" stop-color="#5fd0a6"/><stop offset="100%" stop-color="#1a7fb8"/>
        </radialGradient></defs>
      <circle cx="50" cy="50" r="28" fill="url(#earthG)"/>
      <path d="M32 34 q10 -6 18 2 q6 8 -4 12 q-10 4 -16 -4 q-4 -6 2 -10" fill="#2f9e6b" opacity="0.85"/>
      <path d="M60 55 q8 -2 12 6 q2 6 -6 8 q-8 2 -10 -6 q-1 -5 4 -8" fill="#2f9e6b" opacity="0.85"/>
      <g fill="none" stroke="#f2a94e" stroke-width="2" stroke-linecap="round">
        <path d="M78 30 a30 30 0 0 1 6 14"/><path d="M22 70 a30 30 0 0 1 -6 -14"/>
      </g></svg>`;
  }
  if (theme === "mars") {
    return `<svg viewBox="0 0 100 100"><defs>
        <radialGradient id="marsG" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#ffcfa8"/><stop offset="45%" stop-color="#e2703f"/><stop offset="100%" stop-color="#9c3d1f"/>
        </radialGradient></defs>
      <circle cx="50" cy="50" r="28" fill="url(#marsG)"/>
      <g stroke="#ffe3cc" stroke-width="1.4" opacity="0.75">
        <line x1="24" y1="38" x2="76" y2="38"/><line x1="24" y1="50" x2="76" y2="50"/><line x1="24" y1="62" x2="76" y2="62"/>
        <line x1="38" y1="24" x2="38" y2="76"/><line x1="62" y1="24" x2="62" y2="76"/>
      </g></svg>`;
  }
  if (theme === "jupiter") {
    return `<svg viewBox="0 0 100 100"><defs>
        <radialGradient id="jupG" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#fff0c9"/><stop offset="45%" stop-color="#e0b06a"/><stop offset="100%" stop-color="#a9743a"/>
        </radialGradient></defs>
      <circle cx="50" cy="50" r="28" fill="url(#jupG)"/>
      <path d="M22 42 h56 M22 50 h56 M22 58 h56" stroke="#a9743a" stroke-width="3" opacity="0.4"/>
      <circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.5"/>
      <path d="M50 36 v14 l9 5" stroke="#7a4f1e" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="28" fill="#c9cdea"/></svg>`;
}

function renderQuestPathMap(container) {
  container.innerHTML = "";
  container.className = "path-map-wrap";

  const levels = questionsData.levels;
  const unlockedFlags = levels.map((_, i) => isLevelUnlocked(i));

  let segMarkup = "";
  PATH_SEGMENTS.forEach((d, i) => {
    const lit = unlockedFlags[i + 1];
    segMarkup += lit
      ? `<path id="pathSeg${i}" d="${d}" fill="none" stroke="url(#pathLit)" stroke-width="4" stroke-linecap="round" filter="url(#pathGlow)"/>`
      : `<path id="pathSeg${i}" d="${d}" fill="none" stroke="var(--locked-color)" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12"/>`;
  });

  container.insertAdjacentHTML("beforeend", `
    <div class="path-field" id="path-field"></div>
    <svg class="path-map-svg" viewBox="0 0 400 1180" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pathLit" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--accent-yellow)"/>
          <stop offset="100%" stop-color="var(--secondary)"/>
        </linearGradient>
        <filter id="pathGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${segMarkup}
    </svg>
    <div class="ship-marker" id="ship-marker">
      <svg viewBox="0 0 40 40">
        <path d="M20 4 L27 26 L20 21 L13 26 Z" fill="#f4f6ff" stroke="#1266d8" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="20" cy="15" r="3" fill="#1266d8"/>
        <path d="M13 22 L6 31 L13 27 Z" fill="#ff5d8f"/>
        <path d="M27 22 L34 31 L27 27 Z" fill="#ff5d8f"/>
        <path d="M17 25 L20 36 L23 25 Z" fill="#ffd93d"/>
      </svg>
    </div>
  `);

  levels.forEach((level, i) => {
    const pos = PATH_NODE_POS[i];
    const unlocked = unlockedFlags[i];
    const lp = progress.levels[level.id];
    const stars = lp ? lp.stars : 0;
    const completed = !!(lp && lp.completed);
    const isCurrent = unlocked && !completed;

    let meta;
    if (completed) meta = `Selesai · ${stars}/3 bintang`;
    else if (isCurrent) meta = "Sedang main";
    else meta = "Terkunci";

    const btn = document.createElement("button");
    btn.className = `path-node side-${pos.side}` + (unlocked ? "" : " locked");
    btn.style.left = pos.x + "%";
    btn.style.top = pos.y + "px";
    btn.disabled = !unlocked;
    btn.innerHTML = `
      <span class="path-planet">
        <span class="path-halo"></span>
        ${planetSVG(level.planetTheme)}
        ${unlocked ? "" : '<span class="path-lock-chip">🔒</span>'}
      </span>
      <span class="path-node-name">${level.name}</span>
      <span class="path-node-stars">${starsMarkup(stars)}</span>
      <span class="path-node-meta">${meta}</span>
    `;
    if (unlocked) {
      btn.addEventListener("click", () => {
        if (shipFlying) return; // ignore taps while a flight is already in progress
        flyShipTo(i, () => startLevel(level.id, "solo"));
      });
    }
    container.appendChild(btn);
  });

  buildPathStarfield($("path-field"));

  if (shipNodeIndex === null) shipNodeIndex = defaultShipIndex(unlockedFlags);
  placeShipAt(shipNodeIndex);
}

/* =================================================================
   6d. SHIP FLIGHT — animates a rocket along the path when a chapter
   is tapped, taking 3s per hop between adjacent chapters, swerving
   around any planet it passes but doesn't stop at.
   ================================================================= */
let shipNodeIndex = null; // which chapter the ship is currently parked at
let shipFlying = false;
const SHIP_HOP_MS = 3000;
const SHIP_AVOID_RADIUS = 60; // viewBox units -- keeps clear of passed-through planets

// Lands the ship on the first unlocked-but-not-completed chapter (or the
// last chapter if everything is done) the first time the map is opened.
function defaultShipIndex(unlockedFlags) {
  for (let i = 0; i < unlockedFlags.length; i++) {
    const lp = progress.levels[questionsData.levels[i].id];
    if (unlockedFlags[i] && !(lp && lp.completed)) return i;
  }
  return unlockedFlags.length - 1;
}

function placeShipAt(nodeIndex) {
  const ship = $("ship-marker");
  const pos = PATH_NODE_POS[nodeIndex];
  if (!ship || !pos) return;
  ship.style.left = pos.x + "%";
  ship.style.top = pos.y + "px";
}

// Samples a point at fraction `t` (0..1) along segment `index`, in that
// segment's natural start-to-end direction (node i -> node i+1).
function pointOnPathSeg(index, t) {
  const el = $("pathSeg" + index);
  if (!el) return { x: 0, y: 0 };
  const len = el.getTotalLength();
  const p = el.getPointAtLength(len * Math.max(0, Math.min(1, t)));
  return { x: p.x, y: p.y };
}

function flyShipTo(targetIndex, onComplete) {
  if (shipNodeIndex === null) shipNodeIndex = targetIndex;
  if (targetIndex === shipNodeIndex) {
    onComplete();
    return;
  }
  shipFlying = true;

  const from = shipNodeIndex;
  const dir = targetIndex > from ? 1 : -1;
  const hops = [];
  for (let n = from; n !== targetIndex; n += dir) {
    hops.push({ segIndex: dir === 1 ? n : n - 1, reversed: dir === -1 });
  }

  // Chapters the ship flies past without stopping -- keep clear of them.
  const passThrough = [];
  for (let n = Math.min(from, targetIndex) + 1; n < Math.max(from, targetIndex); n++) passThrough.push(n);

  const ship = $("ship-marker");

  function runHop(hopIdx) {
    if (hopIdx >= hops.length) {
      shipNodeIndex = targetIndex;
      shipFlying = false;
      // Guard against a stray navigation if Azka left the map mid-flight
      // (e.g. tapped Home) -- state is still cleaned up either way.
      if ($("screen-solo-map").classList.contains("active")) onComplete();
      return;
    }
    const { segIndex, reversed } = hops[hopIdx];
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - startTime) / SHIP_HOP_MS);
      const segT = reversed ? 1 - t : t;
      let { x, y } = pointOnPathSeg(segIndex, segT);

      passThrough.forEach(n => {
        const pos = PATH_NODE_POS[n];
        const nx = (pos.x / 100) * 400, ny = pos.y;
        const dx = x - nx, dy = y - ny;
        const dist = Math.hypot(dx, dy);
        if (dist < SHIP_AVOID_RADIUS && dist > 0.001) {
          const scale = SHIP_AVOID_RADIUS / dist;
          x = nx + dx * scale;
          y = ny + dy * scale;
        }
      });

      const aheadT = reversed ? segT - 0.02 : segT + 0.02;
      const ahead = pointOnPathSeg(segIndex, aheadT);
      const angle = Math.atan2(ahead.y - y, ahead.x - x) * (180 / Math.PI);
      ship.style.setProperty("--ship-angle", (angle + 90) + "deg");
      ship.style.left = (x / 400 * 100) + "%";
      ship.style.top = y + "px";

      if (t < 1) requestAnimationFrame(frame);
      else runHop(hopIdx + 1);
    }
    requestAnimationFrame(frame);
  }

  runHop(0);
}

// Layered parallax starfield behind the path map -- generated once from
// small inline SVG data-URIs (no image assets), regenerated whenever the
// map (re)renders so the dot color matches the active Colorful/Pastel theme.
function buildPathStarfield(field) {
  field.innerHTML = "";
  const rgb = getComputedStyle(document.documentElement).getPropertyValue("--star-dot-rgb").trim();
  function layerBg(count, size, opacity) {
    const dots = [];
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 200, y = Math.random() * 200, r = Math.random() * size + 0.4;
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="rgb(${rgb})" opacity="${opacity}"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${dots.join("")}</svg>`;
    return "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
  }
  [
    { bg: layerBg(40, 1.1, 0.9), speed: 0.08, size: "200px 200px" },
    { bg: layerBg(28, 1.6, 0.7), speed: 0.18, size: "260px 260px" },
    { bg: layerBg(16, 2.2, 0.55), speed: 0.32, size: "320px 320px" }
  ].forEach(l => {
    const div = document.createElement("div");
    div.className = "path-field-layer";
    div.style.backgroundImage = l.bg;
    div.style.backgroundSize = l.size;
    div.dataset.speed = l.speed;
    field.appendChild(div);
  });
}

let pathParallaxTicking = false;
function updatePathParallax() {
  const wrap = document.querySelector(".path-map-wrap");
  const screen = $("screen-solo-map");
  if (!wrap || !screen.classList.contains("active")) return;
  const scrolledInto = -wrap.getBoundingClientRect().top;
  wrap.querySelectorAll(".path-field-layer").forEach(el => {
    const speed = parseFloat(el.dataset.speed);
    el.style.transform = `translateY(${scrolledInto * speed * -0.15}px)`;
  });
}
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.addEventListener("scroll", () => {
    if (pathParallaxTicking) return;
    pathParallaxTicking = true;
    requestAnimationFrame(() => { updatePathParallax(); pathParallaxTicking = false; });
  }, { passive: true });
}

/* =================================================================
   6c. BADGE SHELF (Collection screen)
   -----------------------------------------------------------------
   A badge is earned once a topic has been completed with all 3 stars.
   Reuses the existing per-level `stars` progress -- no new storage.
   ================================================================= */
function renderBadgeShelf(container) {
  container.innerHTML = "";
  questionsData.levels.forEach(level => {
    const lp = progress.levels[level.id];
    const earned = !!(lp && lp.stars === 3);
    const div = document.createElement("div");
    div.className = "badge-medal" + (earned ? " earned" : " locked");
    div.innerHTML = `
      <span class="badge-disc">${level.emoji}</span>
      <span class="badge-label">${level.name}</span>
      <span class="badge-cond">${earned ? "Didapat" : "Perlu 3 bintang"}</span>
    `;
    container.appendChild(div);
  });
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
  setMascotMood("idle");

  const stage = $("question-stage");
  stage.innerHTML = "";

  if (q.type === "mc") renderMC(stage, q);
  else if (q.type === "fill") renderFill(stage, q);
  else if (q.type === "match") renderMatch(stage, q);
  else if (q.type === "flashcard") renderFlashcard(stage, q);
}

// Swaps the reactive planet mascot's face. `nudge` briefly plays a pop
// (correct) or gentle nudge (wrong) animation on top of its idle bob.
function setMascotMood(mood, nudge) {
  const el = $("mascot");
  if (!el) return;
  el.dataset.mood = mood;
  el.classList.remove("pop", "soft-nudge");
  if (nudge) {
    void el.offsetWidth; // restart animation even if the same class was just used
    el.classList.add(nudge);
  }
}

// Picks a random fun fact for the current level, avoiding an immediate repeat.
let lastFunFactIndex = -1;
function showFunFact() {
  const level = questionsData.levels[state.levelIndex];
  const facts = level.funFacts || [];
  const target = $("fun-fact-text");
  if (!facts.length) {
    target.textContent = "";
    return;
  }
  let idx = Math.floor(Math.random() * facts.length);
  if (facts.length > 1) {
    while (idx === lastFunFactIndex) idx = Math.floor(Math.random() * facts.length);
  }
  lastFunFactIndex = idx;
  target.textContent = "💡 " + facts[idx];
}

// `delayMs` lets wrong answers linger longer than the default 1.5s so Azka
// has time to read the revealed correct answer before the next question
// loads: 5s for a wrong MC/fill, 7s for a wrong match (more to re-read).
function handleAnswer(isCorrect, delayMs) {
  if (state.locked) return;
  state.locked = true;
  if (isCorrect) state.correctCount++;

  const delay = delayMs || QUESTION_DELAY_MS;
  showFeedback(isCorrect, delay);

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
  }, delay);
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
      // Wrong answers keep the correct button highlighted green for 5s
      // (instead of the usual 1.5s) so Azka has time to see the right one.
      handleAnswer(isCorrect, isCorrect ? undefined : 5000);
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

    if (!isCorrect) {
      // Reveal the correct answer and hold this question on screen for 5s
      // (instead of the usual 1.5s) so Azka has time to read it.
      const reveal = document.createElement("p");
      reveal.className = "fill-correct-reveal";
      reveal.textContent = "✓ Correct answer: " + q.answer;
      wrap.appendChild(reveal);
    }
    handleAnswer(isCorrect, isCorrect ? undefined : 5000);
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
    const allFilled = rows.every(row => row.querySelector("select").value);
    if (!allFilled) return; // let them keep filling in the remaining rows

    let allCorrect = true;
    rows.forEach(row => {
      const select = row.querySelector("select");
      const rowCorrect = select.value === select.dataset.correct;
      if (!rowCorrect) allCorrect = false;
      row.classList.toggle("correct", rowCorrect);
      row.classList.toggle("wrong", !rowCorrect);
      select.disabled = true;

      if (!rowCorrect) {
        const reveal = document.createElement("div");
        reveal.className = "match-correct-reveal";
        reveal.textContent = "✓ " + select.dataset.correct;
        row.appendChild(reveal);
      }
    });

    // Wrong pairs stay revealed for 7s (instead of the usual 1.5s) so
    // Azka has time to read every correct match before moving on.
    handleAnswer(allCorrect, allCorrect ? undefined : 7000);
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
  playMeowChorus();

  const finish = () => {
    clearTimeout(brainRestTimer);
    screen.classList.remove("active");
    $("btn-skip-rest").onclick = null;
    onDone();
  };

  brainRestTimer = setTimeout(finish, 10000);
  $("btn-skip-rest").onclick = finish;
}

// Two distinct meow "voices" -- a brighter/higher cat and a deeper/mellower
// one -- so a back-and-forth chorus sounds like two different cats calling
// out, not one cat repeating itself.
const MEOW_VOICES = {
  bright: { start: 560, peak: 820, end: 360, peakAt: 0.22, filterHz: 2400, gain: 0.55, sustainGain: 0.42 },
  deep: { start: 360, peak: 540, end: 230, peakAt: 0.28, filterHz: 1500, gain: 0.5, sustainGain: 0.38 }
};

// Synthesizes one ~1s "meow" with the Web Audio API (pitch rises then falls,
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

function playMeow(voice) {
  const v = MEOW_VOICES[voice] || MEOW_VOICES.bright;
  try {
    unlockMeowAudio();
    const ctx = meowAudioCtx;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    filter.type = "lowpass";
    filter.frequency.value = v.filterHz;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    // Pitch contour: starts mid, rises ("me-"), then falls ("-ow") over ~1s.
    osc.frequency.setValueAtTime(v.start, now);
    osc.frequency.linearRampToValueAtTime(v.peak, now + v.peakAt);
    osc.frequency.linearRampToValueAtTime(v.end, now + 0.95);

    // Loud enough to actually be heard over typical phone speaker volume.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(v.gain, now + 0.08);
    gain.gain.linearRampToValueAtTime(v.sustainGain, now + 0.55);
    gain.gain.linearRampToValueAtTime(0, now + 1.0);

    osc.start(now);
    osc.stop(now + 1.05);
  } catch (e) {
    // Web Audio unsupported or blocked -- silently skip, the visual cats are enough.
  }
}

// Plays 3 meows with uneven gaps and alternating voices, like two cats
// calling back and forth ("sautan") instead of one cat repeating on a timer.
function playMeowChorus() {
  setTimeout(() => playMeow("bright"), 0);
  setTimeout(() => playMeow("deep"), 950);
  setTimeout(() => playMeow("bright"), 2500);
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
