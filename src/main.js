// src/main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, runTransaction, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
  TURN_MS, WORD_PICK_MS, MAX_ROUNDS, MAX_STROKES, STROKE_FLUSH_MS,
  FIREBASE_CONFIG, APP_ID, INITIAL_AUTH_TOKEN, WORDS, WORDS_BY_DIFFICULTY, SCORING_TIERS
} from "./constants.js";
import { getCoordinates, pickChoices, formatSeconds, getGuessCloseness, wordLengthMultiplier, debounce } from "./helpers.js";

// ─── Firebase ────────────────────────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const db  = getFirestore(app);
const auth = getAuth(app);

// ─── Welcome UI refs ──────────────────────────────────────────────────────────
const welcomeScreen     = document.getElementById("welcome-screen");
const createRoomBtn     = document.getElementById("create-room-btn");
const joinRoomBtn       = document.getElementById("join-room-btn");
const joinRoomInput     = document.getElementById("join-room-input");
const usernameInput     = document.getElementById("username-input");
const statusMessage     = document.getElementById("status-message");
const waitingInline     = document.getElementById('waiting-inline');
const roomIdSpanInline  = document.getElementById('room-id-inline');
const copyBtnInline     = document.getElementById('copy-btn-inline');
const copyTip           = document.getElementById('copy-tip');
const playerStatusInline= document.getElementById('player-status-inline');
const chatPanel         = document.getElementById('chat-panel');
const chatToggle        = document.getElementById('chat-toggle');
const chatClose         = document.getElementById('chat-close');
const chatBackdrop      = document.getElementById('chat-backdrop');
const chatBadge         = document.getElementById('chat-badge');

const GAME_SCREEN_ID = "game-play-area";

// ─── Gameplay UI refs (grabbed lazily) ───────────────────────────────────────
let gameInfoEl, turnIndicatorTop, roundNumberTop, timerDisplayTop, progressEl;
let canvas, ctx, drawingControls, guessingControls, wordToDrawEl;
let brushSizeInput, brushColorInput, clearCanvasBtn, undoBtn, eraserBtn, brushBtn;
let guessInput, submitGuessBtn, guessStatusEl, chatInput, sendChatBtn, chatMessagesContainer;
let endGameModal, finalScoresEl, playAgainBtn, leftModal, leftOkBtn, homeBtnModal, leftModalMsg;
let skipWordBtn;

const getGameUIElements = () => {
  gameInfoEl        = document.getElementById("game-info");
  turnIndicatorTop  = document.getElementById("turn-indicator");
  roundNumberTop    = document.getElementById("round-number");
  timerDisplayTop   = document.getElementById("turn-timer");
  progressEl        = document.getElementById("turn-progress");

  canvas = document.getElementById("drawing-canvas");
  ctx    = canvas ? canvas.getContext("2d") : null;

  drawingControls  = document.getElementById("drawing-controls");
  guessingControls = document.getElementById("guessing-controls");
  wordToDrawEl     = document.getElementById("word-to-draw");
  brushSizeInput   = document.getElementById("brush-size");
  brushColorInput  = document.getElementById("brush-color");
  clearCanvasBtn   = document.getElementById("clear-canvas-btn");
  undoBtn          = document.getElementById("undo-btn");
  eraserBtn        = document.getElementById("eraser-btn");
  brushBtn         = document.getElementById("brush-btn");
  skipWordBtn      = document.getElementById("skip-word-btn");

  guessInput          = document.getElementById("guess-input");
  submitGuessBtn      = document.getElementById("submit-guess-btn");
  guessStatusEl       = document.getElementById("guess-status");
  chatInput           = document.getElementById("chat-input");
  sendChatBtn         = document.getElementById("send-chat-btn");
  chatMessagesContainer = document.getElementById("chat-messages");

  endGameModal  = document.getElementById("end-game-modal");
  finalScoresEl = document.getElementById("final-scores");
  playAgainBtn  = document.getElementById("play-again-btn");
  leftModal     = document.getElementById("left-modal");
  leftOkBtn     = document.getElementById("left-ok-btn");
  homeBtnModal  = document.getElementById("home-btn-modal");
  leftModalMsg  = document.getElementById("left-modal-msg");
};

// ─── Game State ───────────────────────────────────────────────────────────────
let unsubscribeGame = null;
let gameId   = null;
let user     = null;
let username = null;
let gameData = null;
let triedStart = false;

let timerInterval  = null;
let isDrawing      = false;
let currentStroke  = [];
let lastPosition   = { x: 0, y: 0 };
let brushColor     = "#000000";
let brushSize      = 5;
const ERASER_SIZE  = 20;
let isErasing      = false;
let isRevealing    = false;
let lastPlayerLeftSeen = null;

// Batched stroke buffer — fix #1
let pendingStrokes = [];
let strokeFlushTimer = null;

// ─── Audio ────────────────────────────────────────────────────────────────────
// Fix #7: Web Audio API sound effects — no external library
let audioCtx = null;
const getAudio = () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
};

const playTone = (freq, type, duration, vol = 0.3, delay = 0) => {
  try {
    const ac  = getAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
    gain.gain.setValueAtTime(vol, ac.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);
    osc.start(ac.currentTime + delay);
    osc.stop(ac.currentTime + delay + duration);
  } catch (_) {}
};

