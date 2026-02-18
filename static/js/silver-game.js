// ================= BASIC SETUP =================
const GAME = window.GAME_TYPE || "silver";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 10;

const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

const USER_ID = window.GAME_USER_ID;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ✅ NEW: max bets allowed per user per round
const MAX_BETS_PER_ROUND = 3;

// Must match your CSS animation duration for .frog-wrapper.jump-to
const HOP_DURATION_MS = 850;

// Small tuning so frog looks like sitting ON the pad (positive = a bit lower)
const LANDING_Y_OFFSET_PX = 10;

// Arc height (px) — this sets CSS var used by your new jump animation
const JUMP_ARC_HEIGHT_PX = 95;

// ================= AUDIO + VIBRATION (NEW) =================
// NOTE: Most browsers require a user gesture before audio can play. [web:392]
const BG_AUDIO_SRC = "/static/audio/silver.mp3";
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

  // "Prime" audio so later play() works more reliably after gesture
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

// unlock on first user interaction (tap/click)
["pointerdown", "touchstart", "mousedown", "keydown"].forEach((evt) => {
  window.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
});

function startSilverLoopIfAllowed(roundCode, hasResultOrFinished) {
  if (!audioUnlocked) return;
  if (!roundCode) return;
  if (hasResultOrFinished) return;

  // if new round, restart loop clean
  if (bgRoundCodePlaying !== roundCode) {
    bgRoundCodePlaying = roundCode;
    stopSilverLoop(); // stop any old round loop
  }

  if (bgAudio.paused) {
    bgAudio.currentTime = 0;
    bgAudio.play().catch(() => {});
  }
}

function stopSilverLoop() {
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

  stopSilverLoop();

  try {
    resultAudio.currentTime = 0;
    resultAudio.play().catch(() => {});
  } catch (e) {}
}

// Vibration: only works on supported devices and requires user activation in many browsers. [web:384]
function vibrateOnResult() {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  } catch (e) {}
}

// If user switches tabs, pause loop; when back, loop can resume by updateGameUI()
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSilverLoop();
});

// ================= DOM REFERENCES =================
const pondEl = document.querySelector(".pond");
const frogContainer = document.getElementById("frogContainer");
const frogIdleVideo = document.getElementById("frogIdleVideo");

const pads = Array.from(document.querySelectorAll(".pad"));
const numChips = Array.from(document.querySelectorAll(".num-chip"));
const placeBetBtn = document.getElementById("placeBetBtn");

const roundIdSpan = document.getElementById("roundId");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
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
let displayRemainingSeconds = 0;

// one-hop-per-round + one-popup-per-round
let hopShownForRound = null;
let popupShownForRound = null;

// landing time to delay popup until hop finishes
let hopLandingETA = 0;

// used to avoid accidental double-trigger
let isHoppingNow = false;

// ================= HELPERS =================
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

function normalizeTable(raw) {
  if (!raw) return null;

  const t = { ...raw };

  t.roundCode = pick(raw, "round_code", "roundcode");
  t.timeRemaining = safeNum(pick(raw, "time_remaining", "timeremaining"), 0);
  t.isFinished = toBool(pick(raw, "is_finished", "isfinished"));
  t.isBettingClosed = toBool(pick(raw, "is_betting_closed", "isbettingclosed"));

  t.maxPlayers = pick(raw, "max_players", "maxplayers");
  t.playersCount = safeNum(pick(raw, "players"), 0);

  t.resultValue = pick(raw, "result");

  const betsRaw = Array.isArray(raw.bets) ? raw.bets : (Array.isArray(raw.players) ? raw.players : []);
  t.bets = betsRaw.map((b) => ({
    ...b,
    userId: pick(b, "user_id", "userid"),
    username: pick(b, "username") || "Player",
    number: pick(b, "number"),
    isBot: toBool(pick(b, "is_bot", "isbot")),
  }));

  return t;
}

function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (type ? " " + type : "");
}

