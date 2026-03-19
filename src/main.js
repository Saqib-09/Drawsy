// main.js — Multiplayer "Guess the Drawing"
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, runTransaction, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
  TURN_MS, WORD_PICK_MS, MAX_ROUNDS, MAX_STROKES, STROKE_FLUSH_MS,
  MIN_PLAYERS, MAX_PLAYERS, FIREBASE_CONFIG, APP_ID, INITIAL_AUTH_TOKEN,
  WORDS, SCORING_TIERS, LATE_GUESSER_MULT, DRAWER_POINTS_MULT,
  MODE_FFA, MODE_TEAMS, TEAM_COLORS
} from "./constants.js";
import { getCoordinates, pickChoices, formatSeconds, isCloseGuess, buildDrawOrder, debounce } from "./helpers.js";

// ─── Firebase ──────────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const db   = getFirestore(app);
const auth = getAuth(app);

// ─── Welcome-screen DOM ────────────────────────────────────────────────────────
const createRoomBtn      = document.getElementById("create-room-btn");
const joinRoomBtn        = document.getElementById("join-room-btn");
const joinRoomInput      = document.getElementById("join-room-input");
const usernameInput      = document.getElementById("username-input");
const statusMessage      = document.getElementById("status-message");
const waitingInline      = document.getElementById('waiting-inline');
const roomIdSpanInline   = document.getElementById('room-id-inline');
const copyBtnInline      = document.getElementById('copy-btn-inline');
const copyTip            = document.getElementById('copy-tip');
const playerStatusInline = document.getElementById('player-status-inline');
const lobbyPlayerList    = document.getElementById('lobby-player-list');
const lobbyModeSelect    = document.getElementById('lobby-mode-select');
const lobbyTeamSetup     = document.getElementById('lobby-team-setup');
const lobbyStartBtn      = document.getElementById('lobby-start-btn');
const chatToggle         = document.getElementById('chat-toggle');
const chatClose          = document.getElementById('chat-close');
const chatBackdrop       = document.getElementById('chat-backdrop');
const chatBadge          = document.getElementById('chat-badge');

const GAME_SCREEN_ID = "game-play-area";

// ─── Gameplay DOM (lazy) ────────────────────────────────────────────────────────
let gameInfoEl, turnIndicatorTop, roundNumberTop, timerDisplayTop, progressEl;
let canvas, ctx, drawingControls, guessingControls, wordToDrawEl;
let brushSizeInput, brushColorInput, clearCanvasBtn, undoBtn, eraserBtn, brushBtn;
let guessInput, submitGuessBtn, guessStatusEl, chatInput, sendChatBtn, chatMessagesContainer;
let endGameModal, finalScoresEl, playAgainBtn, leftModal, leftOkBtn, homeBtnModal, leftModalMsg;
let teamBannerEl, playerRosterEl;

const getGameUIElements = () => {
  gameInfoEl       = document.getElementById("game-info");
  turnIndicatorTop = document.getElementById("turn-indicator");
  roundNumberTop   = document.getElementById("round-number");
  timerDisplayTop  = document.getElementById("turn-timer");
  progressEl       = document.getElementById("turn-progress");
  canvas           = document.getElementById("drawing-canvas");
  ctx              = canvas?.getContext("2d") ?? null;
  drawingControls  = document.getElementById("drawing-controls");
  guessingControls = document.getElementById("guessing-controls");
  wordToDrawEl     = document.getElementById("word-to-draw");
  brushSizeInput   = document.getElementById("brush-size");
  brushColorInput  = document.getElementById("brush-color");
  clearCanvasBtn   = document.getElementById("clear-canvas-btn");
  undoBtn          = document.getElementById("undo-btn");
  eraserBtn        = document.getElementById("eraser-btn");
  brushBtn         = document.getElementById("brush-btn");
  guessInput       = document.getElementById("guess-input");
  submitGuessBtn   = document.getElementById("submit-guess-btn");
  guessStatusEl    = document.getElementById("guess-status");
  chatInput        = document.getElementById("chat-input");
  sendChatBtn      = document.getElementById("send-chat-btn");
  chatMessagesContainer = document.getElementById("chat-messages");
  endGameModal     = document.getElementById("end-game-modal");
  finalScoresEl    = document.getElementById("final-scores");
  playAgainBtn     = document.getElementById("play-again-btn");
  leftModal        = document.getElementById("left-modal");
  leftOkBtn        = document.getElementById("left-ok-btn");
  homeBtnModal     = document.getElementById("home-btn-modal");
  leftModalMsg     = document.getElementById("left-modal-msg");
  teamBannerEl     = document.getElementById("team-banner");
  playerRosterEl   = document.getElementById("player-roster");
};

// ─── Game State ────────────────────────────────────────────────────────────────
let unsubscribeGame     = null;
let gameId              = null;
let user                = null;
let username            = null;
let gameData            = null;
let triedStart          = false;
let lastPlayerLeftSeen  = null;
let lastTurnKey         = '';
let lastChatLen         = 0;

let timerInterval = null;
let isDrawing     = false;
let currentStroke = [];
let lastPosition  = { x: 0, y: 0 };
let brushColor    = "#000000";
let brushSize     = 5;
const ERASER_SIZE = 20;
let isErasing     = false;
let isRevealing   = false;
let lastTickSec   = -1;

// Batched stroke buffer
let pendingStrokes   = [];
const scheduleFlush  = debounce(flushStrokes, STROKE_FLUSH_MS);

