// ================= BASIC SETUP =================
const GAME = window.GAME_TYPE || "silver";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 10;

const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

const USER_ID = window.GAME_USER_ID;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

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

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach((c) => (c.disabled = true));
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

function ensurePadForWinningNumber(winningNumber) {
  if (winningNumber == null) return;

  const str = String(winningNumber);
  const exists = pads.some((p) => p.dataset.number === str);
  if (exists) return;

  const pad = pads[0];
  if (!pad) return;

  pad.dataset.number = str;
  const numSpan = pad.querySelector(".pad-number");
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

// ================= FROG HOP (IDLE FROG MOVES) =================
// One frog only: keep idle video playing, move frogContainer in an arc to the winning pad.

function hopFrogToPad(targetPad, durationMs = 1200) {
  if (!frogContainer || !targetPad) return;

  const frogRect = frogContainer.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const startX = frogRect.left + frogRect.width / 2;
  const startY = frogRect.top + frogRect.height / 2;

  const endX = padRect.left + padRect.width / 2;
  const endY = padRect.top + padRect.height / 2;

  // arc height based on distance
  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const peak = -Math.min(160, Math.max(90, dist * 0.45));

  const duration = Math.max(700, Math.min(1800, Number(durationMs) || 1200));
  const startTime = performance.now();

  hopLandingETA = Date.now() + duration;

  // Switch to fixed positioning during hop so it can move anywhere
  frogContainer.style.position = "fixed";
  frogContainer.style.left = `${startX}px`;
  frogContainer.style.top = `${startY}px`;
  frogContainer.style.transform = "translate(-50%, -50%)";
  frogContainer.style.margin = "0";
  frogContainer.style.zIndex = "1200";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    // ease out
    const ease = 1 - Math.pow(1 - t, 3);

    const x = startX + dx * ease;
    const yLinear = startY + dy * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t));

    const scale = 1 + Math.sin(Math.PI * t) * 0.08; // small hop squash/stretch
    const rotate = (dx / (dist || 1)) * 6 * (1 - Math.abs(0.5 - t) * 2);

    frogContainer.style.left = `${x}px`;
    frogContainer.style.top = `${yArc}px`;
    frogContainer.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${rotate}deg)`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // landing bounce
      frogContainer.style.transition = "transform 0.25s ease-out";
      frogContainer.style.transform = "translate(-50%, -50%) scale(1)";

      setTimeout(() => {
        frogContainer.style.transition = "none";
      }, 260);

      targetPad.classList.add("win");
    }
  }

  requestAnimationFrame(step);
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
        disableBettingUI();
        setStatus("This game has finished. Going back to lobby...", "error");

        if (tablePollInterval) clearInterval(tablePollInterval);
        tablePollInterval = null;

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

  // Update pads + bets
  updatePadsFromBets(table.bets || []);
  const myBets = updateMyBets(table.bets || []);

  if (playerCountSpan) playerCountSpan.textContent = table.playersCount || 0;

  // Disable betting close to end
  if (placeBetBtn && !gameFinished) {
    const maxPlayers = typeof table.maxPlayers === "number" ? table.maxPlayers : null;
    const isFull = maxPlayers !== null && table.playersCount >= maxPlayers;
    placeBetBtn.disabled = !!table.isBettingClosed || isFull || displayRemainingSeconds <= 15;
  }

  const hasUserBet = myBets.length > 0;
  const maxPlayers = typeof table.maxPlayers === "number" ? table.maxPlayers : null;
  const isFull = maxPlayers !== null && table.playersCount >= maxPlayers;

  if (!gameFinished && !hasUserBet && isFull) {
    gameFinished = true;
    disableBettingUI();
    if (tablePollInterval) clearInterval(tablePollInterval);
    tablePollInterval = null;
    showSlotsFullPopup();
    return;
  }

  const hasResult = table.resultValue !== null && table.resultValue !== undefined && table.resultValue !== "";

  // ✅ Hop at 02 seconds when result is pre-selected by backend
  if (hasResult && table.timeRemaining <= 2) {
    const roundId = table.roundCode || "__no_round__";

    if (hopShownForRound !== roundId) {
      hopShownForRound = roundId;

      setStatus(`Winning number: ${table.resultValue}`, "ok");

      ensurePadForWinningNumber(table.resultValue);
      const targetPad = findPadForNumber(table.resultValue);

      if (targetPad) {
        hopFrogToPad(targetPad, 1200);
      }
    }
  }

  // ✅ Show popup only when finished, after hop landing
  if (hasResult && table.isFinished) {
    const roundId = table.roundCode || "__no_round__";

    if (popupShownForRound !== roundId && hasUserBet) {
      popupShownForRound = roundId;

      gameFinished = true;
      disableBettingUI();

      if (tablePollInterval) clearInterval(tablePollInterval);
      tablePollInterval = null;

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

// ================= SOCKET (optional updates) =================
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
    if (gameFinished) return setStatus("Game finished", "error");
    if (!currentTable) return setStatus("Game not ready", "error");

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
