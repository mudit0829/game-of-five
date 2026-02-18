// ================= BASIC SETUP =================
// Use window.* variables set by HTML

const GAME = window.GAME_TYPE || "gold";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 50;

const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

const USER_ID = window.GAME_USER_ID;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ✅ SAME AS SILVER
const MAX_BETS_PER_ROUND = 3;

// ================= AUDIO + VIBRATION (NEW) =================
// Browsers usually require a user gesture before audio can play. [web:392]
const BG_AUDIO_SRC = "/static/audio/gold.mp3";
const RESULT_AUDIO_SRC = "/static/audio/result.mp3";

const bgAudio = new Audio(BG_AUDIO_SRC);
bgAudio.loop = true;
bgAudio.preload = "auto";
bgAudio.volume = 0.7;

const resultAudio = new Audio(RESULT_AUDIO_SRC);
resultAudio.loop = false;
resultAudio.preload = "auto";
resultAudio.volume = 1.0;

let audioUnlocked = false;
let bgRoundCodePlaying = null;
let resultTriggeredForRound = null;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // Prime both audio elements so later play() works after gesture
  try {
    bgAudio.play().then(() => {
      bgAudio.pause();
      bgAudio.currentTime = 0;
    }).catch(() => {});
  } catch (e) {}

  try {
    resultAudio.play().then(() => {
      resultAudio.pause();
      resultAudio.currentTime = 0;
    }).catch(() => {});
  } catch (e) {}
}

// unlock on first user interaction
["pointerdown", "touchstart", "mousedown", "keydown"].forEach((evt) => {
  window.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
});

function startGoldLoopIfAllowed(roundCode, hasResultOrFinished) {
  if (!audioUnlocked) return;
  if (!roundCode) return;
  if (hasResultOrFinished) return;

  if (bgRoundCodePlaying !== roundCode) {
    bgRoundCodePlaying = roundCode;
    stopGoldLoop();
  }

  if (bgAudio.paused) {
    bgAudio.currentTime = 0;
    bgAudio.play().catch(() => {});
  }
}

function stopGoldLoop() {
  try {
    if (!bgAudio.paused) bgAudio.pause();
    bgAudio.currentTime = 0;
  } catch (e) {}
}

function playResultSoundOnce(roundCode) {
  if (!audioUnlocked) return;
  if (!roundCode) return;
  if (resultTriggeredForRound === roundCode) return;

  resultTriggeredForRound = roundCode;

  stopGoldLoop();
  try {
    resultAudio.currentTime = 0;
    resultAudio.play().catch(() => {});
  } catch (e) {}
}

// Vibration API: works only on supported devices/browsers. [web:384]
function vibrateOnResult() {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopGoldLoop();
});

// ================= DOM REFERENCES =================
const pitch = document.querySelector(".pitch");
const ballImg = document.getElementById("ballSprite");
const playerArea = document.querySelector(".player-area"); // kept (not used for positioning now)
const goals = Array.from(document.querySelectorAll(".goal.pad"));

const numChips = Array.from(document.querySelectorAll(".num-chip"));
const placeBetBtn = document.getElementById("placeBetBtn");

const roundIdSpan = document.getElementById("roundId");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const timerPill = document.querySelector(".timer-pill");
const walletBalanceSpan = document.getElementById("walletBalance");
const statusEl = document.getElementById("statusMessage");
const coinsWrapper = document.querySelector(".coins");
const userNameLabel = document.getElementById("userName");
const userBetCountLabel = document.getElementById("userBetCount");
const myBetsRow = document.getElementById("myBetsRow");

const popupEl = document.getElementById("resultPopup");
const popupTitleEl = document.getElementById("popupTitle");
const popupMsgEl = document.getElementById("popupMessage");
const popupHomeBtn = document.getElementById("popupHomeBtn");
const popupLobbyBtn = document.getElementById("popupLobbyBtn");

if (userNameLabel) userNameLabel.textContent = USERNAME;

// ================= STATE =================
let walletBalance = 0;
let selectedNumber = 0;

let currentTable = null;
let gameFinished = false;

let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;