// ─── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx = null;
const ac = () => { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; };
const tone = (freq, type, dur, vol = 0.3, delay = 0) => {
  try {
    const ctx  = ac(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    g.gain.setValueAtTime(vol, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + dur);
  } catch (_) {}
};
const sfx = {
  correct : () => { tone(523,'sine',0.12,0.35); tone(659,'sine',0.12,0.35,0.12); tone(784,'sine',0.25,0.35,0.24); },
  wrong   : () => { tone(200,'square',0.12,0.15); },
  close   : () => { tone(660,'triangle',0.08,0.2); tone(440,'triangle',0.08,0.2,0.08); },
  tick    : () => { tone(880,'sine',0.05,0.1); },
  newTurn : () => { tone(440,'sine',0.08,0.2); tone(550,'sine',0.15,0.2,0.1); },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const isMobile  = () => window.matchMedia('(max-width:767.98px)').matches;
const gameRef   = () => doc(db, "artifacts", APP_ID, "public", "data", "games", gameId);

/** Which team (if any) does a uid belong to? */
const teamOf = (uid) => (gameData?.teams || []).find(t => (t.members || []).includes(uid));

/** In Teams mode, can this player guess right now? */
const canGuesNow = () => {
  if (!gameData || gameData.currentPlayer === user.uid) return false;
  if (!gameData.word) return false;
  if (gameData.mode === MODE_TEAMS) {
    const myTeam     = teamOf(user.uid);
    const drawerTeam = teamOf(gameData.currentPlayer);
    // You can only guess if you're on the SAME team as the drawer
    // and NOT the drawer themselves
    if (!myTeam || !drawerTeam) return false;
    return myTeam.id === drawerTeam.id;
  }
  return true; // FFA: anyone non-drawer can guess
};

/** Has this player already guessed correctly this turn? */
const alreadyGuessed = () => !!(gameData?.guessedBy || {})[user.uid];

// ─── Screen Switching ──────────────────────────────────────────────────────────
const screens = document.querySelectorAll('#screens > div, #screens > section');
const showScreen = (id) => {
  screens.forEach(s => s.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
  document.getElementById("topbar")?.classList.toggle("hidden", id !== GAME_SCREEN_ID);
};

// ─── Auth ──────────────────────────────────────────────────────────────────────
const initializeAuthAndUI = async () => {
  statusMessage.textContent = "Connecting…";
  createRoomBtn.disabled = joinRoomBtn.disabled = true;
  try {
    const r = INITIAL_AUTH_TOKEN
      ? await signInWithCustomToken(auth, INITIAL_AUTH_TOKEN)
      : await signInAnonymously(auth);
    user = r.user;
    statusMessage.textContent = "Ready! Enter your name to begin.";
    createRoomBtn.disabled = joinRoomBtn.disabled = false;
  } catch (e) {
    statusMessage.textContent = "Failed to connect. Refresh and try again.";
    console.error(e);
  }
};

// ─── Lobby helpers ─────────────────────────────────────────────────────────────
const renderLobby = () => {
  if (!gameData || !lobbyPlayerList) return;
  const players = gameData.players || [];
  const isOwner = gameData.owner === user.uid;
  const mode    = gameData.mode || MODE_FFA;
  const teams   = gameData.teams || TEAM_COLORS.map(c => ({ ...c, members: [] }));

  // Player list
  lobbyPlayerList.innerHTML = players.map(p => {
    const isMe   = p.id === user.uid;
    const myTeam = (teams).find(t => (t.members || []).includes(p.id));
    const badge  = myTeam ? `<span class="team-badge border" style="background:${myTeam.bg};color:${myTeam.text};border-color:${myTeam.border}">${myTeam.label}</span>` : '';
    return `<div class="lobby-player ${isMe ? 'lobby-player-me' : ''}">
      <span class="font-semibold">${p.name}${isMe ? ' (you)' : ''}</span>
      ${badge}
      ${isOwner && mode === MODE_TEAMS && !isMe ? `
        <div class="flex gap-1 ml-auto">
          ${teams.map(t => `<button onclick="assignTeam('${p.id}','${t.id}')"
            class="team-assign-btn ${(t.members||[]).includes(p.id) ? 'active' : ''}"
            style="${(t.members||[]).includes(p.id) ? `background:${t.bg};border-color:${t.border};color:${t.text}` : ''}"
            >${t.label.split(' ')[0]}</button>`).join('')}
        </div>` : ''}
    </div>`;
  }).join('');

  // Mode selector (owner only)
  if (lobbyModeSelect) {
    lobbyModeSelect.value = mode;
    lobbyModeSelect.disabled = !isOwner;
  }

  // Team setup section
  if (lobbyTeamSetup) {
    lobbyTeamSetup.classList.toggle('hidden', mode !== MODE_TEAMS);
  }

  // Start button
  if (lobbyStartBtn) {
    lobbyStartBtn.classList.toggle('hidden', !isOwner);
    const canStart = players.length >= MIN_PLAYERS &&
      (mode !== MODE_TEAMS || teamsValid(players, teams));
    lobbyStartBtn.disabled = !canStart;
    lobbyStartBtn.title = canStart ? '' :
      mode === MODE_TEAMS ? 'Assign all players to a team first' : `Need at least ${MIN_PLAYERS} players`;
  }

  playerStatusInline.textContent =
    players.length < MIN_PLAYERS
      ? `Waiting for players… (${players.length}/${MIN_PLAYERS} minimum)`
      : `${players.length} player${players.length !== 1 ? 's' : ''} in lobby`;
};

const teamsValid = (players, teams) => {
  // Every player must be assigned to a team, and each team must have ≥1 member
  const assigned = players.every(p => teams.some(t => (t.members || []).includes(p.id)));
  const allPopulated = teams.every(t => (t.members || []).length >= 1);
  return assigned && allPopulated;
};

// Exposed globally for inline onclick
window.assignTeam = async (uid, teamId) => {
  if (gameData?.owner !== user.uid) return;
  await runTransaction(db, async tx => {
    const snap = await tx.get(gameRef());
    if (!snap.exists()) return;
    const d     = snap.data();
    const teams = (d.teams || TEAM_COLORS.map(c => ({ ...c, members: [] }))).map(t => ({
      ...t,
      members: t.id === teamId
        ? [...new Set([...(t.members || []), uid])]  // add to target
        : (t.members || []).filter(m => m !== uid)   // remove from others
    }));
    tx.update(gameRef(), { teams });
  });
};

// ─── Game Flow ─────────────────────────────────────────────────────────────────
const startGame = async () => {
  await runTransaction(db, async tx => {
    const snap = await tx.get(gameRef());
    if (!snap.exists()) throw new Error("Game missing");
    const d = snap.data();
    if (d.state !== "waiting") return;
    if ((d.players || []).length < MIN_PLAYERS) throw new Error("Not enough players");

    const mode   = d.mode || MODE_FFA;
    const teams  = d.teams || [];
    const order  = buildDrawOrder(d.players, mode, teams);
    const choices = pickChoices(WORDS, d.usedWords || []);

    tx.update(gameRef(), {
      state: "playing",
      mode,
      teams,
      drawOrder: order,
      drawOrderIndex: 0,
      currentPlayer: order[0],
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
      guessedBy: {},       // uid → true (who has guessed correctly)
      firstGuesser: null,  // uid of first correct guesser this turn
    });
  }).catch(err => {
    console.error("Start failed:", err);
    statusMessage.textContent = err.message;
  });
};

const nextTurn = async () => {
  await runTransaction(db, async tx => {
    const snap = await tx.get(gameRef());
    if (!snap.exists()) return;
    const d       = snap.data();
    const order   = d.drawOrder || [];
    const idx     = d.drawOrderIndex ?? 0;
    const nextIdx = (idx + 1) % order.length;
    const nextId  = order[nextIdx];

    // A full cycle completes when we wrap back to index 0
    let newRound = d.round;
    if (nextIdx === 0) newRound++;

    if (newRound > MAX_ROUNDS) {
      tx.update(gameRef(), { state: "finished", scores: (d.players || []).map(p => ({ name: p.name, score: p.score, team: teamOf_data(p.id, d) })) });
      return;
    }

    const choices = pickChoices(WORDS, d.usedWords || []);
    tx.update(gameRef(), {
      drawOrderIndex: nextIdx,
      currentPlayer: nextId,
      word: null,
      wordChoices: choices,
      round: newRound,
      strokes: [],
      wordPickEndsAt: Date.now() + WORD_PICK_MS,
      turnEndsAt: null,
      revealedLetters: [],
      lastGuesser: null,
      guessedBy: {},
      firstGuesser: null,
    });
  });
};

// Pure-data version of teamOf (no global gameData dependency)
const teamOf_data = (uid, d) => (d.teams || []).find(t => (t.members || []).includes(uid));

const chooseWord = async (selected) => {
  if (!gameData || gameData.currentPlayer !== user.uid) return;
  await runTransaction(db, async tx => {
    const snap = await tx.get(gameRef());
    if (!snap.exists()) return;
    const d = snap.data();
    if (!(d.wordChoices || []).includes(selected)) return;
    tx.update(gameRef(), {
      word: selected,
      usedWords: arrayUnion(selected),
      wordPickEndsAt: null,
      turnEndsAt: Date.now() + TURN_MS,
      revealedLetters: []
    });
  });
  sfx.newTurn();
};

const revealLetter = async () => {
  if (!gameData?.word || gameData.state !== "playing") { isRevealing = false; return; }
  const word      = gameData.word;
  const revealed  = gameData.revealedLetters || [];
  const unrevealed = [...Array(word.length).keys()].filter(i => !revealed.includes(i));
  if (unrevealed.length) {
    try {
      await updateDoc(gameRef(), { revealedLetters: arrayUnion(unrevealed[Math.floor(Math.random() * unrevealed.length)]) });
    } finally { isRevealing = false; }
  } else { isRevealing = false; }
};

const submitGuess = async () => {
  if (!canGuesNow() || alreadyGuessed()) return;
  if (!gameData.word) { if (guessStatusEl) guessStatusEl.textContent = "Word not chosen yet!"; return; }

  const guess       = (guessInput?.value || '').trim().toLowerCase();
  if (!guess) return;
  if (guessInput) guessInput.value = '';
  if (guessStatusEl) guessStatusEl.textContent = '';

  const correctWord = gameData.word.toLowerCase();
  const guesser     = gameData.players.find(p => p.id === user.uid);
  if (!guesser) return;

  if (guess === correctWord) {
    // ── Correct ──────────────────────────────────────────────────────────────
    sfx.correct();
    const guesserId      = user.uid;
    const drawerId       = gameData.currentPlayer;
    const timeElapsed    = Date.now() - (gameData.turnEndsAt - TURN_MS);
    let basePoints       = 0;
    for (const tier of SCORING_TIERS) if (timeElapsed <= tier.time) { basePoints = tier.points; break; }

    const isFirst     = !gameData.firstGuesser;
    const guesserPts  = Math.round(basePoints * (isFirst ? 1 : LATE_GUESSER_MULT));
    const drawerPts   = isFirst ? Math.round(basePoints * DRAWER_POINTS_MULT) : 0;

    await runTransaction(db, async tx => {
      const snap = await tx.get(gameRef());
      if (!snap.exists()) return;
      const d           = snap.data();
      if ((d.guessedBy || {})[guesserId]) return; // race: already guessed

      const updatedPlayers = (d.players || []).map(p => {
        if (p.id === guesserId) return { ...p, score: p.score + guesserPts };
        if (p.id === drawerId)  return { ...p, score: p.score + drawerPts };
        return p;
      });

      // In FFA: check if all non-drawers have now guessed — if so, advance turn
      const nonDrawers       = (d.players || []).filter(p => p.id !== drawerId);
      const newGuessedBy     = { ...(d.guessedBy || {}), [guesserId]: true };
      const allGuessed       = nonDrawers.every(p => newGuessedBy[p.id]);

      // In Teams mode: only 1 guesser per turn (the teammate)
      const shouldAdvance    = allGuessed || d.mode === MODE_TEAMS;

      tx.update(gameRef(), {
        players: updatedPlayers,
        guessedBy: newGuessedBy,
        firstGuesser: d.firstGuesser || guesserId,
        chat: arrayUnion({ id: "system", name: "", text: `✅ <strong>${guesser.name}</strong> guessed it! (+${guesserPts} pts)`, timestamp: Date.now() }),
        ...(shouldAdvance ? { word: "__advance__" } : {}) // sentinel to trigger nextTurn
      });
    }).then(async () => {
      // Check if we should advance the turn
      const fresh = await new Promise(res => {
        const u = onSnapshot(gameRef(), s => { u(); res(s.data()); });
      });
      if (fresh?.word === "__advance__") await nextTurn();
    }).catch(e => console.error("Guess tx:", e));
  } else {
    // ── Wrong ────────────────────────────────────────────────────────────────
    const close = isCloseGuess(guess, correctWord);
    if (close) { sfx.close(); if (guessStatusEl) { guessStatusEl.textContent = "🔥 So close!"; setTimeout(() => { if(guessStatusEl) guessStatusEl.textContent = ''; }, 2000); } }
    else sfx.wrong();

    await updateDoc(gameRef(), {
      lastGuesser: { id: user.uid, name: guesser.name },
      chat: arrayUnion({ id: user.uid, name: guesser.name, text: `❌ ${guess}${close ? ' 🔥' : ''}`, isIncorrect: true, timestamp: Date.now() })
    });
  }
};

// ─── Canvas ────────────────────────────────────────────────────────────────────
const drawLine = (x1, y1, x2, y2, color, size, erase = false) => {
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle  = erase ? 'rgba(0,0,0,1)' : color;
  ctx.lineWidth    = size; ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.closePath();
  ctx.restore();
};

const canDrawNow = () =>
  !!gameData && gameData.state === "playing" && !!gameData.word &&
  gameData.currentPlayer === user.uid && Date.now() < (gameData.turnEndsAt || 0);

const startDrawing = e => {
  if (!canDrawNow()) return;
  isDrawing = true;
  const { x, y } = getCoordinates(e, canvas);
  lastPosition = { x, y }; currentStroke = [{ x, y }]; e.preventDefault();
};

const draw = e => {
  if (!isDrawing || !canDrawNow()) return;
  const { x, y }   = getCoordinates(e, canvas);
  const erase        = isErasing;
  const col          = erase ? null : brushColor;
  const sz           = erase ? ERASER_SIZE : brushSize;
  currentStroke.push({ x, y });
  drawLine(lastPosition.x, lastPosition.y, x, y, col, sz, erase);
  lastPosition = { x, y };
  if (currentStroke.length >= MAX_STROKES) {
    pendingStrokes.push({ points: [...currentStroke], color: col, size: sz, erase }); scheduleFlush();
    currentStroke = [{ x, y }];
  }
  e.preventDefault();
};

const stopDrawing = () => {
  if (!isDrawing) return;
  if (currentStroke.length > 0 && canDrawNow()) {
    const erase = isErasing;
    pendingStrokes.push({ points: [...currentStroke], color: erase ? null : brushColor, size: erase ? ERASER_SIZE : brushSize, erase });
    scheduleFlush();
  }
  isDrawing = false; currentStroke = [];
};

const redrawCanvas = strokes => {
  clearCanvas();
  (strokes || []).forEach(s => {
    if (s.points?.length > 1)
      for (let i = 1; i < s.points.length; i++)
        drawLine(s.points[i-1].x, s.points[i-1].y, s.points[i].x, s.points[i].y, s.color, s.size, s.erase);
  });
};

const clearCanvas = () => ctx && canvas && ctx.clearRect(0, 0, canvas.width, canvas.height);

const setupCanvas = () => {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const r   = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr, dpr);
  if (gameData?.strokes) redrawCanvas(gameData.strokes);
};

async function flushStrokes() {
  if (!pendingStrokes.length || !gameId) return;
  const batch = [...pendingStrokes]; pendingStrokes = [];
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(gameRef());
      if (!snap.exists()) return;
      tx.update(gameRef(), { strokes: [...(snap.data().strokes || []), ...batch] });
    });
  } catch (e) { pendingStrokes = [...batch, ...pendingStrokes]; console.error("Flush:", e); }
}