function updateWallet(balance) {
  walletBalance = safeNum(balance, 0);
  if (walletBalanceSpan) walletBalanceSpan.textContent = walletBalance.toFixed(0);

  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function renderTimer() {
  if (timerText) timerText.textContent = formatTime(displayRemainingSeconds);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    chip.classList.toggle("selected", parseInt(chip.dataset.number, 10) === n);
  });
}

// ✅ helper: disable/enable number chips
function setNumberChipsDisabled(disabled) {
  numChips.forEach((c) => (c.disabled = !!disabled));
}

// ✅ updated: optionally disable numbers too
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

  if (userBetCountLabel) userBetCountLabel.textContent = myBets.length;

  if (myBetsRow) {
    if (myBets.length === 0) {
      myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
    } else {
      const numbers = myBets.map((b) => Number(b.number)).sort((a, b) => a - b);
      myBetsRow.innerHTML = numbers.map((n) => `<span class="my-bet-chip">${n}</span>`).join("");
    }
  }

  return myBets;
}

function updatePadsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");

    if (i < list.length) {
      const bet = list[i];
      pad.dataset.number = String(bet.number);
      if (numSpan) numSpan.textContent = bet.number;
      if (userSpan) userSpan.textContent = bet.username || "";
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

// ONLY place the winning number on an EMPTY pad if needed (no overwrite).
function ensurePadForWinningNumber(winningNumber) {
  if (winningNumber == null) return;

  const str = String(winningNumber);
  const exists = pads.some((p) => p.dataset.number === str);
  if (exists) return;

  const emptyPad = pads.find((p) => !p.dataset.number);
  if (!emptyPad) return;

  emptyPad.dataset.number = str;
  const numSpan = emptyPad.querySelector(".pad-number");
  if (numSpan) numSpan.textContent = str;
}

function findPadForNumber(num) {
  const str = String(num);
  return pads.find(
    (p) => p.dataset.number === str || (p.querySelector(".pad-number")?.textContent || "").trim() === str
  );
}

function determineUserOutcome(table) {
  const result = table.resultValue;
  const myBets = (table.bets || []).filter((b) => String(b.userId) === String(USER_ID));
  if (!myBets.length) return { outcome: "none", result };

  const won = myBets.some((b) => String(b.number) === String(result));
  return { outcome: won ? "win" : "lose", result };
}

function showResultPopup(outcomeInfo) {
  if (!popupEl) return;

  const { outcome, result } = outcomeInfo;

  let title = "Game Finished";
  if (outcome === "win") title = "Congratulations!";
  else if (outcome === "lose") title = "Hard Luck!";

  if (popupTitleEl) popupTitleEl.textContent = title;
  if (popupMsgEl) popupMsgEl.textContent = `Winning number: ${result}`;

  popupEl.style.display = "flex";
}

function showSlotsFullPopup() {
  if (!popupEl) return;
  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl) popupMsgEl.textContent = "This game is already full. Redirecting to lobby...";
  popupEl.style.display = "flex";
  setTimeout(() => window.history.back(), 2000);
}

// ================= PRECISE FROG JUMP (uses your new CSS .jump-to) =================
function clearOldJumpClasses() {
  if (!frogContainer) return;
  frogContainer.classList.remove("jumping", "jump-left", "jump-front", "jump-right", "jump-to");
}

function jumpFrogToPad(targetPad) {
  if (!frogContainer || !targetPad) return;

  if (isHoppingNow) return;
  isHoppingNow = true;

  const frogRect = frogContainer.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const frogCX = frogRect.left + frogRect.width / 2;
  const frogCY = frogRect.top + frogRect.height / 2;

  const padCX = padRect.left + padRect.width / 2;
  const padCY = padRect.top + padRect.height / 2;

  const dx = padCX - frogCX;
  const dy = (padCY - frogCY) + LANDING_Y_OFFSET_PX;

  frogContainer.style.setProperty("--dx", `${dx}px`);
  frogContainer.style.setProperty("--dy", `${dy}px`);
  frogContainer.style.setProperty("--jumpH", `${JUMP_ARC_HEIGHT_PX}px`);

  clearOldJumpClasses();

  void frogContainer.offsetWidth;
  frogContainer.classList.add("jump-to");

  hopLandingETA = Date.now() + HOP_DURATION_MS;

  setTimeout(() => {
    targetPad.classList.add("win");
  }, Math.max(0, HOP_DURATION_MS - 80));

  setTimeout(() => {
    isHoppingNow = false;
  }, HOP_DURATION_MS + 50);
}

