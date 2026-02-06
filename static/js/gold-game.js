// ================= BASIC SETUP =================
// Use window.* variables set by HTML

const GAME = window.GAME_TYPE || "gold";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 50;

const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

const USER_ID = window.GAME_USER_ID;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

const pitch = document.querySelector(".pitch");
const ballImg = document.getElementById("ballSprite");
const playerArea = document.querySelector(".player-area");
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
// Your CSS places the ball inside .player-area using translateX(-20px) [file:99]
// so we match that offset so the player stops exactly at the ball position.

const KICK_SHOW_AT_REMAINING = 4;    // show/start video at 4 seconds remaining
const KICK_FREEZE_AT_REMAINING = 2;  // pause + keep on screen at 2 seconds remaining
const KICK_SCALE = 0.30;             // 70% smaller => 30% size
const KICK_X_OFFSET_PX = -20;        // match ball translateX(-20px)

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

function normalizeTable(raw) {
  if (!raw) return null;

  const t = { ...raw };

  // handle both snake_case + no-underscore versions
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

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach((chip) => {
    chip.disabled = true;
  });
}

// ✅ Update my bets display
function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => String(b.userId) === String(USER_ID));

  userHasBet = myBets.length > 0;

  if (userBetCountLabel) userBetCountLabel.textContent = myBets.length;

  if (!myBetsRow) return;

  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
  } else {
    const numbers = myBets.map((b) => Number(b.number)).sort((a, b) => a - b);
    myBetsRow.innerHTML = numbers.map((n) => `<span class="my-bet-chip">${n}</span>`).join("");
  }
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

// Ensure winning number is on a goal (in case no one bet that number)
function ensureGoalForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;

  const existing = goals.find((g) => g.dataset.number === String(winningNumber));
  if (existing) return;

  const goal = goals[0];
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
  } else {
    title = "Game Finished";
    message = `Winning number: ${result}`;
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

function cleanupKickVideo({ restoreBall = true } = {}) {
  const node = document.getElementById("playerKickVideo");
  if (node && node.parentNode) node.parentNode.removeChild(node);

  videoPlayer = null;

  if (restoreBall && ballImg) ballImg.style.opacity = "1";
}

function ensureKickVideoElement() {
  if (!playerArea) return null;

  let v = document.getElementById("playerKickVideo");
  if (v) return v;

  v = document.createElement("video");
  v.id = "playerKickVideo";
  v.src = "/static/video/gold_game_video_Play.mp4";
  v.muted = true;
  v.autoplay = false;
  v.playsInline = true;
  v.preload = "auto";

  // IMPORTANT: Make it not affect flex layout (fixes "here/there")
  // and align it to the same anchor as the ball inside .player-area. [file:99]
  v.style.position = "absolute";
  v.style.left = "50%";
  v.style.bottom = "0px";
  v.style.width = "200px"; // base width, then scale down
  v.style.height = "auto";
  v.style.transformOrigin = "bottom center";
  v.style.transform = `translateX(-50%) translateX(${KICK_X_OFFSET_PX}px) scale(${KICK_SCALE})`;

  // Keep ball above the player video
  v.style.zIndex = "1";
  v.style.pointerEvents = "none";
  v.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.65))";

  playerArea.appendChild(v);
  return v;
}

function maybeStartKickVideo() {
  if (!currentTable) return;

  const roundId = currentTable.roundCode || "__no_round__";
  if (videoStartedForRound === roundId) return;

  // Start exactly around 4 seconds remaining (we allow 4..3 window)
  if (displayRemainingSeconds > KICK_SHOW_AT_REMAINING || displayRemainingSeconds <= KICK_FREEZE_AT_REMAINING) return;

  videoStartedForRound = roundId;
  videoFrozenForRound = null;

  const v = ensureKickVideoElement();
  if (!v) return;

  videoPlayer = v;

  // Always start from beginning at 4 seconds
  try {
    v.currentTime = 0;
  } catch (e) {
    // ignore
  }

  // Hide the ball during play (prevents double visuals)
  if (ballImg) ballImg.style.opacity = "0";

  v.play().catch((err) => console.warn("[video] play error:", err));
}

function freezeKickVideoAt2s() {
  if (!currentTable) return;
  if (!videoPlayer) return;

  const roundId = currentTable.roundCode || "__no_round__";
  if (videoFrozenForRound === roundId) return;

  if (displayRemainingSeconds <= KICK_FREEZE_AT_REMAINING) {
    videoFrozenForRound = roundId;

    try {
      videoPlayer.pause();
    } catch (e) {
      // ignore
    }

    // Show ball again while player stays frozen at ball position
    if (ballImg) ballImg.style.opacity = "1";
  }
}

// ================= BALL ANIMATION =================

