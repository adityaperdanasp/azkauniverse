/* =================================================================
   SolarQuest — firebase.js
   Firebase config + Realtime Database sync for Multiplayer mode.

   ⚠️ REPLACE the placeholder config below with your own Firebase
   project's web config before deploying. Steps:
     1. Go to https://console.firebase.google.com → create a NEW
        project (use a fresh project so it doesn't share data with
        any other app, e.g. "solarquest").
     2. Build → Realtime Database → Create Database → Start in TEST
        mode (fine for a small personal project like this one).
     3. Project settings ⚙️ → "Your apps" → Web (</>) → register app.
     4. Copy the firebaseConfig object shown there into the object
        below. Make sure `databaseURL` is present (Realtime DB, not
        Firestore) — it usually looks like:
        https://<project-id>-default-rtdb.<region>.firebasedatabase.app
   ================================================================= */
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* =================================================================
   Data shape written to Realtime Database:

   /games/{code} = {
     createdAt: <server timestamp>,
     status:    "waiting" | "active",
     levelId:   "star-lifecycle" | "atom-structure" | ...,
     players: {
       p1: { index, score, total, finished },
       p2: { index, score, total, finished }
     }
   }
   ================================================================= */

// Generate a 6-char pairing code (unambiguous chars only, matches
// the Multipleazka pattern: no I, O, 1, 0 to avoid confusion).
function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createGame(code, levelId) {
  await db.ref("games/" + code).set({
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    status: "waiting",
    levelId,
    players: {
      p1: { index: 0, score: 0, total: 0, finished: false }
    }
  });
}

async function joinGame(code) {
  await db.ref("games/" + code).update({ status: "active" });
  await db.ref("games/" + code + "/players/p2").set({ index: 0, score: 0, total: 0, finished: false });
}

async function getGame(code) {
  const snap = await db.ref("games/" + code).get();
  return snap.exists() ? snap.val() : null;
}

function updateMyProgress(code, role, data) {
  if (!code || !role) return;
  db.ref(`games/${code}/players/${role}`).update(data);
}

const listeners = {};

function listenGame(code, role, onUpdate) {
  if (listeners[code]) db.ref("games/" + code).off("value", listeners[code]);
  const handler = snap => onUpdate(snap.val());
  listeners[code] = handler;
  db.ref("games/" + code).on("value", handler);
}

function stopListening(code) {
  if (listeners[code]) {
    db.ref("games/" + code).off("value", listeners[code]);
    delete listeners[code];
  }
}

window.SQFirebase = {
  makeCode,
  createGame,
  joinGame,
  getGame,
  updateMyProgress,
  listenGame,
  stopListening
};