const sfx = {
  correct: () => {
    playTone(523, 'sine', 0.12, 0.35);
    playTone(659, 'sine', 0.12, 0.35, 0.12);
    playTone(784, 'sine', 0.25, 0.35, 0.24);
  },
  wrong: () => {
    playTone(200, 'square', 0.12, 0.15);
  },
  tick: () => {
    playTone(880, 'sine', 0.05, 0.1);
  },
  newTurn: () => {
    playTone(440, 'sine', 0.08, 0.2);
    playTone(550, 'sine', 0.15, 0.2, 0.1);
  },
  close: () => {
    playTone(660, 'triangle', 0.08, 0.2);
    playTone(440, 'triangle', 0.08, 0.2, 0.08);
  }
};

// ─── Screen Switching ─────────────────────────────────────────────────────────
const screens = document.querySelectorAll('#screens > div, #screens > section');
const showScreen = (screenId) => {
  screens.forEach(s => s.classList.add("hidden"));
  const target = document.getElementById(screenId);
  if (target) target.classList.remove("hidden");
  const topbar = document.getElementById("topbar");
  if (screenId === GAME_SCREEN_ID) topbar.classList.remove("hidden");
  else topbar.classList.add("hidden");
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
const initializeAuthAndUI = async () => {
  statusMessage.textContent = "Connecting…";
  createRoomBtn.disabled = true;
  joinRoomBtn.disabled   = true;
  try {
    const result = INITIAL_AUTH_TOKEN
      ? await signInWithCustomToken(auth, INITIAL_AUTH_TOKEN)
      : await signInAnonymously(auth);
    user = result.user;
    statusMessage.textContent = "Ready to play! Enter your name to begin.";
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled   = false;

    // Fix #12: Reconnect from sessionStorage
    const savedGame = sessionStorage.getItem('gtd_game');
    if (savedGame) {
      try {
        const { gId, uname } = JSON.parse(savedGame);
        if (gId && uname) attemptReconnect(gId, uname);
      } catch (_) {}
    }
  } catch (e) {
    statusMessage.textContent = "Failed to connect. Please try again.";
    console.error(e);
  }
};

const attemptReconnect = async (gId, uname) => {
  const ref = doc(db, "artifacts", APP_ID, "public", "data", "games", gId);
  try {
    const snap = await ref.get ? ref.get() : (await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js").then(m => m.getDoc(ref)));
    // Use onSnapshot to check existence
    const unsub = onSnapshot(ref, (s) => {
      unsub();
      if (!s.exists()) { sessionStorage.removeItem('gtd_game'); return; }
      const d = s.data();
      const inGame = (d.players || []).some(p => p.id === user.uid);
      if (!inGame || d.state === 'finished') { sessionStorage.removeItem('gtd_game'); return; }
      gameId   = gId;
      username = uname;
      statusMessage.textContent = `Reconnecting to game ${gId}…`;
      setupFirestoreListener();
    });
  } catch (_) {
    sessionStorage.removeItem('gtd_game');
  }
};

// ─── Game Flow ────────────────────────────────────────────────────────────────
const startGame = async () => {
  await runTransaction(db, async (tx) => {
    const ref  = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Game doc missing.");
    const d = snap.data();
    if (d.state !== "waiting") return;
    if ((d.players || []).length !== 2) throw new Error("Need 2 players.");

    const currentTurn = d.players[0]?.id || d.owner;
    const choices = pickChoices(WORDS, d.usedWords || [], 3, WORDS_BY_DIFFICULTY);

    tx.update(ref, {
      state: "playing",
      currentPlayer: currentTurn,
      word: null,
      wordChoices: choices,
      usedWords: d.usedWords || [],
      round: 1,
      strokes: [],
      chat: [],
      wordPickEndsAt: Date.now() + WORD_PICK_MS,
      turnEndsAt: null,
      revealedLetters: [],
      lastGuesser: null,
      skipsUsed: {}
    });
  }).catch(err => console.error("Game start failed:", err));
};

const nextTurn = async () => {
  await runTransaction(db, async (tx) => {
    const ref  = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const d       = snap.data();
    const players = d.players || [];
    const curr    = d.currentPlayer;
    const next    = players.find(p => p.id !== curr)?.id;
    let newRound  = d.round;
    if (next === players[0].id) newRound++;

    if (newRound > MAX_ROUNDS) {
      tx.update(ref, { state: "finished", scores: players.map(p => ({ name: p.name, score: p.score })) });
      return;
    }

    const choices = pickChoices(WORDS, d.usedWords || [], 3, WORDS_BY_DIFFICULTY);
    tx.update(ref, {
      currentPlayer: next,
      word: null,
      wordChoices: choices,
      round: newRound,
      strokes: [],
      wordPickEndsAt: Date.now() + WORD_PICK_MS,
      turnEndsAt: null,
      revealedLetters: [],
      lastGuesser: null,
      skipsUsed: {}
    });
  });
};

const chooseWord = async (selected) => {
  if (!gameData || gameData.currentPlayer !== user.uid) return;
  const ref = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    if (!(d.wordChoices || []).includes(selected)) return;
    tx.update(ref, {
      word: selected,
      usedWords: arrayUnion(selected),
      wordPickEndsAt: null,
      turnEndsAt: Date.now() + TURN_MS,
      revealedLetters: []
    });
  });
  sfx.newTurn();
};