let userHasBet = false;

let videoPlayer = null;
let videoStartedForRound = null;
let videoFrozenForRound = null;

let shotShownForRound = null;
let popupShownForRound = null;

// ================= KICK VIDEO TUNING =================
const KICK_SHOW_AT_REMAINING = 4;
const KICK_FREEZE_AT_REMAINING = 2;

const KICK_SCALE = 0.21;
const KICK_SHIFT_X = -18;
const KICK_SHIFT_Y = 4;

let kickResizeHandlerAttached = false;
function attachKickResizeHandlerOnce() {
  if (kickResizeHandlerAttached) return;
  kickResizeHandlerAttached = true;

  window.addEventListener("resize", () => {
    if (videoPlayer) positionKickVideoAtBall(videoPlayer);
  });
}

// ================= SMALL UTILITIES =================
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function toBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function hashToIndex(str, mod) {
  const s = String(str ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod > 0 ? (h % mod) : 0;
}

function normalizeTable(raw) {
  if (!raw) return null;

  const t = { ...raw };

  t.roundCode = pick(raw, "round_code", "roundcode");
  t.timeRemaining = safeNum(pick(raw, "time_remaining", "timeremaining"), 0);
  t.isFinished = toBool(pick(raw, "is_finished", "isfinished"));
  t.isBettingClosed = toBool(pick(raw, "is_betting_closed", "isbettingclosed"));

  t.maxPlayers = pick(raw, "max_players", "maxplayers");
  t.playersCount = safeNum(pick(raw, "players"), 0);

  const betsRaw = Array.isArray(raw.bets) ? raw.bets : (Array.isArray(raw.players) ? raw.players : []);
  t.bets = betsRaw.map((b) => ({
    ...b,
    userId: pick(b, "user_id", "userid"),
    username: pick(b, "username") || "Player",
    number: pick(b, "number"),
    isBot: toBool(pick(b, "is_bot", "isbot")),
  }));

  t.resultValue = pick(raw, "result");

  return t;
}

function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  try {
    const url = new URL(window.location.href);
    const currentParam = url.searchParams.get("table");
    if (currentParam === roundCode) return;
    url.searchParams.set("table", roundCode);
    window.history.replaceState({}, "", url.toString());
    tableCodeFromUrl = roundCode;
  } catch (err) {
    console.warn("Unable to sync URL with table code", err);
  }
}

// ================= UI HELPERS =================
function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = safeNum(balance, 0);
  if (walletBalanceSpan) walletBalanceSpan.textContent = walletBalance.toFixed(0);

  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function renderTimer() {
  if (!timerText) return;
  timerText.textContent = formatTime(displayRemainingSeconds);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

// ✅ Silver-style + fallback lock flag
function setNumberChipsDisabled(disabled) {
  const d = !!disabled;
  numChips.forEach((c) => {
    try { c.disabled = d; } catch (e) {}
    c.dataset.locked = d ? "1" : "0";
    c.classList.toggle("locked", d);
    if (d) c.classList.remove("selected");
  });
}

function disableBettingUI(disableNumbers = true) {
  if (placeBetBtn) placeBetBtn.disabled = true;
  if (disableNumbers) setNumberChipsDisabled(true);
}

function countMyBetsFromTable(table) {
  const list = (table?.bets || []).filter((b) => String(b.userId) === String(USER_ID));
  return list.length;
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => String(b.userId) === String(USER_ID));
  userHasBet = myBets.length > 0;

  if (userBetCountLabel) userBetCountLabel.textContent = myBets.length;
  if (!myBetsRow) return myBets;

  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
  } else {
    const numbers = myBets.map((b) => Number(b.number)).sort((a, b) => a - b);
    myBetsRow.innerHTML = numbers.map((n) => `<span class="my-bet-chip">${n}</span>`).join("");
  }

  return myBets;
}

function updateGoalsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  goals.forEach((goal, i) => {
    const numSpan = goal.querySelector(".pad-number");
    const userSpan = goal.querySelector(".pad-user");
    goal.classList.remove("win");

    if (i < list.length) {
      const b = list[i];
      goal.dataset.number = String(b.number);
      if (numSpan) numSpan.textContent = b.number;
      if (userSpan) userSpan.textContent = b.username || "";
    } else {
      goal.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

function ensureGoalForWinningNumber(winningNumber, roundCode = "") {
  if (winningNumber === null || winningNumber === undefined) return;
  if (!goals || goals.length === 0) return;

  const existing = goals.find((g) => g.dataset.number === String(winningNumber));
  if (existing) return;

  let goal = goals.find((g) => !g.dataset.number || g.dataset.number === "");
  if (!goal) {
    const idx = hashToIndex(`${roundCode}|${winningNumber}`, goals.length);
    goal = goals[idx] || goals[0];
  }
  if (!goal) return;

  const numSpan = goal.querySelector(".pad-number");
  const userSpan = goal.querySelector(".pad-user");

  goal.dataset.number = String(winningNumber);
  if (numSpan) numSpan.textContent = winningNumber;
  if (userSpan) userSpan.textContent = "";
}

function determineUserOutcome(table) {
  const result = table.resultValue;
  const myBets = (table.bets || []).filter((b) => String(b.userId) === String(USER_ID));
  if (!myBets.length) return { outcome: "none", result };

  const won = myBets.some((b) => String(b.number) === String(result));
  return { outcome: won ? "win" : "lose", result };
}

function showEndPopup({ outcome, result }) {
  if (!popupEl) return;

  let title = "Game Finished";
  let message = `Winning number: ${result}`;

  if (outcome === "win") {
    title = "Congratulations!";
    message = `You have WON this game. Winning number: ${result}`;
  } else if (outcome === "lose") {
    title = "Hard Luck!";
    message = `You have LOST this game. Winning number: ${result}`;
  }

  if (popupTitleEl) popupTitleEl.textContent = title;
  if (popupMsgEl) popupMsgEl.textContent = message;

  popupEl.style.display = "flex";
}

function showSlotsFullPopup() {
  if (!popupEl) return;

  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl) popupMsgEl.textContent =
    "This game is already full. You will be redirected to lobby to join another table.";

  popupEl.style.display = "flex";
  setTimeout(() => window.history.back(), 2000);
}

// ================= VIDEO (Kick) =================
function cleanupKickVideo() {
  const node = document.getElementById("playerKickVideo");
  if (node && node.parentNode) node.parentNode.removeChild(node);
  videoPlayer = null;

  if (ballImg) ballImg.style.opacity = "1";
}

function positionKickVideoAtBall(v) {
  if (!v) return;

  if (ballImg) {
    const r = ballImg.getBoundingClientRect();

    const x = r.left + r.width / 2 + KICK_SHIFT_X;
    const y = r.top + r.height + KICK_SHIFT_Y;

    v.style.left = `${x}px`;
    v.style.top = `${y}px`;

    v.style.transformOrigin = "bottom center";
    v.style.transform = `translate(-50%, -100%) scale(${KICK_SCALE})`;
    return;
  }

  if (pitch) {
    const pr = pitch.getBoundingClientRect();
    v.style.left = `${pr.left + pr.width / 2}px`;
    v.style.top = `${pr.top + pr.height * 0.85}px`;
    v.style.transformOrigin = "bottom center";
    v.style.transform = `translate(-50%, -100%) scale(${KICK_SCALE})`;
  }
}

function ensureKickVideoElement() {
  let v = document.getElementById("playerKickVideo");
  if (v) return v;

  v = document.createElement("video");
  v.id = "playerKickVideo";
  v.src = "/static/video/gold_game_video_Play.mp4";
  v.muted = true;
  v.autoplay = false;
  v.playsInline = true;
  v.preload = "auto";

  v.style.position = "fixed";
  v.style.width = "360px";
  v.style.height = "auto";
  v.style.pointerEvents = "none";
  v.style.zIndex = "9";
  v.style.filter = "drop-shadow(0 12px 22px rgba(0,0,0,0.65))";

  document.body.appendChild(v);
  attachKickResizeHandlerOnce();

  return v;
}

function maybeStartKickVideo() {
  if (!currentTable) return;

  const roundId = currentTable.roundCode || "__no_round__";
  if (videoStartedForRound === roundId) return;

  if (displayRemainingSeconds > KICK_SHOW_AT_REMAINING || displayRemainingSeconds <= KICK_FREEZE_AT_REMAINING) return;

  videoStartedForRound = roundId;
  videoFrozenForRound = null;

  const v = ensureKickVideoElement();
  if (!v) return;

  videoPlayer = v;

  if (ballImg) ballImg.style.opacity = "1";

  positionKickVideoAtBall(v);
  requestAnimationFrame(() => positionKickVideoAtBall(v));

  try { v.currentTime = 0; } catch (e) {}
  v.play().catch((err) => console.warn("[video] play error:", err));
}

function freezeKickVideoAt2s() {
  if (!currentTable) return;
  if (!videoPlayer) return;

  const roundId = currentTable.roundCode || "__no_round__";
  if (videoFrozenForRound === roundId) return;

  if (displayRemainingSeconds <= KICK_FREEZE_AT_REMAINING) {
    videoFrozenForRound = roundId;

    try { videoPlayer.pause(); } catch (e) {}

    positionKickVideoAt2sHack(videoPlayer);
    requestAnimationFrame(() => positionKickVideoAt2sHack(videoPlayer));

    if (ballImg) ballImg.style.opacity = "1";
  }
}

function positionKickVideoAt2sHack(v) {
  positionKickVideoAtBall(v);
}

// ================= BALL + DOTTED PATH (LOCKED) =================
const BALL_SHOT_DURATION_MS = 1125;
const BALL_SHOT_START_DELAY_MS = 420;
const BALL_RESET_DELAY_MS = 1350;

let _shotSvg = null;
let _shotToken = 0;

function ensureTrajectoryStyles() {
  if (document.getElementById("trajectory-styles")) return;
  const style = document.createElement("style");
  style.id = "trajectory-styles";
  style.textContent = `
    @keyframes goldPathIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes goldPathOut { to { opacity: 0; } }
    @keyframes goldDash { to { stroke-dashoffset: -28; } }
    @keyframes goalFlash {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
      50% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
    }
  `;
  document.head.appendChild(style);
}

function ensureShotSvg() {
  if (!pitch) return null;

  try {
    const pos = getComputedStyle(pitch).position;
    if (pos === "static") pitch.style.position = "relative";
  } catch {}

  if (_shotSvg && _shotSvg.isConnected) return _shotSvg;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "5";

  pitch.appendChild(svg);
  _shotSvg = svg;
  return svg;
}

function clearShotPath() {
  if (_shotSvg) _shotSvg.innerHTML = "";
}

function drawDottedPath(pitchW, pitchH, startX, startY, ctrlX, ctrlY, endX, endY, flightMs) {
  ensureTrajectoryStyles();
  const svg = ensureShotSvg();
  if (!svg) return null;

  svg.setAttribute("viewBox", `0 0 ${pitchW} ${pitchH}`);
  svg.innerHTML = "";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#fbbf24");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-dasharray", "8 6");
  path.setAttribute("opacity", "0.95");
  path.style.filter = "drop-shadow(0 8px 12px rgba(0,0,0,0.55))";

  const fadeIn = 180;
  const fadeOut = Math.max(450, Math.round(flightMs * 0.45));
  const fadeOutDelay = Math.max(0, flightMs - fadeOut);

  path.style.animation =
    `goldPathIn ${fadeIn}ms ease-out, ` +
    `goldDash ${flightMs}ms linear infinite, ` +
    `goldPathOut ${fadeOut}ms ease-in ${fadeOutDelay}ms forwards`;

  svg.appendChild(path);
  return path;
}

function shootBallToWinningNumber(winningNumber) {
  if (!pitch || !ballImg) return;

  const targetGoal = goals.find((g) => g.dataset.number === String(winningNumber));
  if (!targetGoal) return;

  const token = ++_shotToken;

  clearShotPath();

  const pitchRect = pitch.getBoundingClientRect();
  const ballRect = ballImg.getBoundingClientRect();
  const goalRect = targetGoal.getBoundingClientRect();

  const pitchW = Math.max(1, pitch.clientWidth || Math.round(pitchRect.width));
  const pitchH = Math.max(1, pitch.clientHeight || Math.round(pitchRect.height));
  const scaleX = (pitchRect.width / pitchW) || 1;
  const scaleY = (pitchRect.height / pitchH) || 1;

  const toLocal = (clientX, clientY) => ({
    x: (clientX - pitchRect.left) / scaleX,
    y: (clientY - pitchRect.top) / scaleY,
  });

  const startLocal = toLocal(ballRect.left + ballRect.width / 2, ballRect.top + ballRect.height / 2);
  const endLocal = toLocal(goalRect.left + goalRect.width / 2, goalRect.top + goalRect.height / 2);

  const startX = startLocal.x;
  const startY = startLocal.y;
  const endX = endLocal.x;
  const endY = endLocal.y;

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);

  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const lift = Math.min(130, Math.max(60, dist * 0.28));
  const ctrlX = midX;
  const ctrlY = midY - lift;

  const pathEl = drawDottedPath(
    pitchW, pitchH,
    startX, startY,
    ctrlX, ctrlY,
    endX, endY,
    BALL_SHOT_DURATION_MS
  );
  if (!pathEl) return;

  setTimeout(() => {
    if (token !== _shotToken) return;

    const ballW = ballImg.offsetWidth || Math.max(1, ballRect.width / scaleX);
    const ballH = ballImg.offsetHeight || Math.max(1, ballRect.height / scaleY);
    const ax = ballW * 0.5;
    const ay = ballH * 0.5;

    const flying = ballImg.cloneNode(true);
    flying.removeAttribute("id");
    flying.removeAttribute("class");
    flying.style.position = "absolute";
    flying.style.left = "0px";
    flying.style.top = "0px";
    flying.style.width = ballW + "px";
    flying.style.height = "auto";
    flying.style.pointerEvents = "none";
    flying.style.zIndex = "1000";
    flying.style.willChange = "transform";
    flying.style.transformOrigin = `${ax}px ${ay}px`;
    flying.style.filter = "drop-shadow(0 12px 18px rgba(0,0,0,0.65))";

    pitch.appendChild(flying);
    ballImg.style.opacity = "0";

    const totalLen = pathEl.getTotalLength();
    const startTime = performance.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    function step(now) {
      if (token !== _shotToken) {
        flying.remove();
        ballImg.style.opacity = "1";
        clearShotPath();
        return;
      }

      const tr = Math.min(Math.max((now - startTime) / BALL_SHOT_DURATION_MS, 0), 1);
      const t = easeOutCubic(tr);

      const L = t * totalLen;
      const p = pathEl.getPointAtLength(L);

      const eps = 1.0;
      const p2 = pathEl.getPointAtLength(Math.min(totalLen, L + eps));
      const angle = Math.atan2(p2.y - p.y, p2.x - p.x) * (180 / Math.PI);

      const rotation = t * (dist * 1.1);
      const scale = 1 - t * 0.10;

      flying.style.transform =
        `translate(${p.x - ax}px, ${p.y - ay}px) rotate(${angle + rotation}deg) scale(${scale})`;

      if (tr < 1) {
        requestAnimationFrame(step);
        return;
      }

      clearShotPath();
      targetGoal.classList.add("win");

      setTimeout(() => {
        flying.remove();
        ballImg.style.opacity = "1";
        cleanupKickVideo();
      }, BALL_RESET_DELAY_MS);
    }

    requestAnimationFrame(step);
  }, BALL_SHOT_START_DELAY_MS);
}

// ================= TIMER =================
function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);

  localTimerInterval = setInterval(() => {
    if (gameFinished) return;

    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds -= 1;
      renderTimer();

      maybeStartKickVideo();
      freezeKickVideoAt2s();
    }
  }, 1000);
}