// ─── Firestore listener ────────────────────────────────────────────────────────
const setupFirestoreListener = () => {
  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  unsubscribeGame = onSnapshot(gameRef(), snap => {
    if (!snap.exists()) return;
    gameData = snap.data();

    const leaver = gameData.playerLeft;
    if (leaver && leaver !== username && leaver !== lastPlayerLeftSeen) {
      lastPlayerLeftSeen = leaver;
      handleRemotePlayerLeft(leaver); return;
    }

    if      (gameData.state === "waiting")  handleWaitingState();
    else if (gameData.state === "playing")  handlePlayingState();
    else if (gameData.state === "finished") handleFinishedState();

    renderChatDelta();
  }, e => console.error("Snapshot error:", e));
};

// ─── Chat ──────────────────────────────────────────────────────────────────────
let chatUnread = 0;
const openChat  = () => { document.body.classList.add('chat-open'); chatUnread = 0; chatBadge?.classList.add('hidden'); chatMessagesContainer && (chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight); };
const closeChat = () => document.body.classList.remove('chat-open');
const bumpUnread = () => {
  if (!isMobile() || document.body.classList.contains('chat-open')) return;
  chatUnread++;
  if (chatBadge) { chatBadge.textContent = String(chatUnread); chatBadge.classList.remove('hidden'); }
};