// Fix #9: Skip word — one skip per turn per drawer
const skipWord = async () => {
  if (!gameData || gameData.currentPlayer !== user.uid || gameData.word) return;
  const skipsUsed = gameData.skipsUsed || {};
  const turnKey   = `${gameData.round}:${user.uid}`;
  if (skipsUsed[turnKey]) return; // already used skip this turn

  const ref = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    const newSkips   = { ...(d.skipsUsed || {}), [turnKey]: true };
    const newChoices = pickChoices(WORDS, [...(d.usedWords || []), ...(d.wordChoices || [])], 3, WORDS_BY_DIFFICULTY);
    tx.update(ref, {
      wordChoices: newChoices,
      skipsUsed: newSkips,
      wordPickEndsAt: Date.now() + WORD_PICK_MS
    });
  });
};

const revealLetter = async () => {
  if (!gameData || !gameData.word || gameData.state !== "playing") { isRevealing = false; return; }
  const wordLength = gameData.word.length;
  const revealed   = gameData.revealedLetters || [];
  const unrevealed = [];
  for (let i = 0; i < wordLength; i++) if (!revealed.includes(i)) unrevealed.push(i);
  if (unrevealed.length > 0) {
    const letterIndex = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    try {
      await updateDoc(doc(db, "artifacts", APP_ID, "public", "data", "games", gameId), {
        revealedLetters: arrayUnion(letterIndex)
      });
    } catch (e) { console.error("Reveal letter error:", e); }
    finally { isRevealing = false; }
  } else { isRevealing = false; }
};

const submitGuess = async () => {
  if (!gameData || gameData.currentPlayer === user.uid) return;
  if (!gameData.word) { guessStatusEl.textContent = "They haven't chosen a word yet!"; return; }

  const guess       = guessInput.value.trim().toLowerCase();
  guessInput.value  = "";
  guessStatusEl.textContent = "";
  if (!guess) return;

  const correctWord = gameData.word.toLowerCase();
  const guesser     = gameData.players.find(p => p.id === user.uid);
  if (!guesser) return;

  await updateDoc(doc(db, "artifacts", APP_ID, "public", "data", "games", gameId), {
    lastGuesser: { id: user.uid, name: guesser.name }
  });

  if (guess === correctWord) {
    // Fix #13: word-length multiplier applied to score
    const guesserId   = user.uid;
    const drawerId    = gameData.currentPlayer;
    const timeElapsed = Date.now() - (gameData.turnEndsAt - TURN_MS);
    let basePoints    = 0;
    for (const tier of SCORING_TIERS) {
      if (timeElapsed <= tier.time) { basePoints = tier.points; break; }
    }
    const mult         = wordLengthMultiplier(gameData.word);
    const guesserPts   = Math.round(basePoints * mult);
    const drawerPts    = Math.round(Math.ceil(basePoints / 2) * mult);

    sfx.correct();
    await runTransaction(db, async (tx) => {
      const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
      const gameDoc = await tx.get(gameRef);
      if (!gameDoc.exists()) return;
      const players = gameDoc.data().players;
      const updatedPlayers = players.map(p => {
        if (p.id === guesserId) return { ...p, score: p.score + guesserPts };
        if (p.id === drawerId)  return { ...p, score: p.score + drawerPts };
        return p;
      });
      tx.update(gameRef, {
        players: updatedPlayers,
        // Fix #10: correct-guess events go into chat as system messages
        chat: arrayUnion({ id: "system", name: "", text: `✅ <strong>${guesser.name}</strong> guessed it! The word was "<strong>${gameData.word}</strong>" (+${guesserPts} pts)` })
      });
    }).then(() => nextTurn()).catch(e => console.error("Guess tx error:", e));
  } else {
    // Fix #6: fuzzy "close guess" hint
    const closeness = getGuessCloseness(guess, correctWord);
    if (closeness === 'warm') {
      sfx.close();
      guessStatusEl.textContent = "🔥 So close!";
      setTimeout(() => { if (guessStatusEl) guessStatusEl.textContent = ""; }, 2000);
    } else {
      sfx.wrong();
    }
    // Fix #10: wrong guesses go to separate guesses array, not chat
    await updateDoc(doc(db, "artifacts", APP_ID, "public", "data", "games", gameId), {
      guesses: arrayUnion({ id: user.uid, name: guesser.name, text: guess, isIncorrect: true, warm: closeness === 'warm' })
    });
  }
};

// ─── Canvas ───────────────────────────────────────────────────────────────────
const drawLine = (x1, y1, x2, y2, color, size, erase = false) => {
  if (!ctx) return;
  ctx.save();
  // Fix #8: real eraser using destination-out
  if (erase) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth  = size;
  ctx.lineCap    = "round";
  ctx.lineJoin   = "round";
  ctx.stroke();
  ctx.closePath();
  ctx.restore();
};

const canDrawNow = () =>
  !!gameData && gameData.state === "playing" && !!gameData.word &&
  gameData.currentPlayer === user.uid && Date.now() < (gameData.turnEndsAt || 0);

const startDrawing = (e) => {
  if (!canDrawNow()) return;
  isDrawing    = true;
  const { x, y } = getCoordinates(e, canvas);
  lastPosition    = { x, y };
  currentStroke   = [{ x, y }];
  e.preventDefault();
};

const draw = (e) => {
  if (!isDrawing || !canDrawNow()) return;
  const { x, y }  = getCoordinates(e, canvas);
  currentStroke.push({ x, y });
  const erase       = isErasing;
  const currentColor = erase ? null : brushColor;
  const currentSize  = erase ? ERASER_SIZE : brushSize;
  drawLine(lastPosition.x, lastPosition.y, x, y, currentColor, currentSize, erase);
  lastPosition = { x, y };
  if (currentStroke.length >= MAX_STROKES) {
    queueStroke({ points: [...currentStroke], color: currentColor, size: currentSize, erase });
    currentStroke = [{ x, y }];
  }
  e.preventDefault();
};