function ensureTrajectoryStyles() {
  if (document.getElementById("trajectory-styles")) return;
  const style = document.createElement("style");
  style.id = "trajectory-styles";
  style.textContent = `
    @keyframes drawPath { to { stroke-dashoffset: 0; } }
    @keyframes goalFlash {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
      50% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
    }`;
  document.head.appendChild(style);
}

function createTrajectoryLine(startX, startY, endX, endY, peak) {
  ensureTrajectoryStyles();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "trajectory-line");
  svg.style.position = "absolute";
  svg.style.top = "0";
  svg.style.left = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "5";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2 + peak;
  const pathData = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
  path.setAttribute("d", pathData);
  path.setAttribute("stroke", "#fbbf24");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-dasharray", "8 6");
  path.setAttribute("fill", "none");
  path.setAttribute("opacity", "0.9");
  path.style.strokeDashoffset = "1000";
  path.style.animation = "drawPath 0.6s ease-out forwards";
  svg.appendChild(path);

  if (pitch) pitch.appendChild(svg);
  setTimeout(() => svg.parentNode && svg.parentNode.removeChild(svg), 1200);
}

function shootBallToWinningNumber(winningNumber) {
  if (!pitch || !ballImg) return;

  const targetGoal = goals.find((g) => g.dataset.number === String(winningNumber));
  if (!targetGoal) return;

  const pitchRect = pitch.getBoundingClientRect();
  const ballRect = ballImg.getBoundingClientRect();
  const goalRect = targetGoal.getBoundingClientRect();

  const startX = ballRect.left + ballRect.width / 2;
  const startY = ballRect.top + ballRect.height / 2;
  const endX = goalRect.left + goalRect.width / 2;
  const endY = goalRect.top + goalRect.height / 2;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const peak = -Math.min(100, distance * 0.3);
  const duration = 750;
  const startTime = performance.now();

  const pitchStartX = startX - pitchRect.left;
  const pitchStartY = startY - pitchRect.top;
  const pitchEndX = endX - pitchRect.left;
  const pitchEndY = endY - pitchRect.top;

  createTrajectoryLine(pitchStartX, pitchStartY, pitchEndX, pitchEndY, peak);

  setTimeout(() => {
    const originalTransform = ballImg.style.transform;

    ballImg.style.position = "fixed";
    ballImg.style.transition = "none";
    ballImg.style.zIndex = "1000";
    ballImg.style.left = `${startX}px`;
    ballImg.style.top = `${startY}px`;
    ballImg.style.transform = "translate(-50%, -50%)";

    function step(now) {
      const elapsed = now - startTime;
      const tRaw = elapsed / duration;
      const t = Math.min(Math.max(tRaw, 0), 1);

      const ease = 1 - Math.pow(1 - t, 3);
      const x = startX + deltaX * ease;
      const yLinear = startY + deltaY * ease;
      const yArc = yLinear + peak * (4 * t * (1 - t));
      const rotation = t * (distance * 1.5);
      const scale = 1 - t * 0.12;

      ballImg.style.left = `${x}px`;
      ballImg.style.top = `${yArc}px`;
      ballImg.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        targetGoal.classList.add("win");

        const flash = document.createElement("div");
        flash.style.position = "absolute";
        flash.style.top = "50%";
        flash.style.left = "50%";
        flash.style.transform = "translate(-50%, -50%)";
        flash.style.width = "150%";
        flash.style.height = "150%";
        flash.style.background = "radial-gradient(circle, rgba(34,197,94,0.6) 0%, transparent 70%)";
        flash.style.borderRadius = "50%";
        flash.style.pointerEvents = "none";
        flash.style.animation = "goalFlash 0.6s ease-out";
        flash.style.zIndex = "100";
        targetGoal.appendChild(flash);

        setTimeout(() => flash.remove(), 600);

        setTimeout(() => {
          ballImg.style.position = "";
          ballImg.style.left = "";
          ballImg.style.top = "";
          ballImg.style.transition = "transform 0.5s ease-out";
          ballImg.style.transform = originalTransform || "translate(0,0)";
          ballImg.style.zIndex = "10";

          // After shot finishes, remove the frozen kick video (clean)
          cleanupKickVideo({ restoreBall: true });
        }, 900);
      }
    }

    requestAnimationFrame(step);
  }, 280);
}