const sendChatMessage = async text => {
  if (!text?.trim()) return;
  await updateDoc(gameRef(), { chat: arrayUnion({ id: user.uid, name: username, text, timestamp: Date.now() }) });
  if (chatInput) chatInput.value = '';
  if (isMobile() && !document.body.classList.contains('chat-open')) openChat();
};

const renderChatDelta = () => {
  const chat = gameData?.chat || [];
  if (!chatMessagesContainer || chat.length <= lastChatLen) return;
  for (let i = lastChatLen; i < chat.length; i++) {
    const m = chat[i];
    const isMe  = m.id === user.uid;
    const isSystem = !m.name || m.name === "" || m.id === "system";
    const wrap  = document.createElement("div");
    wrap.className = "chat-msg " + (isSystem ? "system-msg" : isMe ? "chat-me self-end" : "chat-them self-start");
    wrap.innerHTML  = isSystem ? m.text : `<span class="font-semibold">${m.name}:</span> ${m.text}`;
    chatMessagesContainer.appendChild(wrap);
    if (!isMe) bumpUnread();
  }
  lastChatLen = chat.length;
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
};

// ─── UI Updates ────────────────────────────────────────────────────────────────
const updateUIForTurn = () => {
  if (!gameData) return;
  const myTurn   = gameData.currentPlayer === user.uid;
  const hasWord  = !!gameData.word;
  const iCanGuess = canGuesNow() && !alreadyGuessed();

  // Drawing vs guessing panels
  drawingControls?.classList.toggle("hidden", !myTurn);
  guessingControls?.classList.toggle("hidden", myTurn || !hasWord || !iCanGuess);

  if (wordToDrawEl) wordToDrawEl.textContent = myTurn && hasWord ? gameData.word : '';
  if (canvas) canvas.style.pointerEvents = myTurn && hasWord ? "auto" : "none";

  // Word choices
  const wcWrap = document.getElementById("word-choices-wrap");
  const wcEl   = document.getElementById("word-choices");
  wcWrap?.classList.toggle("hidden", !myTurn || hasWord);
  if (myTurn && !hasWord && wcEl) {
    wcEl.innerHTML = '';
    (gameData.wordChoices || []).forEach(w => {
      const b = document.createElement("button");
      b.className = "word-chip"; b.textContent = w; b.onclick = () => chooseWord(w);
      wcEl.appendChild(b);
    });
  }

  // Word hint (blanks) for guessers
  const hintEl = document.getElementById("word-hint");
  if (hintEl) {
    if (gameData.word && !myTurn) {
      const revealed = gameData.revealedLetters || [];
      const letters  = gameData.word.split('').map((ch, i) =>
        ch === ' '
          ? `<span class="mx-1 text-gray-300">·</span>`
          : revealed.includes(i)
            ? `<span class="letter-revealed">${ch.toUpperCase()}</span>`
            : `<span class="letter-blank">_</span>`
      );
      hintEl.innerHTML = `<div class="flex flex-wrap justify-center gap-0.5">${letters.join('')}</div><div class="text-xs text-gray-400 mt-1">${gameData.word.length} letters</div>`;
    } else { hintEl.innerHTML = ''; }
  }

  // Already guessed message
  if (guessStatusEl) {
    if (alreadyGuessed() && !myTurn)
      guessStatusEl.textContent = "✅ You got it! Waiting for others…";
    else if (myTurn && hasWord)
      guessStatusEl.textContent = '';
  }

  // Teams mode: show who can guess
  if (gameData.mode === MODE_TEAMS && teamBannerEl) {
    const drawerTeam = teamOf(gameData.currentPlayer);
    const myTeam     = teamOf(user.uid);
    if (drawerTeam) {
      teamBannerEl.style.cssText = `background:${drawerTeam.bg};border-color:${drawerTeam.border};color:${drawerTeam.text}`;
      teamBannerEl.textContent   = myTurn
        ? `You're drawing for ${drawerTeam.label}!`
        : myTeam?.id === drawerTeam.id && !myTurn
          ? `Guess the drawing for ${drawerTeam.label}!`
          : `${drawerTeam.label} is drawing — watch along!`;
      teamBannerEl.classList.remove('hidden');
    }
  } else { teamBannerEl?.classList.add('hidden'); }

  // Top bar
  const drawerName = (gameData.players || []).find(p => p.id === gameData.currentPlayer)?.name || '—';
  if (turnIndicatorTop) turnIndicatorTop.textContent = drawerName;
  if (roundNumberTop)   roundNumberTop.textContent   = `${gameData.round} / ${MAX_ROUNDS}`;

  // Player roster sidebar
  renderPlayerRoster();
};

