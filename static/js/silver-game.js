// ================= BASIC SETUP (DB USER) =================

const GAME = GAME_TYPE || "silver";

// optional: support multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;

// Real logged-in user from Flask session (passed in HTML)
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// Where popup "Home" button goes
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

// IMPORTANT: use the pond container for coordinates
const pondEl = document.querySelector(".pond");
const frogImg = document.getElementById("frogSprite");
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

// popup elements (used both for result + "slots full")
const popupEl = document.getElementById("resultPopup");
const popupTitleEl = document.getElementById("popupTitle");
const popupMsgEl = document.getElementById("popupMessage");
const popupHomeBtn = document.getElementById("popupHomeBtn");
const popupLobbyBtn = document.getElementById("popupLobbyBtn");

if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

let walletBalance = 0;
let selectedNumber = 0;

let currentTable = null;
let lastResultShown = null;

// flags / intervals
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;

// IMPORTANT: persistent flag – once true, never set back to false
let userHasBet = false;

// ================= UI HELPERS =================

function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = balance;
  if (walletBalanceSpan) {
    walletBalanceSpan.textContent = walletBalance.toFixed(0);
  }
  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

function updateMyBets(bets) {
  const myBets = (bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );

  if (myBets.length > 0) {
    userHasBet = true;
  }

  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }

  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  if (myBets.length === 0) {
    const span = document.createElement("span");
    span.style.color = "#6b7280";
    span.style.fontSize = "11px";
    span.textContent = "none";
    myBetsRow.appendChild(span);
    return;
  }

  myBets.forEach((b, index) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsRow.appendChild(chip);
    if (index < myBets.length - 1) {
      myBetsRow.appendChild(document.createTextNode(", "));
    }
  });
}

/**
 * One pad = one bet (first 6 bets).
 */
function updatePadsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");

    if (i < list.length) {
      const b = list[i];
      pad.dataset.number = String(b.number);
      if (numSpan) numSpan.textContent = b.number;
      if (userSpan) userSpan.textContent = b.username;
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

/**
 * Ensure at least one pad shows winning number.
 */
function ensurePadForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;

  const existing = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );
  if (existing) return;

  const pad = pads[0];
  if (!pad) return;

  const numSpan = pad.querySelector(".pad-number");
  const userSpan = pad.querySelector(".pad-user");

  pad.dataset.number = String(winningNumber);
  if (numSpan) numSpan.textContent = winningNumber;
  if (userSpan) userSpan.textContent = "";
}

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach((chip) => {
    chip.disabled = true;
  });
}

function determineUserOutcome(table) {
  const result = table.result;
  const myBets = (table.bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );
  if (!myBets.length) {
    return { outcome: "none", result };
  }
  const won = myBets.some((b) => String(b.number) === String(result));
  return { outcome: won ? "win" : "lose", result };
}

function showEndPopup(outcomeInfo) {
  if (!popupEl) return;

  const { outcome } = outcomeInfo;

  let title = "Game Finished";
  let message =
    "This game has ended. Please keep playing to keep your winning chances high.";

  if (outcome === "win") {
    title = "Congratulations!";
    message =
      "You have won the game. Please keep playing to keep your winning chances high.";
  } else if (outcome === "lose") {
    title = "Hard Luck!";
    message =
      "You have lost the game. Please keep playing to keep your winning chances high.";
  }

  if (popupTitleEl) popupTitleEl.textContent = title;
  if (popupMsgEl) popupMsgEl.textContent = message;

  popupEl.style.display = "flex";
}

function showSlotsFullPopup() {
  if (!popupEl) return;

  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl)
    popupMsgEl.textContent =
      "This game is already full. You will be redirected to lobby to join another table.";

  popupEl.style.display = "flex";

  setTimeout(() => {
    window.history.back();
  }, 2000);
}