function jumpFrogToWinningNumber(winNum) {
  if (winNum === null || winNum === undefined || winNum === "") return;
  ensurePadForWinningNumber(winNum);
  const targetPad = findPadForNumber(winNum);
  if (!targetPad) return;
  jumpFrogToPad(targetPad);
}

// ================= POLLING =================
async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/silver");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let raw = null;

    if (tableCodeFromUrl) {
      raw =
        data.tables.find(
          (t) => String(pick(t, "round_code", "roundcode")) === String(tableCodeFromUrl)
        ) || null;

      if (!raw) {
        gameFinished = true;
        disableBettingUI(true);
        setStatus("This game has finished. Going back to lobby...", "error");

        if (tablePollInterval) clearInterval(tablePollInterval);
        tablePollInterval = null;

        stopSilverLoop(); // NEW
        setTimeout(() => window.history.back(), 2000);
        return;
      }
    } else {
      raw = data.tables[0];
      tableCodeFromUrl = pick(raw, "round_code", "roundcode") || null;
    }

    currentTable = normalizeTable(raw);
    updateGameUI(currentTable);
  } catch (err) {
    console.error("[fetchTableData] error:", err);
  }
}

function updateGameUI(table) {
  if (!table) return;

  if (roundIdSpan) roundIdSpan.textContent = table.roundCode || "-";

  displayRemainingSeconds = table.timeRemaining || 0;
  renderTimer();

  updatePadsFromBets(table.bets || []);
  const myBets = updateMyBets(table.bets || []);

  if (playerCountSpan) playerCountSpan.textContent = table.playersCount || 0;

  const maxPlayers = typeof table.maxPlayers === "number" ? table.maxPlayers : null;
  const isFull = maxPlayers !== null && table.playersCount >= maxPlayers;

  // ✅ Disable all number buttons if table is full (your requirement)
  if (isFull) {
    setNumberChipsDisabled(true);
  } else if (!gameFinished && myBets.length < MAX_BETS_PER_ROUND) {
    // enable again when not full and user hasn't hit limit
    setNumberChipsDisabled(false);
  }

  // ✅ If user already placed 3 bets, lock number selection + button
  if (myBets.length >= MAX_BETS_PER_ROUND) {
    setNumberChipsDisabled(true);
    if (placeBetBtn) placeBetBtn.disabled = true;
    if (!gameFinished) setStatus(`Bet limit reached (${MAX_BETS_PER_ROUND}/${MAX_BETS_PER_ROUND}).`, "ok");
  }

  // Disable betting close to end (existing behavior) + full + bet-limit
  if (placeBetBtn && !gameFinished) {
    const lockBecauseLimit = myBets.length >= MAX_BETS_PER_ROUND;
    placeBetBtn.disabled = !!table.isBettingClosed || isFull || lockBecauseLimit || displayRemainingSeconds <= 15;
  }

  const hasUserBet = myBets.length > 0;

  if (!gameFinished && !hasUserBet && isFull) {
    gameFinished = true;
    disableBettingUI(true);
    if (tablePollInterval) clearInterval(tablePollInterval);
    tablePollInterval = null;
    stopSilverLoop(); // NEW
    showSlotsFullPopup();
    return;
  }

  const hasResult = table.resultValue !== null && table.resultValue !== undefined && table.resultValue !== "";

  // ================= AUDIO CONTROL (NEW) =================
  // Play silver loop while game is running and result not declared
  startSilverLoopIfAllowed(table.roundCode, hasResult || table.isFinished);

  // As soon as result becomes known (<=2s logic you already use), stop loop + play result sound + vibrate once
  if (hasResult && table.timeRemaining <= 2) {
    playResultSoundOnce(table.roundCode);
    vibrateOnResult();
  }

  // Jump at <= 2 seconds when result is known
  if (hasResult && table.timeRemaining <= 2) {
    const roundId = table.roundCode || "__no_round__";

    if (hopShownForRound !== roundId) {
      hopShownForRound = roundId;
      setStatus(`Winning number: ${table.resultValue}`, "ok");
      jumpFrogToWinningNumber(table.resultValue);
    }
  }

  // Show popup only when finished, after hop landing
  if (hasResult && table.isFinished) {
    const roundId = table.roundCode || "__no_round__";

    if (popupShownForRound !== roundId && hasUserBet) {
      popupShownForRound = roundId;

      gameFinished = true;
      disableBettingUI(true);

      if (tablePollInterval) clearInterval(tablePollInterval);
      tablePollInterval = null;

      stopSilverLoop(); // NEW (extra safety)

      const outcomeInfo = determineUserOutcome(table);
      const delay = Math.max(0, (hopLandingETA || 0) - Date.now() + 250);

      setTimeout(() => showResultPopup(outcomeInfo), delay);
    }
  }
}