const stopDrawing = () => {
  if (!isDrawing) return;
  if (currentStroke.length > 0 && canDrawNow()) {
    const erase = isErasing;
    queueStroke({ points: [...currentStroke], color: erase ? null : brushColor, size: erase ? ERASER_SIZE : brushSize, erase });
  }
  isDrawing     = false;
  currentStroke = [];
};

const redrawCanvas = (strokes) => {
  clearCanvas();
  (strokes || []).forEach(stroke => {
    if (stroke.points && stroke.points.length > 1) {
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i - 1];
        const p2 = stroke.points[i];
        drawLine(p1.x, p1.y, p2.x, p2.y, stroke.color, stroke.size, stroke.erase);
      }
    }
  });
};

const clearCanvas = () => {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

// Fix #4: setupCanvas no longer clears strokes; redraws instead
const setupCanvas = () => {
  if (!canvas || !ctx) return;
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const wantW = Math.round(rect.width * dpr);
  const wantH = Math.round(rect.height * dpr);
  if (canvas.width === wantW && canvas.height === wantH) return;
  canvas.width  = wantW;
  canvas.height = wantH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  // Redraw after resize so strokes survive keyboard/resize events on mobile
  if (gameData?.strokes) redrawCanvas(gameData.strokes);
};

// ─── Batched Stroke Sync (Fix #1) ────────────────────────────────────────────
// Instead of arrayUnion per stroke, buffer locally and flush the full array
// at a debounced interval via setDoc of just the strokes field.
const queueStroke = (stroke) => {
  pendingStrokes.push(stroke);
  scheduleFlush();
};

const scheduleFlush = debounce(flushStrokes, STROKE_FLUSH_MS);

async function flushStrokes() {
  if (!pendingStrokes.length || !gameId) return;
  const toSend = [...pendingStrokes];
  pendingStrokes = [];
  try {
    // Merge pending with what Firestore already has via transaction
    await runTransaction(db, async (tx) => {
      const ref  = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const existing = snap.data().strokes || [];
      tx.update(ref, { strokes: [...existing, ...toSend] });
    });
  } catch (e) {
    // Put them back and retry
    pendingStrokes = [...toSend, ...pendingStrokes];
    console.error("Stroke flush error:", e);
  }
}

// ─── Firestore sync ───────────────────────────────────────────────────────────
const sendChatMessage = async (text) => {
  if (!text.trim()) return;
  const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
  const message = { id: user.uid, name: username, text, timestamp: Date.now() };
  await updateDoc(gameRef, { chat: arrayUnion(message) });
  chatInput.value = "";
  if (isMobile() && !document.body.classList.contains('chat-open')) openChat();
};

let lastRenderedChatLen   = 0;
let lastRenderedGuessLen  = 0;

const setupFirestoreListener = () => {
  const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  unsubscribeGame = onSnapshot(gameRef, (docSnap) => {
    if (!docSnap.exists()) return;
    gameData = docSnap.data();

    // Fix #12: persist session
    sessionStorage.setItem('gtd_game', JSON.stringify({ gId: gameId, uname: username }));

    const leaver = gameData.playerLeft;
    if (leaver && leaver !== username && leaver !== lastPlayerLeftSeen) {
      lastPlayerLeftSeen = leaver;
      handleRemotePlayerLeft(leaver);
      return;
    }

    if (gameData.state === "waiting")  handleWaitingState();
    else if (gameData.state === "playing")  handlePlayingState();
    else if (gameData.state === "finished") handleFinishedState();

    // Fix #10: render chat messages (social) and game guesses separately
    renderChatDelta(gameData.chat || [], gameData.guesses || []);

  }, err => console.error("Firestore listener error:", err));
};

// ─── Mobile chat ──────────────────────────────────────────────────────────────
const isMobile  = () => window.matchMedia('(max-width: 767.98px)').matches;
let chatUnread  = 0;
const openChat  = () => {
  document.body.classList.add('chat-open');
  chatUnread = 0;
  if (chatBadge) chatBadge.classList.add('hidden');
  if (chatMessagesContainer) chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
};
const closeChat = () => document.body.classList.remove('chat-open');
const bumpUnread = () => {
  if (!isMobile() || document.body.classList.contains('chat-open')) return;
  chatUnread++;
  if (chatBadge) { chatBadge.textContent = String(chatUnread); chatBadge.classList.remove('hidden'); }
};

// ─── UI Updates ───────────────────────────────────────────────────────────────
const updateUIForTurn = () => {
  if (!gameData) return;
  const myTurn = gameData.currentPlayer === user.uid;
  const hasWord = !!gameData.word;

  drawingControls.classList.toggle("hidden", !myTurn);
  guessingControls.classList.toggle("hidden", myTurn || !hasWord);
  wordToDrawEl.textContent        = myTurn && hasWord ? gameData.word : "";
  canvas.style.pointerEvents      = myTurn && hasWord ? "auto" : "none";

  // Word choices
  const wordChoicesWrap = document.getElementById("word-choices-wrap");
  const wordChoicesEl   = document.getElementById("word-choices");
  wordChoicesWrap.classList.toggle("hidden", !myTurn || hasWord);

  // Skip button visibility — Fix #9
  const skipsUsed = gameData.skipsUsed || {};
  const turnKey   = `${gameData.round}:${user.uid}`;
  const usedSkip  = !!skipsUsed[turnKey];
  if (skipWordBtn) skipWordBtn.classList.toggle("hidden", !myTurn || hasWord || usedSkip);

  if (myTurn && !hasWord) {
    wordChoicesEl.innerHTML = "";
    const difficulties = ['Easy', 'Medium', 'Hard'];
    (gameData.wordChoices || []).forEach((w, i) => {
      const btn = document.createElement("button");
      btn.className = "word-chip";
      const diff = difficulties[i] || '';
      btn.innerHTML = `<span class="text-xs opacity-60 block">${diff}</span>${w}`;
      btn.onclick = () => chooseWord(w);
      wordChoicesEl.appendChild(btn);
    });
  }

  // Fix #11: Better word hint display — blanks as underlines
  const wordHintEl = document.getElementById("word-hint");
  if (gameData.word && !myTurn) {
    const wordLength = gameData.word.length;
    const revealed   = gameData.revealedLetters || [];
    const letters    = gameData.word.split("").map((letter, idx) => {
      if (letter === " ") return `<span class="mx-2 text-gray-400">·</span>`;
      if (revealed.includes(idx)) {
        return `<span class="letter-revealed">${letter.toUpperCase()}</span>`;
      }
      return `<span class="letter-blank">_</span>`;
    });
    wordHintEl.innerHTML = `
      <div class="flex items-center justify-center gap-1 flex-wrap">${letters.join('')}</div>
      <div class="text-sm font-normal text-gray-400 mt-1">${wordLength} letter${wordLength !== 1 ? 's' : ''}</div>
    `;
  } else {
    wordHintEl.innerHTML = "";
  }

  // Top bar
  const drawerName = gameData.players.find(p => p.id === gameData.currentPlayer)?.name || "—";
  turnIndicatorTop.textContent  = drawerName;
  roundNumberTop.textContent    = `${gameData.round} / ${MAX_ROUNDS}`;

  guessStatusEl.textContent = myTurn
    ? (hasWord ? "Draw the word above for your friend to guess!" : "Pick a word to start drawing!")
    : (hasWord ? "Guess the drawing!" : "Waiting for them to pick a word…");
};

const updateScoreDisplay = () => {
  if (!gameData?.players) return;
  const scoreDisplayEl = document.getElementById("score-display");
  const scoresHtml = gameData.players
    .map(p => `<span class="score-pill">${p.name}: <span class="font-bold text-indigo-600">${p.score}</span></span>`)
    .join("");
  scoreDisplayEl.innerHTML = scoresHtml;
};

// Fix #10: render chat (social) and guesses (game events) merged in time order
const renderChatDelta = (chatHistory, guessHistory) => {
  if (!chatMessagesContainer) return;
  const chatLen  = chatHistory.length;
  const guessLen = guessHistory.length;
  if (chatLen === lastRenderedChatLen && guessLen === lastRenderedGuessLen) return;

  // Re-render everything into a merged, time-ordered feed
  // We do a full re-render only when needed (lengths changed)
  chatMessagesContainer.innerHTML = '';
  lastRenderedChatLen  = chatLen;
  lastRenderedGuessLen = guessLen;

  const all = [
    ...chatHistory.map(m => ({ ...m, _kind: 'chat' })),
    ...guessHistory.map(m => ({ ...m, _kind: 'guess' }))
  ].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  all.forEach(message => {
    appendMessageEl(message, message.id === user.uid);
  });
};

const appendMessageEl = (message, isLocalUser) => {
  const wrap = document.createElement("div");
  let cls = "chat-msg ";

  if (message.isIncorrect) {
    const warmLabel = message.warm ? ' <span class="text-orange-400 text-xs font-bold">🔥 close!</span>' : '';
    wrap.innerHTML = `<span class="opacity-60 text-xs">${message.name}:</span> ❌ ${message.text}${warmLabel}`;
    cls += isLocalUser ? "self-end text-right" : "self-start";
  } else if (!message.name || message.name === "" || message.name === "System") {
    wrap.innerHTML = message.text;
    cls += "self-center system-msg";
  } else {
    wrap.innerHTML = `<span class="font-semibold">${message.name}:</span> ${message.text}`;
    cls += isLocalUser ? "chat-me self-end" : "chat-them self-start";
  }
  wrap.className = cls;
  chatMessagesContainer.appendChild(wrap);

  if (!isLocalUser) bumpUnread();
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
};

// ─── Player-left handling ─────────────────────────────────────────────────────
const handleRemotePlayerLeft = async (leaverName = "The other player") => {
  try {
    getGameUIElements();
    if (leftModalMsg) leftModalMsg.textContent = `${leaverName} left the game.`;
    if (leftModal) leftModal.classList.remove("hidden");
    setTimeout(() => { if (leftModal) leftModal.classList.add("hidden"); goHome(); }, 2000);
    if (gameId) {
      await updateDoc(doc(db, "artifacts", APP_ID, "public", "data", "games", gameId), { playerLeft: null });
    }
  } catch (e) { console.warn("Could not clear playerLeft:", e); }
};

// ─── State Handlers ───────────────────────────────────────────────────────────
const handleWaitingState = () => {
  showScreen('welcome-screen');
  waitingInline.classList.remove('hidden');
  clearInterval(timerInterval);
  if (timerDisplayTop) timerDisplayTop.textContent = '--:--';
  roomIdSpanInline.textContent = gameId || '';
  lastRenderedChatLen  = 0;
  lastRenderedGuessLen = 0;

  const players = gameData.players || [];
  if (players.length === 2) {
    playerStatusInline.textContent = 'A friend has joined! Starting game…';
    if (!triedStart && gameData.state === 'waiting') {
      triedStart = true;
      startGame().finally(() => setTimeout(() => { triedStart = false; }, 2000));
    }
  } else {
    playerStatusInline.textContent = 'Waiting for a second player to join…';
  }
};

let lastTurnKey = '';
const handlePlayingState = () => {
  if (isMobile()) closeChat();
  waitingInline.classList.add('hidden');
  showScreen(GAME_SCREEN_ID);
  getGameUIElements();
  setupCanvas();
  requestAnimationFrame(() => setupCanvas());

  // Fix #3: reset _bound so listeners re-attach on new game
  addGameEventListeners();

  if (gameInfoEl) gameInfoEl.classList.remove("hidden");
  updateUIForTurn();
  updateScoreDisplay();

  const turnKey = `${gameData.round}:${gameData.currentPlayer}`;
  if (lastTurnKey !== turnKey) {
    lastTurnKey = turnKey;
    clearCanvas();
    sfx.newTurn();
    pendingStrokes = []; // discard any lingering strokes from last turn
  }
  redrawCanvas(gameData.strokes || []);

  clearInterval(timerInterval);
  if (gameData.word) {
    runTimer(gameData.turnEndsAt, handleTurnTimeout);
  } else {
    runTimer(gameData.wordPickEndsAt, async () => {
      // Fix #2: only drawer calls timeout
      if (gameData.currentPlayer === user.uid && !gameData.word) {
        const choices = gameData.wordChoices || [];
        if (choices.length) await chooseWord(choices[Math.floor(Math.random() * choices.length)]);
      }
    });
  }
};

const handleFinishedState = () => {
  // Flush any pending strokes before finishing
  if (pendingStrokes.length) flushStrokes();
  clearCanvas();
  sessionStorage.removeItem('gtd_game'); // Fix #12: clear session on game end
  const sorted = [...gameData.players].sort((a, b) => b.score - a.score);
  if (sorted.length >= 2)
    finalScoresEl.textContent = `🥇 ${sorted[0].name} (${sorted[0].score} pts) • 🥈 ${sorted[1].name} (${sorted[1].score} pts)`;
  else if (sorted.length === 1)
    finalScoresEl.textContent = `Winner: ${sorted[0].name} (${sorted[0].score} pts)`;
  else
    finalScoresEl.textContent = "No players found.";
  clearInterval(timerInterval);
  if (timerDisplayTop) timerDisplayTop.textContent = "--:--";
  if (endGameModal) endGameModal.classList.remove("hidden");
};

// ─── Timer ────────────────────────────────────────────────────────────────────
let lastTickSecond = -1;
const runTimer = (deadline, onExpire) => {
  clearInterval(timerInterval);
  const total = Math.max(0, (deadline || 0) - Date.now());
  const tick = () => {
    const remaining = Math.max(0, (deadline || 0) - Date.now());
    const elapsed   = total - remaining;
    const secs      = Math.ceil(remaining / 1000);

    timerDisplayTop.textContent = formatSeconds(remaining);
    const pct = total ? 100 - Math.floor((remaining / total) * 100) : 0;
    if (progressEl) progressEl.style.width = `${pct}%`;

    // Fix #2: only drawer triggers letter reveals
    if (gameData?.word && gameData.currentPlayer === user.uid) {
      const hintsDue = Math.floor(elapsed / 20000);
      const revealed = gameData.revealedLetters || [];
      if (hintsDue > revealed.length && !isRevealing) {
        isRevealing = true;
        revealLetter();
      }
    }

    // Tick sound in last 10 seconds — Fix #7
    if (secs <= 10 && secs !== lastTickSecond && remaining > 0) {
      lastTickSecond = secs;
      sfx.tick();
    }

    if (remaining <= 0) {
      clearInterval(timerInterval);
      if (progressEl) progressEl.style.width = "100%";
      lastTickSecond = -1;
      onExpire?.();
    }
  };
  tick();
  timerInterval = setInterval(tick, 200);
};

// Fix #2: only the drawer (currentPlayer) runs the timeout transaction
const handleTurnTimeout = async () => {
  if (!gameData || gameData.currentPlayer !== user.uid) return;
  try {
    await runTransaction(db, async (tx) => {
      const ref  = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.state !== "playing" || (d.turnEndsAt && Date.now() < d.turnEndsAt)) return;

      const players = d.players || [];
      const curr    = d.currentPlayer;
      const next    = players.find(p => p.id !== curr)?.id;
      if (!next) return;

      let newRound = d.round;
      if (next === players[0].id) newRound++;

      if (newRound > MAX_ROUNDS) {
        tx.update(ref, { state: "finished", scores: players.map(p => ({ name: p.name, score: p.score })) });
        return;
      }

      const choices       = pickChoices(WORDS, d.usedWords || [], 3, WORDS_BY_DIFFICULTY);
      const revealWord    = d.word || "(no word chosen)";
      const lastGuesserName = d.lastGuesser?.name || "No one";

      tx.update(ref, {
        currentPlayer: next,
        word: null,
        wordChoices: choices,
        round: newRound,
        strokes: [],
        wordPickEndsAt: Date.now() + WORD_PICK_MS,
        turnEndsAt: null,
        revealedLetters: [],
        lastGuesser: null,
        skipsUsed: {},
        chat: arrayUnion({ id: "system", name: "", text: `⏰ Time's up! The word was "<strong>${revealWord}</strong>". Last guess by ${lastGuesserName}.`, timestamp: Date.now() })
      });
    });
  } catch (e) { console.error("Timeout tx failed:", e); }
};