const renderPlayerRoster = () => {
  if (!playerRosterEl || !gameData) return;
  const players  = gameData.players || [];
  const teams    = gameData.teams   || [];
  const guessedBy = gameData.guessedBy || {};
  playerRosterEl.innerHTML = players.map(p => {
    const isDrawer   = p.id === gameData.currentPlayer;
    const hasGuessed = guessedBy[p.id];
    const myTeam     = teams.find(t => (t.members || []).includes(p.id));
    const teamDot    = myTeam ? `<span class="team-dot" style="background:${myTeam.border}"></span>` : '';
    const icon       = isDrawer ? '✏️' : hasGuessed ? '✅' : '👁️';
    return `<div class="roster-player ${isDrawer ? 'roster-drawing' : ''} ${p.id === user.uid ? 'roster-me' : ''}">
      ${teamDot}<span class="icon">${icon}</span>
      <span class="name truncate">${p.name}</span>
      <span class="score ml-auto font-bold text-indigo-600">${p.score}</span>
    </div>`;
  }).join('');
};

// ─── State Handlers ────────────────────────────────────────────────────────────
const handleWaitingState = () => {
  showScreen('welcome-screen');
  waitingInline?.classList.remove('hidden');
  clearInterval(timerInterval);
  if (roomIdSpanInline) roomIdSpanInline.textContent = gameId || '';
  lastChatLen = 0;
  renderLobby();
};