function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  try {
    const url = new URL(window.location.href);
    const currentParam = url.searchParams.get("table");
    if (currentParam === roundCode) return;
    url.searchParams.set("table", roundCode);
    window.history.replaceState({}, "", url.toString());
  } catch (err) {
    console.warn("Unable to sync URL with table code", err);
  }
}

// ================= FROG ANIMATION =================

if (frogImg) {
  frogImg.style.transition =
    "transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1)";
  frogImg.style.transformOrigin = "center center";
}

function findPadForNumber(winningNumber) {
  const targetStr = String(winningNumber);

  return pads.find((p) => {
    const dataMatch = p.dataset.number === targetStr;
    const label = p.querySelector(".pad-number");
    const textMatch =
      label && label.textContent && label.textContent.trim() === targetStr;
    return dataMatch || textMatch;
  });
}

/* ✅ ONLY FIX IS HERE — FUNCTION STILL EXISTS, NAME UNCHANGED */
function hopFrogToWinningNumber(winningNumber) {
  if (!frogImg) return;

  const targetPad = findPadForNumber(winningNumber);
  if (!targetPad) return;

  const pondRect = pondEl.getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const frogCenterX =
    frogRect.left + frogRect.width / 2 - pondRect.left;
  const frogCenterY =
    frogRect.top + frogRect.height / 2 - pondRect.top;

  const padCenterX =
    padRect.left + padRect.width / 2 - pondRect.left;
  const padCenterY =
    padRect.top + padRect.height * 0.3 - pondRect.top;

  const deltaX = padCenterX - frogCenterX;
  const deltaY = padCenterY - frogCenterY;

  frogImg.style.transform =
    `translate(${deltaX}px, ${deltaY}px) scale(1.05)`;

  setTimeout(() => {
    frogImg.style.transform =
      `translate(${deltaX}px, ${deltaY}px) scale(1)`;
    targetPad.classList.add("win");
  }, 720);
}

// ================= TIMER =================

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (!gameFinished && displayRemainingSeconds > 0) {
      displayRemainingSeconds--;
      renderTimer();
    }
  }, 1000);
}

// ================= BACKEND POLLING =================

async function fetchTableData() {
  if (gameFinished) return;

  const res = await fetch("/api/tables/silver");
  const data = await res.json();
  if (!data.tables || !data.tables.length) return;

  let table = null;
  if (TABLE_CODE) {
    table = data.tables.find((t) => t.round_code === TABLE_CODE) || null;
  }
  if (!table) table = data.tables[0];

  syncUrlWithTable(table.round_code);
  currentTable = table;
  updateGameUI(table);
}

function updateGameUI(table) {
  if (!table) return;

  roundIdSpan.textContent = table.round_code || "-";
  playerCountSpan.textContent = table.players || 0;

  displayRemainingSeconds = table.time_remaining || 0;
  renderTimer();

  updatePadsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  const hasResult =
    table.result !== null && table.result !== undefined && table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    lastResultShown = table.result;
    setStatus(`Winning number: ${table.result}`, "ok");

    ensurePadForWinningNumber(table.result);
    hopFrogToWinningNumber(table.result);

    gameFinished = true;
    disableBettingUI();

    const outcomeInfo = determineUserOutcome(table);
    setTimeout(() => {
      showEndPopup(outcomeInfo);
    }, 1100);
  }
}

// ================= SOCKET =================

const socket = io();

async function fetchBalance() {
  const res = await fetch(`/balance/${USER_ID}`);
  const data = await res.json();
  if (typeof data.balance === "number") {
    updateWallet(data.balance);
  }
}

function joinGameRoom() {
  socket.emit("join_game", {
    game_type: GAME,
    user_id: USER_ID,
  });
}

socket.on("connect", () => {
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

// ================= UI EVENTS =================

numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (!gameFinished) {
      setSelectedNumber(parseInt(chip.dataset.number, 10));
    }
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    if (gameFinished) return;
    if (!currentTable) return;

    socket.emit("place_bet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });
  });
}

// ================= INIT =================

fetchBalance();
fetchTableData();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