// ─── Navigation ───────────────────────────────────────────────────────────────
const goHome = async () => {
  // Flush remaining strokes before leaving
  if (pendingStrokes.length) await flushStrokes();

  try {
    if (gameId) {
      const ref = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const d  = snap.data();
        const me = (d.players || []).find(p => p.id === user?.uid);
        const remaining = (d.players || []).filter(p => p.id !== user?.uid);
        if (me) {
          tx.update(ref, {
            players: remaining,
            playerLeft: me.name || "A player",
            chat: arrayUnion({ id: "system", name: "System", text: `${me.name || "A player"} left the room.`, timestamp: Date.now() })
          });
        }
      });
    }
  } catch (e) { console.warn("Could not update room on leave:", e); }

  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  clearInterval(timerInterval);
  clearCanvas();
  pendingStrokes = [];
  sessionStorage.removeItem('gtd_game'); // Fix #12

  // Fix #3: reset listener gate so the next game attaches correctly
  addGameEventListeners._bound = false;
  lastTurnKey = '';
  lastRenderedChatLen  = 0;
  lastRenderedGuessLen = 0;

  if (timerDisplayTop) timerDisplayTop.textContent  = "--:--";
  if (turnIndicatorTop) turnIndicatorTop.textContent = "—";
  if (roundNumberTop)   roundNumberTop.textContent   = "_ /3";
  gameData = null;
  gameId   = null;
  if (chatMessagesContainer) chatMessagesContainer.innerHTML = "";
  if (joinRoomInput) joinRoomInput.value = "";
  statusMessage.textContent = "";
  showScreen("welcome-screen");
  waitingInline.classList.add('hidden');
  roomIdSpanInline.textContent  = '';
  playerStatusInline.textContent = 'Waiting for a second player to join…';
};