function startPolling() {
  fetchTableData();
  if (tablePollInterval) clearInterval(tablePollInterval);
  tablePollInterval = setInterval(fetchTableData, 1000);
}

// ================= SOCKET =================
const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const data = await res.json();
    if (typeof data.balance === "number") updateWallet(data.balance);
  } catch (e) {
    console.error("[balance] fetch error:", e);
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

function onBetSuccess(payload) {
  setStatus(payload?.message || "Bet placed ✓", "ok");
  const newBal = payload?.new_balance ?? payload?.newbalance;
  if (typeof newBal === "number") updateWallet(newBal);
  fetchTableData();
}

function onBetError(payload) {
  setStatus(payload?.message || "Bet error", "error");
}

socket.on("bet_success", onBetSuccess);
socket.on("betsuccess", onBetSuccess);

socket.on("bet_error", onBetError);
socket.on("beterror", onBetError);

socket.on("update_table", () => fetchTableData());
socket.on("updatetable", () => fetchTableData());

// ================= UI EVENTS =================
numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (gameFinished) return;
    if (chip.disabled) return;
    setSelectedNumber(parseInt(chip.dataset.number, 10));
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    // ensure audio unlock attempt happens on bet click too
    unlockAudioOnce();

    if (gameFinished) return setStatus("Game finished", "error");
    if (!currentTable) return setStatus("Game not ready", "error");

    // ✅ Hard client-side limit: 3 bets only
    const myCountNow = countMyBetsFromTable(currentTable);
    if (myCountNow >= MAX_BETS_PER_ROUND) {
      setStatus(`You can place only ${MAX_BETS_PER_ROUND} bets in this game.`, "error");
      setNumberChipsDisabled(true);
      placeBetBtn.disabled = true;
      return;
    }

    // ✅ If table full, block action (and lock UI)
    const maxPlayers = typeof currentTable.maxPlayers === "number" ? currentTable.maxPlayers : null;
    const isFull = maxPlayers !== null && currentTable.playersCount >= maxPlayers;
    if (isFull) {
      setStatus("Slots are full. You cannot place a bet now.", "error");
      setNumberChipsDisabled(true);
      placeBetBtn.disabled = true;
      return;
    }

    if (walletBalance < FIXED_BET_AMOUNT) return setStatus("Insufficient balance", "error");
    if (selectedNumber == null) return setStatus("Select a number", "error");

    socket.emit("place_bet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });
    socket.emit("placebet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });
  });
}

if (popupHomeBtn) popupHomeBtn.addEventListener("click", () => (window.location.href = HOME_URL));
if (popupLobbyBtn) popupLobbyBtn.addEventListener("click", () => window.history.back());

// ================= INIT =================
if (frogIdleVideo) {
  frogIdleVideo.muted = true;
  frogIdleVideo.play().catch(() => {});
}

console.log(`[INIT] Silver Game - User=${USER_ID}, Username=${USERNAME}, Bet=${FIXED_BET_AMOUNT}`);

fetchBalance();
startPolling();
setSelectedNumber(0);
setStatus("");