// ================= POLLING =================
async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/gold");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let raw = null;

    if (tableCodeFromUrl) {
      raw =
        data.tables.find((t) => String(pick(t, "round_code", "roundcode")) === String(tableCodeFromUrl)) ||
        null;

      if (!raw) {
        gameFinished = true;
        disableBettingUI(true);

        if (tablePollInterval) clearInterval(tablePollInterval);
        tablePollInterval = null;

        if (localTimerInterval) clearInterval(localTimerInterval);
        localTimerInterval = null;

        cleanupKickVideo();
        stopGoldLoop(); // NEW

        setStatus("This game has finished. You'll be taken back to lobby to join a new one.", "error");
        setTimeout(() => window.history.back(), 2000);
        return;
      }
    } else {
      raw = data.tables[0];
      syncUrlWithTable(pick(raw, "round_code", "roundcode"));
    }

    currentTable = normalizeTable(raw);
    updateGameUI(currentTable);
  } catch (err) {
    console.error("fetchTableData error", err);
  }
}

function updateGameUI(table) {
  if (!table) return;

  if (videoPlayer && videoStartedForRound && table.roundCode && videoStartedForRound !== table.roundCode) {
    cleanupKickVideo();
    videoStartedForRound = null;
    videoFrozenForRound = null;
  }

  if (roundIdSpan) roundIdSpan.textContent = table.roundCode || "-";

  displayRemainingSeconds = table.timeRemaining || 0;
  renderTimer();

  updateGoalsFromBets(table.bets || []);
  const myBets = updateMyBets(table.bets || []);

  if (playerCountSpan) playerCountSpan.textContent = table.playersCount || 0;

  const maxPlayers = typeof table.maxPlayers === "number" ? table.maxPlayers : null;
  const isFull = maxPlayers !== null && (table.playersCount >= maxPlayers);

  // ✅ EXACT SILVER LOGIC
  if (isFull) {
    setNumberChipsDisabled(true);
  } else if (!gameFinished && myBets.length < MAX_BETS_PER_ROUND) {
    setNumberChipsDisabled(false);
  }

  if (myBets.length >= MAX_BETS_PER_ROUND) {
    setNumberChipsDisabled(true);
    if (placeBetBtn) placeBetBtn.disabled = true;
    if (!gameFinished) setStatus(`Bet limit reached (${MAX_BETS_PER_ROUND}/${MAX_BETS_PER_ROUND}).`, "ok");
  }

  if (placeBetBtn && !gameFinished) {
    const lockBecauseLimit = myBets.length >= MAX_BETS_PER_ROUND;
    placeBetBtn.disabled = !!table.isBettingClosed || isFull || lockBecauseLimit;
  }

  if (timerPill) {
    if (displayRemainingSeconds <= 10) timerPill.classList.add("urgent");
    else timerPill.classList.remove("urgent");
  }

  if (!gameFinished && !userHasBet && isFull) {
    gameFinished = true;
    disableBettingUI(true);
    if (tablePollInterval) clearInterval(tablePollInterval);
    tablePollInterval = null;
    if (localTimerInterval) clearInterval(localTimerInterval);
    localTimerInterval = null;

    cleanupKickVideo();
    stopGoldLoop(); // NEW
    showSlotsFullPopup();
    return;
  }

  const hasResult = table.resultValue !== null && table.resultValue !== undefined && table.resultValue !== "";

  // ================= AUDIO CONTROL (NEW) =================
  // Loop gold.mp3 while the round is active and result not declared
  startGoldLoopIfAllowed(table.roundCode, hasResult || table.isFinished);

  // When result becomes known (your "<=2s" timing), stop loop, play result once, vibrate once
  if (hasResult && table.timeRemaining <= 2) {
    playResultSoundOnce(table.roundCode);
    vibrateOnResult();
  }

  maybeStartKickVideo();
  freezeKickVideoAt2s();

  if (hasResult && table.timeRemaining <= 2) {
    const roundId = table.roundCode || "__no_round__";
    if (shotShownForRound !== roundId) {
      shotShownForRound = roundId;

      setStatus(`Winning number: ${table.resultValue}`, "ok");
      ensureGoalForWinningNumber(table.resultValue, table.roundCode);
      shootBallToWinningNumber(table.resultValue);
    }
  }

  if (hasResult && table.isFinished) {
    const roundId = table.roundCode || "__no_round__";
    if (popupShownForRound !== roundId) {
      popupShownForRound = roundId;

      gameFinished = true;
      disableBettingUI(true);

      if (tablePollInterval) clearInterval(tablePollInterval);
      tablePollInterval = null;

      if (localTimerInterval) clearInterval(localTimerInterval);
      localTimerInterval = null;

      stopGoldLoop(); // NEW

      const outcomeInfo = determineUserOutcome(table);

      setTimeout(() => {
        cleanupKickVideo();
        showEndPopup(outcomeInfo);
      }, 2100);
    }
  }
}