// Fix #14: Play Again goes to a "rematch" waiting state without re-entering room ID
const resetGame = async () => {
  if (pendingStrokes.length) await flushStrokes();
  await runTransaction(db, async (tx) => {
    const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
    const gameDoc = await tx.get(gameRef);
    if (!gameDoc.exists()) return;
    const players = gameDoc.data().players.map(p => ({ ...p, score: 0 }));
    tx.update(gameRef, {
      players,
      state: "waiting",
      currentPlayer: null,
      word: null,
      wordChoices: [],
      usedWords: [],
      round: 0,
      strokes: [],
      chat: [],
      guesses: [],
      playerLeft: null,
      skipsUsed: {},
      wordPickEndsAt: null,
      turnEndsAt: null,
      lastGuesser: null
    });
  });
};

// ─── Event Listeners ──────────────────────────────────────────────────────────
const addGameEventListeners = () => {
  // Fix #3: _bound is reset in goHome() so new games re-attach cleanly
  if (addGameEventListeners._bound) return;
  addGameEventListeners._bound = true;

  if (brushSizeInput) brushSizeInput.addEventListener("input", e => { brushSize = +e.target.value || 5; });
  if (brushColorInput) {
    brushColorInput.addEventListener("click", () => { isErasing = false; eraserBtn?.classList.remove('active'); brushBtn?.classList.add('active'); });
    brushColorInput.addEventListener("input", e => { isErasing = false; brushColor = e.target.value || "#000000"; });
  }
  if (clearCanvasBtn) clearCanvasBtn.addEventListener("click", async () => {
    if (!gameData || gameData.currentPlayer !== user.uid) return;
    pendingStrokes = [];
    await updateDoc(doc(db, "artifacts", APP_ID, "public", "data", "games", gameId), { strokes: [] });
    clearCanvas();
  });

  if (skipWordBtn) skipWordBtn.addEventListener("click", skipWord);
  if (submitGuessBtn) submitGuessBtn.addEventListener("click", submitGuess);
  if (guessInput) guessInput.addEventListener("keydown", e => { if (e.key === "Enter") submitGuess(); });
  if (sendChatBtn) sendChatBtn.addEventListener("click", () => sendChatMessage(chatInput.value));
  if (chatInput) chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChatMessage(chatInput.value); });

  if (playAgainBtn) playAgainBtn.addEventListener("click", async () => {
    if (endGameModal) endGameModal.classList.add("hidden");
    clearCanvas();
    lastRenderedChatLen  = 0;
    lastRenderedGuessLen = 0;
    if (chatMessagesContainer) chatMessagesContainer.innerHTML = "";
    await resetGame();
    // Fix #14: stay in game + show waiting state (Firestore snapshot will handle it)
  });

  if (leftOkBtn)    leftOkBtn.addEventListener("click", () => leftModal?.classList.add("hidden"));
  if (homeBtnModal) homeBtnModal.addEventListener("click", goHome);

  window.addEventListener("beforeunload", () => {
    if (!gameId || !user) return;
    if (pendingStrokes.length) flushStrokes(); // best-effort flush on unload
    updateDoc(doc(db, "artifacts", APP_ID, "public", "data", "games", gameId), {
      playerLeft: username || "A player"
    });
  });

  if (undoBtn)   undoBtn.addEventListener("click", undoLastStroke);
  if (eraserBtn) eraserBtn.addEventListener("click", () => {
    isErasing = true;
    eraserBtn.classList.add('active');
    brushBtn?.classList.remove('active');
  });
  if (brushBtn) brushBtn.addEventListener("click", () => {
    isErasing = false;
    brushBtn.classList.add('active');
    eraserBtn?.classList.remove('active');
  });

  if (canvas) {
    const handleDrawing = (e) => {
      if (canDrawNow()) e.preventDefault();
      const t = e.type;
      if      (t === "mousedown"  || t === "touchstart") startDrawing(e);
      else if (t === "mousemove"  || t === "touchmove")  draw(e);
      else if (t === "mouseup"    || t === "mouseout" || t === "touchend") stopDrawing();
    };
    canvas.addEventListener("mousedown",  handleDrawing);
    canvas.addEventListener("mousemove",  handleDrawing);
    canvas.addEventListener("mouseup",    handleDrawing);
    canvas.addEventListener("mouseout",   handleDrawing);
    canvas.addEventListener("touchstart", handleDrawing, { passive: false });
    canvas.addEventListener("touchmove",  handleDrawing, { passive: false });
    canvas.addEventListener("touchend",   handleDrawing, { passive: false });

    const cursorDot = document.getElementById("cursor-dot");
    if (cursorDot) {
      canvas.addEventListener("pointerenter",  () => { cursorDot.style.display = "block"; });
      canvas.addEventListener("pointerleave",  () => { cursorDot.style.display = "none"; });
      canvas.addEventListener("pointermove",   e  => { cursorDot.style.left = `${e.clientX}px`; cursorDot.style.top = `${e.clientY}px`; });
      canvas.addEventListener("touchstart",    () => { cursorDot.style.display = "none"; }, { passive: true });
    }
  }

  // Fix #4: guard resize — don't re-setup if keyboard shown/hidden mid-turn
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => setupCanvas(), 150);
  });

  if (chatToggle)   chatToggle.addEventListener('click', openChat);
  if (chatClose)    chatClose.addEventListener('click', closeChat);
  if (chatBackdrop) chatBackdrop.addEventListener('click', closeChat);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });
};