const handlePlayingState = () => {
  if (isMobile()) closeChat();
  waitingInline?.classList.add('hidden');
  showScreen(GAME_SCREEN_ID);
  getGameUIElements();
  setupCanvas();
  requestAnimationFrame(setupCanvas);
  addGameEventListeners();
  gameInfoEl?.classList.remove("hidden");
  updateUIForTurn();

  const turnKey = `${gameData.round}:${gameData.currentPlayer}`;
  if (lastTurnKey !== turnKey) {
    lastTurnKey = turnKey; clearCanvas(); sfx.newTurn(); pendingStrokes = [];
  }
  redrawCanvas(gameData.strokes || []);

  clearInterval(timerInterval);
  if (gameData.word) {
    runTimer(gameData.turnEndsAt, handleTurnTimeout);
  } else {
    runTimer(gameData.wordPickEndsAt, async () => {
      if (gameData.currentPlayer === user.uid && !gameData.word) {
        const choices = gameData.wordChoices || [];
        if (choices.length) await chooseWord(choices[Math.floor(Math.random() * choices.length)]);
      }
    });
  }
};

const handleFinishedState = () => {
  if (pendingStrokes.length) flushStrokes();
  clearCanvas();
  clearInterval(timerInterval);
  if (timerDisplayTop) timerDisplayTop.textContent = "--";

  const mode   = gameData.mode || MODE_FFA;
  const sorted = [...(gameData.players || [])].sort((a, b) => b.score - a.score);

  if (mode === MODE_TEAMS && gameData.teams?.length) {
    // Team totals
    const teamScores = gameData.teams.map(t => {
      const total = (gameData.players || [])
        .filter(p => (t.members || []).includes(p.id))
        .reduce((s, p) => s + p.score, 0);
      return { ...t, total };
    }).sort((a, b) => b.total - a.total);

    const winner = teamScores[0];
    const tied   = teamScores[0].total === teamScores[1]?.total;

    let html = `<div class="text-xl font-bold mb-3">${tied ? '🤝 It\'s a tie!' : `🏆 ${winner.label} wins!`}</div>`;
    html += teamScores.map((t, i) =>
      `<div class="team-score-row" style="background:${t.bg};border-color:${t.border};color:${t.text}">
        <span>${i === 0 && !tied ? '🥇 ' : i === 1 && !tied ? '🥈 ' : ''}${t.label}</span>
        <span class="font-bold">${t.total} pts</span>
      </div>`
    ).join('');
    html += `<div class="mt-4 text-sm text-gray-500">Individual: ${sorted.map(p => `${p.name} (${p.score})`).join(' · ')}</div>`;
    if (finalScoresEl) finalScoresEl.innerHTML = html;
  } else {
    // FFA leaderboard
    const medals = ['🥇', '🥈', '🥉'];
    if (finalScoresEl) finalScoresEl.innerHTML = sorted.map((p, i) =>
      `<div class="score-row">${medals[i] || `${i+1}.`} <span class="font-semibold">${p.name}</span> — <span class="text-indigo-600 font-bold">${p.score} pts</span></div>`
    ).join('');
  }

  endGameModal?.classList.remove("hidden");
};

// ─── Timer ─────────────────────────────────────────────────────────────────────
const runTimer = (deadline, onExpire) => {
  clearInterval(timerInterval);
  const total = Math.max(0, (deadline || 0) - Date.now());
  const tick = () => {
    const remaining = Math.max(0, (deadline || 0) - Date.now());
    const elapsed   = total - remaining;
    const secs      = Math.ceil(remaining / 1000);
    if (timerDisplayTop) timerDisplayTop.textContent = formatSeconds(remaining);
    if (progressEl) progressEl.style.width = `${total ? 100 - Math.floor((remaining / total) * 100) : 0}%`;

    // Tick in last 10s
    if (secs <= 10 && secs !== lastTickSec && remaining > 0) { lastTickSec = secs; sfx.tick(); }

    // Reveal letters (drawer decides)
    if (gameData?.word && gameData.currentPlayer === user.uid) {
      const due = Math.floor(elapsed / 20000);
      if (due > (gameData.revealedLetters || []).length && !isRevealing) { isRevealing = true; revealLetter(); }
    }

    if (remaining <= 0) {
      clearInterval(timerInterval);
      if (progressEl) progressEl.style.width = "100%";
      lastTickSec = -1;
      onExpire?.();
    }
  };
  tick();
  timerInterval = setInterval(tick, 200);
};