function startPolling() {
  fetchTableData();
  if (tablePollInterval) clearInterval(tablePollInterval);

  tablePollInterval = setInterval(() => {
    if (!gameFinished) fetchTableData();
  }, 1000);
}

// ================= SOCKET =================
const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const data = await res.json();
    if (typeof data.balance === "number") updateWallet(data.balance);
  } catch (err) {
    console.error("balance fetch error", err);
  }
}

function joinGameRoom() {
  socket.emit("join_game", { game_type: GAME, user_id: USER_ID });
  socket.emit("joingame", { game_type: GAME, user_id: USER_ID });
}

socket.on("connect", () => {
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

function handleBetSuccess(payload) {
  if (gameFinished) return;

  setStatus(payload?.message || "Bet placed ✓", "ok");
  const newBal = payload?.new_balance ?? payload?.newbalance;
  if (typeof newBal === "number") updateWallet(newBal);

  fetchTableData();
}

function handleUpdateTable(payload) {
  if (gameFinished) return;
  fetchTableData();
}

function handleBetError(payload) {
  if (gameFinished) return;
  setStatus(payload?.message || "Bet error", "error");
}

socket.on("bet_success", handleBetSuccess);
socket.on("betsuccess", handleBetSuccess);

socket.on("update_table", handleUpdateTable);
socket.on("updatetable", handleUpdateTable);

socket.on("bet_error", handleBetError);
socket.on("beterror", handleBetError);

// ================= UI EVENTS =================
numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (gameFinished) return;
    if (chip.disabled || chip.dataset.locked === "1") return;
    setSelectedNumber(parseInt(chip.dataset.number, 10));
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    // try to unlock audio on bet click too (safe)
    unlockAudioOnce();

    if (gameFinished) return setStatus("This game has already finished.", "error");
    if (!currentTable) return setStatus("Game is not ready yet. Please wait...", "error");

    const myCountNow = countMyBetsFromTable(currentTable);
    if (myCountNow >= MAX_BETS_PER_ROUND) {
      setStatus(`You can place only ${MAX_BETS_PER_ROUND} bets in this game.`, "error");
      setNumberChipsDisabled(true);
      placeBetBtn.disabled = true;
      return;
    }

    const maxPlayers = typeof currentTable.maxPlayers === "number" ? currentTable.maxPlayers : null;
    const isFull = maxPlayers !== null && currentTable.playersCount >= maxPlayers;
    if (isFull) {
      setStatus("Slots are full. You cannot place a bet now.", "error");
      setNumberChipsDisabled(true);
      placeBetBtn.disabled = true;
      return;
    }

    if (walletBalance < FIXED_BET_AMOUNT) return setStatus("Insufficient balance", "error");
    if (selectedNumber === null || selectedNumber === undefined) return setStatus("Select a number first", "error");

    const payload = {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    };

    socket.emit("place_bet", payload);
    socket.emit("placebet", payload);
  });
}

if (popupHomeBtn) popupHomeBtn.addEventListener("click", () => (window.location.href = HOME_URL));
if (popupLobbyBtn) popupLobbyBtn.addEventListener("click", () => window.history.back());

// ================= INIT =================
console.log(`[INIT] Game=${GAME}, User=${USER_ID}, Username=${USERNAME}, Bet=${FIXED_BET_AMOUNT}`);

fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