const undoLastStroke = async () => {
  if (!gameData || gameData.currentPlayer !== user.uid) return;
  // Flush pending before undoing so we don't undo something not yet synced
  if (pendingStrokes.length) { await flushStrokes(); }
  const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
  try {
    await runTransaction(db, async (tx) => {
      const gameDoc = await tx.get(gameRef);
      if (!gameDoc.exists()) return;
      const strokes = gameDoc.data().strokes || [];
      if (strokes.length > 0) tx.update(gameRef, { strokes: strokes.slice(0, -1) });
    });
  } catch (e) { console.error("Undo tx error:", e); }
};

const wireCopy = (btnId, sourceTextId, tipId) => {
  const btn    = document.getElementById(btnId);
  const source = document.getElementById(sourceTextId);
  const tip    = tipId ? document.getElementById(tipId) : null;
  if (!btn || !source) return;
  btn.addEventListener("click", () => {
    const text = (source.textContent || "").trim();
    if (!text) { statusMessage.textContent = "No Room ID yet."; return; }
    navigator.clipboard.writeText(text).then(() => {
      if (tip) {
        tip.classList.remove("opacity-0");
        setTimeout(() => tip.classList.add("opacity-0"), 900);
      } else { statusMessage.textContent = "Room ID copied!"; }
    }).catch(() => { statusMessage.textContent = "Copy failed — copy it manually."; });
  });
};