const handleTurnTimeout = async () => {
  // Only the current drawer advances the turn
  if (!gameData || gameData.currentPlayer !== user.uid) return;
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(gameRef());
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.state !== "playing" || (d.turnEndsAt && Date.now() < d.turnEndsAt)) return;

      const order   = d.drawOrder || [];
      const idx     = d.drawOrderIndex ?? 0;
      const nextIdx = (idx + 1) % order.length;
      let newRound  = d.round;
      if (nextIdx === 0) newRound++;

      const revealWord = d.word || "(no word)";
      const lastGuesserName = d.lastGuesser?.name || "Nobody";

      if (newRound > MAX_ROUNDS) {
        tx.update(gameRef(), { state: "finished", scores: (d.players || []).map(p => ({ name: p.name, score: p.score })) });
        return;
      }

      tx.update(gameRef(), {
        drawOrderIndex: nextIdx,
        currentPlayer: order[nextIdx],
        word: null,
        wordChoices: pickChoices(WORDS, d.usedWords || []),
        round: newRound,
        strokes: [],
        wordPickEndsAt: Date.now() + WORD_PICK_MS,
        turnEndsAt: null,
        revealedLetters: [],
        lastGuesser: null,
        guessedBy: {},
        firstGuesser: null,
        chat: arrayUnion({ id: "system", name: "", text: `⏰ Time's up! The word was "<strong>${revealWord}</strong>".`, timestamp: Date.now() })
      });
    });
  } catch (e) { console.error("Timeout tx:", e); }
};

// ─── Remote player-left ────────────────────────────────────────────────────────
const handleRemotePlayerLeft = async (leaverName = "A player") => {
  try {
    getGameUIElements();
    if (leftModalMsg) leftModalMsg.textContent = `${leaverName} left the game.`;
    leftModal?.classList.remove("hidden");
    setTimeout(() => { leftModal?.classList.add("hidden"); goHome(); }, 3000);
    await updateDoc(gameRef(), { playerLeft: null });
  } catch (e) { console.warn(e); }
};

// ─── Navigation ────────────────────────────────────────────────────────────────
const goHome = async () => {
  if (pendingStrokes.length) await flushStrokes();
  try {
    if (gameId) {
      await runTransaction(db, async tx => {
        const snap = await tx.get(gameRef());
        if (!snap.exists()) return;
        const d  = snap.data();
        const me = (d.players || []).find(p => p.id === user?.uid);
        if (me) {
          tx.update(gameRef(), {
            players: (d.players || []).filter(p => p.id !== user?.uid),
            playerLeft: me.name,
            chat: arrayUnion({ id: "system", name: "", text: `${me.name} left the room.`, timestamp: Date.now() })
          });
        }
      });
    }
  } catch (e) { console.warn(e); }

  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  clearInterval(timerInterval);
  clearCanvas();
  pendingStrokes = [];
  addGameEventListeners._bound = false;
  lastTurnKey = ''; lastChatLen = 0; lastTickSec = -1;
  gameData = null; gameId = null;
  if (chatMessagesContainer) chatMessagesContainer.innerHTML = '';
  if (joinRoomInput) joinRoomInput.value = '';
  statusMessage.textContent = '';
  showScreen("welcome-screen");
  waitingInline?.classList.add('hidden');
  if (roomIdSpanInline) roomIdSpanInline.textContent = '';
};

const resetGame = async () => {
  if (pendingStrokes.length) await flushStrokes();
  await runTransaction(db, async tx => {
    const snap = await tx.get(gameRef());
    if (!snap.exists()) return;
    const players = snap.data().players.map(p => ({ ...p, score: 0 }));
    tx.update(gameRef(), {
      players, state: "waiting",
      currentPlayer: null, word: null, wordChoices: [], usedWords: [],
      round: 0, strokes: [], chat: [], drawOrder: [], drawOrderIndex: 0,
      playerLeft: null, wordPickEndsAt: null, turnEndsAt: null,
      lastGuesser: null, guessedBy: {}, firstGuesser: null,
    });
  });
};

