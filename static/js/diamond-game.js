// ========= Basics =========
const GAME = GAME_TYPE || "diamond";

// --- Multi-table: get round_code from URL ---
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get('table');

let uid = localStorage.getItem("diamond_user_id");
if (!uid) {
  uid = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("diamond_user_id", uid);
}
const USER_ID = uid;

let uname = localStorage.getItem("diamond_username");
if (!uname) {
  uname = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("diamond_username", uname);
}
const USERNAME = uname;

// ========= DOM =========
const rangeEl = document.querySelector(".range");
const arrowImg = document.getElementById("arrowSprite");
const archerImg = document.getElementById("archerSprite");
const targets = Array.from(document.querySelectorAll(".target.pad"));
const numChips = Array.from(document.querySelectorAll(".num-chip"));
const betInput = document.getElementById("betAmount");
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

userNameLabel.textContent = USERNAME;

let walletBalance = 0;
let selectedNumber = 0;
let currentTableData = null;

// ========= UI helpers =========
function setStatus(msg, type = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = balance;
  walletBalanceSpan.textContent = walletBalance.toFixed(0);
  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => b.user_id === USER_ID);
  userBetCountLabel.textContent = myBets.length;
  myBetsRow.innerHTML = "";
  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color:#6b7280; font-size:11px;">none</span>';
    return;
  }
  myBets.forEach((b) => {
    const chip = document.createElement("div");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsRow.appendChild(chip);
  });
}

function updateTargetsFromBets(bets) {
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) betsByNumber[b.number] = [];
    betsByNumber[b.number].push(b);
  });
  // Get unique numbers (up to 6)
  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);
  targets.forEach((target, i) => {
    const numSpan = target.querySelector(".pad-number");
    const userSpan = target.querySelector(".pad-user");
    target.classList.remove("win");
    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      target.dataset.number = number;
      numSpan.textContent = number;
      userSpan.textContent = betsOnNumber[0].username;
    } else {
      target.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    }
  });
}

// ========= Arrow animation + archer shoot =========
function shootArrowToWinningNumber(winningNumber) {
  const rangeRect = rangeEl.getBoundingClientRect();
  const arrowRect = arrowImg.getBoundingClientRect();
  const target = targets.find(
    (t) => t.dataset.number === String(winningNumber)
  );
  if (!target) {
    console.log("Winning number not on any target:", winningNumber);
    return;
  }
  const targetRect = target.getBoundingClientRect();

  // start: arrow base near bow
  const startX = arrowRect.left + arrowRect.width * 0.2 - rangeRect.left;
  const startY = arrowRect.top + arrowRect.height * 0.5 - rangeRect.top;

  // end: just in front of target centre
  const endX = targetRect.left + targetRect.width * 0.5 - rangeRect.left;
  const endY = targetRect.top + targetRect.height * 0.5 - rangeRect.top;
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  const duration = 650;
  const peak = -80;
  const startTime = performance.now();

  // trigger archer shoot animation
  archerImg.classList.add("shoot");
  setTimeout(() => archerImg.classList.remove("shoot"), 350);

  arrowImg.style.transition = "none";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t));

    const relX = x - arrowRect.width * 0.2;
    const relY = yArc - arrowRect.height * 0.5;

    arrowImg.style.transform = `translate(${relX}px, ${relY}px) rotate(${
      Math.atan2(deltaY, deltaX) * (180 / Math.PI)
    }deg)`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      target.classList.add("win");
      setTimeout(() => {
        arrowImg.style.transition = "transform 0.5s ease-out";
        arrowImg.style.transform = "translate(0, 0) rotate(0deg)";
      }, 700);
    }
  }

  requestAnimationFrame(step);
}

// ========= Backend API sync: get table data/live bets/players for our round =========

async function fetchTableData() {
  if (!TABLE_CODE) {
    setStatus("No table selected", "error");
    return;
  }
  try {
    const response = await fetch(`/api/tables/diamond`);
    const data = await response.json();
    if (data.tables) {
      const table = data.tables.find(t => t.round_code === TABLE_CODE);
      if (table) {
        currentTableData = table;
        updateGameUI(table);
      } else {
        setStatus("Table not found", "error");
      }
    }
  } catch (e) {
    console.error('fetchTableData error', e);
  }
}

function updateGameUI(table) {
  roundIdSpan.textContent = table.round_code;
  playerCountSpan.textContent = table.players || 0;
  const mins = Math.floor(table.time_remaining / 60);
  const secs = table.time_remaining % 60;
  timerText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  updateTargetsFromBets(table.bets || []);
  updateMyBets(table.bets || []);
  placeBetBtn.disabled = !!table.is_betting_closed;

  if (table.is_betting_closed) {
    setStatus('Betting closed for this round', 'error');
    placeBetBtn.disabled = true;
  }
  if (table.is_finished && table.result !== null && table.result !== undefined) {
    shootArrowToWinningNumber(table.result);
    setStatus(`Winning number: ${table.result}`, "ok");
  }
}

// Auto-refresh data every 2 seconds
setInterval(fetchTableData, 2000);

// ========= SOCKET.IO API =========
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

socket.on("round_data", (payload) => {
  if (payload.game_type !== GAME) return;
  // Only update if our actual table
  if (TABLE_CODE && payload.round_data && payload.round_data.round_code !== TABLE_CODE) return;
  const rd = payload.round_data || {};
  roundIdSpan.textContent = rd.round_code;
  timerText.textContent = rd.time_remaining ?? "--";
  playerCountSpan.textContent = rd.players ?? 0;
  updateTargetsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
});

socket.on("new_round", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  roundIdSpan.textContent = rd.round_code;
  timerText.textContent = rd.time_remaining ?? "--";
  playerCountSpan.textContent = rd.players ?? 0;
  updateTargetsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  setStatus("New round started", "ok");
  arrowImg.style.transform = "translate(0, 0) rotate(0deg)";
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  timerText.textContent = (payload.time_remaining ?? 0).toString().padStart(2, "0");
  playerCountSpan.textContent = payload.players ?? 0;
});

socket.on("betting_closed", (payload) => {
  if (payload.game_type !== GAME) return;
  setStatus("Betting closed for this round", "error");
  placeBetBtn.disabled = true;
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  fetchTableData();
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }
  fetchTableData();
});

socket.on("bet_error", (payload) => {
  setStatus(payload.message || "Bet error", "error");
});

socket.on("round_result", (payload) => {
  if (payload.game_type !== GAME) return;
  const winning = payload.result;
  if (winning === undefined || winning === null) return;
  setStatus(`Winning number: ${winning}`, "ok");
  shootArrowToWinningNumber(winning);
});

// ========= UI EVENTS =========
numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

placeBetBtn.addEventListener("click", () => {
  if (walletBalance < FIXED_BET_AMOUNT) {
    setStatus("Insufficient balance", "error");
    return;
  }
  if (selectedNumber === null || selectedNumber === undefined) {
    setStatus("Select a number first", "error");
    return;
  }

  socket.emit("place_bet", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber
  });
});

// ========= INIT =========
fetchBalance();
fetchTableData();
setSelectedNumber(0);
setStatus("");