const addInitialEventListeners = () => {
  createRoomBtn.addEventListener("click", async () => {
    username = usernameInput.value.trim();
    if (!username) { statusMessage.textContent = "Please enter your name."; return; }
    gameId = crypto.randomUUID().substring(0, 8);
    const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
    try {
      await setDoc(gameRef, {
        players: [{ id: user.uid, name: username, score: 0 }],
        state: "waiting",
        createdAt: Date.now(),
        owner: user.uid,
        guesses: [],
        skipsUsed: {},
        version: 1
      });
      waitingInline.classList.remove('hidden');
      roomIdSpanInline.textContent   = gameId;
      playerStatusInline.textContent = 'Waiting for a second player to join…';
      setupFirestoreListener();
    } catch (e) {
      statusMessage.textContent = "Error creating room.";
      console.error(e);
    }
  });

  wireCopy("copy-btn", "room-id");
  wireCopy("copy-btn-inline", "room-id-inline", "copy-tip");

  joinRoomBtn.addEventListener("click", async () => {
    username = usernameInput.value.trim();
    gameId   = joinRoomInput.value.trim();
    if (!username || !gameId) { statusMessage.textContent = "Please enter your name and a Room ID."; return; }
    const gameRef = doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);
    try {
      await runTransaction(db, async (tx) => {
        const gameDoc = await tx.get(gameRef);
        if (!gameDoc.exists()) throw new Error("Game does not exist!");
        const players = gameDoc.data().players || [];
        if (players.length >= 2) throw new Error("Room is full!");
        tx.update(gameRef, { players: arrayUnion({ id: user.uid, name: username, score: 0 }) });
      });
      waitingInline.classList.remove('hidden');
      roomIdSpanInline.textContent   = gameId;
      playerStatusInline.textContent = 'Waiting for a second player to join…';
      setupFirestoreListener();
    } catch (e) {
      statusMessage.textContent = e.message || "Failed to join room.";
      console.error(e);
    }
  });
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.onload = () => {
  showScreen("welcome-screen");
  initializeAuthAndUI();
  addInitialEventListeners();
};