// ─── Event Listeners ───────────────────────────────────────────────────────────
const addGameEventListeners = () => {
  if (addGameEventListeners._bound) return;
  addGameEventListeners._bound = true;

  brushSizeInput?.addEventListener("input",  e => { brushSize = +e.target.value || 5; });
  brushColorInput?.addEventListener("click", () => { isErasing = false; eraserBtn?.classList.remove('active'); brushBtn?.classList.add('active'); });
  brushColorInput?.addEventListener("input", e => { isErasing = false; brushColor = e.target.value || "#000000"; });
  clearCanvasBtn?.addEventListener("click",  async () => {
    if (!canDrawNow()) return;
    pendingStrokes = [];
    await updateDoc(gameRef(), { strokes: [] });
    clearCanvas();
  });
  undoBtn?.addEventListener("click",    undoLastStroke);
  eraserBtn?.addEventListener("click",  () => { isErasing = true;  eraserBtn.classList.add('active');    brushBtn?.classList.remove('active'); });
  brushBtn?.addEventListener("click",   () => { isErasing = false; brushBtn.classList.add('active');     eraserBtn?.classList.remove('active'); });
  submitGuessBtn?.addEventListener("click",  submitGuess);
  guessInput?.addEventListener("keydown", e => { if (e.key === 'Enter') submitGuess(); });
  sendChatBtn?.addEventListener("click",  () => sendChatMessage(chatInput?.value));
  chatInput?.addEventListener("keydown",  e => { if (e.key === 'Enter') sendChatMessage(chatInput.value); });
  playAgainBtn?.addEventListener("click", async () => {
    endGameModal?.classList.add("hidden");
    clearCanvas(); lastChatLen = 0;
    if (chatMessagesContainer) chatMessagesContainer.innerHTML = '';
    await resetGame();
  });
  leftOkBtn?.addEventListener("click",    () => leftModal?.classList.add("hidden"));
  homeBtnModal?.addEventListener("click", goHome);

  window.addEventListener("beforeunload", () => {
    if (!gameId || !user) return;
    if (pendingStrokes.length) flushStrokes();
    updateDoc(gameRef(), { playerLeft: username || "A player" });
  });

  if (canvas) {
    const h = e => {
      if (canDrawNow()) e.preventDefault();
      const t = e.type;
      if (t === "mousedown" || t === "touchstart") startDrawing(e);
      else if (t === "mousemove" || t === "touchmove") draw(e);
      else if (t === "mouseup" || t === "mouseout" || t === "touchend") stopDrawing();
    };
    ["mousedown","mousemove","mouseup","mouseout"].forEach(ev => canvas.addEventListener(ev, h));
    ["touchstart","touchmove","touchend"].forEach(ev => canvas.addEventListener(ev, h, { passive: false }));
    const dot = document.getElementById("cursor-dot");
    if (dot) {
      canvas.addEventListener("pointerenter",  () => { dot.style.display = "block"; });
      canvas.addEventListener("pointerleave",  () => { dot.style.display = "none"; });
      canvas.addEventListener("pointermove",   e  => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; });
      canvas.addEventListener("touchstart",    () => { dot.style.display = "none"; }, { passive: true });
    }
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(setupCanvas, 150); });
  chatToggle?.addEventListener('click', openChat);
  chatClose?.addEventListener('click',  closeChat);
  chatBackdrop?.addEventListener('click', closeChat);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });
};

const undoLastStroke = async () => {
  if (!canDrawNow()) return;
  if (pendingStrokes.length) await flushStrokes();
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(gameRef());
      if (!snap.exists()) return;
      const strokes = snap.data().strokes || [];
      if (strokes.length) tx.update(gameRef(), { strokes: strokes.slice(0, -1) });
    });
  } catch (e) { console.error("Undo:", e); }
};

const wireCopy = (btnId, srcId, tipId) => {
  const btn = document.getElementById(btnId), src = document.getElementById(srcId), tip = tipId ? document.getElementById(tipId) : null;
  if (!btn || !src) return;
  btn.addEventListener("click", () => {
    const text = (src.textContent || '').trim();
    if (!text) { statusMessage.textContent = "No Room ID yet."; return; }
    navigator.clipboard.writeText(text).then(() => {
      if (tip) { tip.classList.remove("opacity-0"); setTimeout(() => tip.classList.add("opacity-0"), 900); }
      else statusMessage.textContent = "Copied!";
    }).catch(() => { statusMessage.textContent = "Copy failed — copy manually."; });
  });
};

// ─── Welcome-screen listeners ──────────────────────────────────────────────────
const addInitialEventListeners = () => {
  createRoomBtn.addEventListener("click", async () => {
    username = usernameInput.value.trim();
    if (!username) { statusMessage.textContent = "Please enter your name."; return; }
    gameId = crypto.randomUUID().substring(0, 8);
    const defaultTeams = TEAM_COLORS.map(c => ({ ...c, members: [] }));
    try {
      await setDoc(gameRef(), {
        players: [{ id: user.uid, name: username, score: 0 }],
        state: "waiting",
        createdAt: Date.now(),
        owner: user.uid,
        mode: MODE_FFA,
        teams: defaultTeams,
        drawOrder: [],
        drawOrderIndex: 0,
        guessedBy: {},
        firstGuesser: null,
        version: 2
      });
      waitingInline?.classList.remove('hidden');
      if (roomIdSpanInline) roomIdSpanInline.textContent = gameId;
      setupFirestoreListener();
    } catch (e) { statusMessage.textContent = "Error creating room."; console.error(e); }
  });

  wireCopy("copy-btn-inline", "room-id-inline", "copy-tip");

  joinRoomBtn.addEventListener("click", async () => {
    username = usernameInput.value.trim();
    gameId   = joinRoomInput.value.trim();
    if (!username || !gameId) { statusMessage.textContent = "Enter your name and Room ID."; return; }
    try {
      await runTransaction(db, async tx => {
        const snap = await tx.get(gameRef());
        if (!snap.exists()) throw new Error("Room not found!");
        const d = snap.data();
        if ((d.players || []).length >= MAX_PLAYERS) throw new Error(`Room is full (max ${MAX_PLAYERS})!`);
        if (d.state !== "waiting") throw new Error("Game already in progress!");
        tx.update(gameRef(), { players: arrayUnion({ id: user.uid, name: username, score: 0 }) });
      });
      waitingInline?.classList.remove('hidden');
      if (roomIdSpanInline) roomIdSpanInline.textContent = gameId;
      setupFirestoreListener();
    } catch (e) { statusMessage.textContent = e.message || "Failed to join."; console.error(e); }
  });

  // Mode selector
  lobbyModeSelect?.addEventListener("change", async () => {
    if (gameData?.owner !== user.uid) return;
    await updateDoc(gameRef(), { mode: lobbyModeSelect.value });
  });

  // Start button (owner only)
  lobbyStartBtn?.addEventListener("click", async () => {
    if (gameData?.owner !== user.uid) return;
    await startGame();
  });
};

// ─── Boot ──────────────────────────────────────────────────────────────────────
window.onload = () => {
  showScreen("welcome-screen");
  initializeAuthAndUI();
  addInitialEventListeners();
};
