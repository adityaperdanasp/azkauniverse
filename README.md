# SolarQuest — Azka's Science Adventure

A playful quiz game for a Year 4 student, built around the topics in
*Y4-T1-Science & Social Studies*: **Life Cycle of a Star**, **Basic
Structure of an Atom**, **Earth Rotation**, **Globes and Maps**, and
**Time System**.

## File structure

| File | Purpose |
|---|---|
| `index.html` | All screens (landing, settings, quest map, play, Brain Rest, reward, multiplayer). Structure only — no styling or logic. |
| `style.css` | Every visual style: Fredoka font import, the Colorful/Pastel theme variables, quest map, question cards, Brain Rest cat animations, responsive layout. |
| `script.js` | Core game engine: screen navigation, level progression, question rendering per type, speech synthesis (voice cheers), localStorage (theme + progress), Brain Rest timer, XP/stars/badges. |
| `firebase.js` | Firebase Realtime Database config + multiplayer sync (create/join game, live score & progress updates). |
| `qrcode.js` | QR code generation for the host's pairing code, and camera-based QR scanning for the joining player. |
| `questions.json` | The question bank — see below. |

## How Solo vs Multiplayer works

- **Solo**: pick a topic from the quest map. Topics unlock in order —
  finishing one unlocks the next. Stars (1–3) and XP per topic are
  saved to `localStorage` under the key `solarquest.progress`, so
  progress survives closing the browser.
- **Multiplayer**: Player 1 taps **Create Game**, picks a topic, and
  gets a 6-character code + QR code. Player 2 either types the code
  or scans the QR with their camera. Both players then answer the
  *same* question set on their own device — Firebase Realtime
  Database syncs each player's live score and progress so both
  screens show a running scoreboard. First to answer more correctly
  wins the race.

## How QR join works

The QR code encodes a URL like `https://yourapp.vercel.app/?join=ABC123`.
Scanning it (via `qrcode.js` + the `jsQR` library and the phone's
camera) extracts the `join` code and joins that game automatically.
If camera access isn't available, the same code can be typed in
manually on the **Join Game** screen.

## How Brain Rest works

After finishing a topic, a full-screen "Brain Rest!" break appears
with three animated cat emoji (bounce / sway / wiggle via pure CSS
keyframes — no images). It lasts exactly 10 seconds and then
auto-continues to the quest map or reward screen. There's a **Skip**
button for whenever Azka wants to keep going right away.

## Updating the question bank (`questions.json`)

Each entry in `levels` is one topic:

```json
{
  "id": "star-lifecycle",
  "name": "Life Cycle of a Star",
  "emoji": "⭐",
  "questions": [ ... ]
}
```

Each question has a `type` of `mc`, `fill`, `match`, or `flashcard`.
Keep the types rotating (don't repeat the same type twice in a row) —
the existing levels alternate `mc → fill → match → flashcard` twice
per topic (8 questions), which is a good template to copy.

**Multiple choice (`mc`)**
```json
{ "type": "mc", "question": "...", "options": ["A", "B", "C", "D"], "answer": 0 }
```
`answer` is the zero-based index of the correct option.

**Fill in the blank (`fill`)**
```json
{ "type": "fill", "question": "The Sun is a _____ sequence star.", "answer": "main", "acceptable": ["main", "main sequence"] }
```
`acceptable` is optional — a list of accepted spellings/synonyms
(matched case-insensitively). If omitted, only `answer` is accepted.

**Matching (`match`)**
```json
{
  "type": "match",
  "prompt": "Match each word to its meaning.",
  "pairs": [
    { "term": "Nebula", "match": "A cloud of gas and dust" }
  ]
}
```
Add as many `pairs` as you like (3–5 works well on screen).

**Flashcard (`flashcard`)**
```json
{ "type": "flashcard", "front": "Question or prompt", "back": "The answer / fun fact" }
```
Flashcards are a review card, not a test — tapping "Got it!" always
counts as correct progress.

To add a new topic entirely, add another object to the `levels`
array with a unique `id`. It will automatically appear as the next
stop on the quest map and in the multiplayer topic picker.

## Multiplayer setup (Firebase)

`firebase.js` ships with placeholder config. Create your own free
Firebase project with a Realtime Database and paste your config in —
see the comment block at the top of `firebase.js` for the exact
steps.

## Local testing

Any static file server works, e.g.:

```
npx serve .
```

Then open the printed `localhost` URL. Camera-based QR scanning
requires either `localhost` or an HTTPS URL (like the deployed
Vercel site) — it won't work over plain HTTP on a phone.
