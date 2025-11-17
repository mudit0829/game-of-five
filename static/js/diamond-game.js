// ========= Basics =========
const GAME = GAME_TYPE || "diamond";

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

// ---- my bets row ----
function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => b.user_id === USER_ID);
  userBetCountLabel.textContent = myBets.length;

  myBetsRow.innerHTML = "";
  myBets.forEach((b) => {
    const chip = document.createElement("div");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsRow.appendChild(chip);
  });
}

// ---- targets from bets ----
function updateTargetsFromBets(bets) {
  const uniqueBets = [];
  (bets || []).forEach((b) => {
    if (!uniqueBets.find((x) => x.number === b.number)) {
      uniqueBets.push(b);
    }
  });

  targets.forEach((target, i) => {
    const numSpan = target.querySelector(".pad-number");
    const userSpan = target.querySelector(".pad-user");
    target.classList.remove("win");

    const bet = uniqueBets[i];

    if (!bet) {
      target.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    } else {
      target.dataset.number = String(bet.number);
      numSpan.textContent = bet.number;
      userSpan.textContent = bet.username;
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

  const duration = 650; // ms
  const peak = -80;     // arc height
  const startTime = performance.now();

  // trigger archer shoot animation
  archerImg.classList.add("shoot");
  setTimeout(() => archerImg.classList.remove("shoot"), 350);

  arrowImg.style.transition = "none";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    const ease = t < 0.5
      ? 2 * t * t
      : -1 + (4 - 2 * t) * t;

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

// ========= Socket.IO / backend =========
const socket = io();

async function registerUser() {
  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, username: USERNAME })
    });
    const data = await res.json();
    if (data && data.success) {
      updateWallet(data.balance || 0);
    }
  } catch (err) {
    console.error("register error", err);
  }
}

function joinGameRoom() {
  socket.emit("join_game", {
    game_type: GAME,
    user_id: USER_ID
  });
}

socket.on("connect", () => {
  joinGameRoom();
});

socket.on("connection_response", (data) => {
  console.log("server:", data);
});

socket.on("round_data", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};

  if (rd.round_code) {
    roundIdSpan.textContent = rd.round_code;
  } else if (rd.round_number) {
    roundIdSpan.textContent = rd.round_number;
  }

  timerText.textContent = rd.time_remaining ?? "--";
  playerCountSpan.textContent = rd.players ?? 0;

  updateTargetsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
});

socket.on("new_round", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};

  if (payload.round_code) {
    roundIdSpan.textContent = payload.round_code;
  } else if (payload.round_number) {
    roundIdSpan.textContent = payload.round_number;
  }

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
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  updateTargetsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  playerCountSpan.textContent = rd.players ?? 0;
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }
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

// ========= UI events =========
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

// ========= init =========
registerUser().then(joinGameRoom);
setSelectedNumber(0);
setStatus("");