// ================= TIMER =================

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);

  localTimerInterval = setInterval(() => {
    if (gameFinished) return;

    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds -= 1;
      renderTimer();

      // Start video at 4 seconds
      maybeStartKickVideo();

      // Freeze at 2 seconds (do NOT remove)
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
        disableBettingUI();

        if (tablePollInterval) clearInterval(tablePollInterval);
        tablePollInterval = null;

        if (localTimerInterval) clearInterval(localTimerInterval);
        localTimerInterval = null;

        cleanupKickVideo({ restoreBall: true });

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

  // If a new round arrives while old video exists, clean it up.
  if (videoPlayer && videoStartedForRound && table.roundCode && videoStartedForRound !== table.roundCode) {
    cleanupKickVideo({ restoreBall: true });
  }

  if (roundIdSpan) roundIdSpan.textContent = table.roundCode || "-";

  // Sync timer from server, then local timer keeps it smooth
  displayRemainingSeconds = table.timeRemaining || 0;
  renderTimer();

  // Update goals + my bets
  updateGoalsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (playerCountSpan) playerCountSpan.textContent = table.playersCount || 0;

  // Betting enabled/disabled
  const maxPlayers = typeof table.maxPlayers === "number" ? table.maxPlayers : null;
  const isFull = maxPlayers !== null && (table.playersCount >= maxPlayers);

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled = !!table.isBettingClosed || isFull;
  }

  if (timerPill) {
    if (displayRemainingSeconds <= 10) timerPill.classList.add("urgent");
    else timerPill.classList.remove("urgent");
  }

  if (!gameFinished && !userHasBet && isFull) {
    gameFinished = true;
    disableBettingUI();
    if (tablePollInterval) clearInterval(tablePollInterval);
    tablePollInterval = null;
    if (localTimerInterval) clearInterval(localTimerInterval);
    localTimerInterval = null;

    cleanupKickVideo({ restoreBall: true });

    showSlotsFullPopup();
    return;
  }

  const hasResult = table.resultValue !== null && table.resultValue !== undefined && table.resultValue !== "";

  // ✅ Start at 4 seconds
  maybeStartKickVideo();

  // ✅ Freeze at 2 seconds (keep on screen)
  freezeKickVideoAt2s();

  // ✅ Shoot ball at <= 2 seconds remaining when result exists
  if (hasResult && table.timeRemaining <= 2) {
    const roundId = table.roundCode || "__no_round__";
    if (shotShownForRound !== roundId) {
      shotShownForRound = roundId;

      setStatus(`Winning number: ${table.resultValue}`, "ok");
      ensureGoalForWinningNumber(table.resultValue);
      shootBallToWinningNumber(table.resultValue);
    }
  }

  // ✅ Popup only when finished, after the ball animation
  if (hasResult && table.isFinished) {
    const roundId = table.roundCode || "__no_round__";
    if (popupShownForRound !== roundId) {
      popupShownForRound = roundId;

      gameFinished = true;
      disableBettingUI();

      if (tablePollInterval) clearInterval(tablePollInterval);
      tablePollInterval = null;

      if (localTimerInterval) clearInterval(localTimerInterval);
      localTimerInterval = null;

      const outcomeInfo = determineUserOutcome(table);

      setTimeout(() => {
        cleanupKickVideo({ restoreBall: true });
        showEndPopup(outcomeInfo);
      }, 1400);
    }
  }
}

function startPolling() {
  fetchTableData();
  if (tablePollInterval) clearInterval(tablePollInterval);

  // faster polling helps not miss the 4s / 2s windows
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
  // support both event names
  socket.emit("join_game", { game_type: GAME, user_id: USER_ID });
  socket.emit("joingame", { game_type: GAME, user_id: USER_ID });
}

socket.on("connect", () => {
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

// support both naming styles from backend
function handleBetSuccess(payload) {
  if (gameFinished) return;

  userHasBet = true;
  setStatus(payload?.message || "Bet placed ✓", "ok");

  const newBal = payload?.new_balance ?? payload?.newbalance;
  if (typeof newBal === "number") updateWallet(newBal);

  const players = payload?.players || payload?.bets;
  if (players && Array.isArray(players)) {
    const t = normalizeTable({ bets: players });
    updateGoalsFromBets(t.bets);
    updateMyBets(t.bets);
    if (playerCountSpan) playerCountSpan.textContent = t.bets.length;
  }
}

function handleUpdateTable(payload) {
  if (gameFinished) return;

  const t = normalizeTable(payload);
  if (t?.bets) {
    updateGoalsFromBets(t.bets);
    updateMyBets(t.bets);
    if (playerCountSpan) playerCountSpan.textContent = t.bets.length;
  }

  if (t?.timeRemaining != null) {
    displayRemainingSeconds = t.timeRemaining;
    renderTimer();
  }

  if (t?.isBettingClosed) disableBettingUI();
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
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    if (gameFinished) {
      setStatus("This game has already finished.", "error");
      return;
    }
    if (!currentTable) {
      setStatus("Game is not ready yet. Please wait...", "error");
      return;
    }

    const maxPlayers = typeof currentTable.maxPlayers === "number" ? currentTable.maxPlayers : null;
    if (maxPlayers !== null && currentTable.playersCount >= maxPlayers) {
      setStatus("All slots are full for this game.", "error");
      disableBettingUI();
      return;
    }

    if (walletBalance < FIXED_BET_AMOUNT) {
      setStatus("Insufficient balance", "error");
      return;
    }

    if (selectedNumber === null || selectedNumber === undefined) {
      setStatus("Select a number first", "error");
      return;
    }

    const payload = {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
      // round_code optional; backend can auto-assign an open table
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
