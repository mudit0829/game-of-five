// ========= basic user identity =========
const GAME = GAME_TYPE || "silver";

let storedId = localStorage.getItem("frog_user_id");
if (!storedId) {
  storedId = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("frog_user_id", storedId);
}
const USER_ID = storedId;

let storedName = localStorage.getItem("frog_username");
if (!storedName) {
  storedName = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("frog_username", storedName);
}
const USERNAME = storedName;

let walletBalance = 0;
let selectedNumber = null;

// DOM elements
const frogImg = document.getElementById("frogSprite");
const pads = Array.from(document.querySelectorAll(".pad"));
const numButtons = Array.from(document.querySelectorAll(".num-btn"));
const betInput = document.getElementById("betAmount");
const placeBetBtn = document.getElementById("placeBetBtn");
const roundIdSpan = document.getElementById("roundId");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const walletSpan = document.getElementById("walletBalance");
const statusEl = document.getElementById("statusMessage");

function setStatus(msg, type = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWalletUI() {
  walletSpan.textContent = walletBalance.toFixed(0);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numButtons.forEach((btn) => {
    const val = parseInt(btn.dataset.number, 10);
    btn.classList.toggle("selected", val === n);
  });
}

// Map bets -> up to 6 unique numbers -> show on pads
function updatePadsFromBets(bets) {
  const uniqueNumbers = [];
  (bets || []).forEach((b) => {
    if (!uniqueNumbers.includes(b.number)) {
      uniqueNumbers.push(b.number);
    }
  });

  pads.forEach((pad, index) => {
    const numSpan = pad.querySelector(".pad-number");
    const num = uniqueNumbers[index];
    pad.classList.remove("win");

    if (num === undefined) {
      pad.dataset.number = "";
      numSpan.textContent = "";
    } else {
      pad.dataset.number = String(num);
      numSpan.textContent = num;
    }
  });
}

// frog movement: from back to winning pad
function animateFrogToNumber(winningNumber) {
  const targetPad = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );
  if (!targetPad) {
    console.log("No pad for winning number", winningNumber);
    return;
  }

  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const frogCenterX = frogRect.left + frogRect.width / 2;
  const frogCenterY = frogRect.top + frogRect.height / 2;
  const padCenterX = padRect.left + padRect.width / 2;
  const padCenterY = padRect.top + padRect.height / 2;

  const dx = padCenterX - frogCenterX;
  const dy = padCenterY - frogCenterY;

  frogImg.style.transition = "transform 0.6s ease-out";
  frogImg.style.transform = `translateX(-50%) translate(${dx}px, ${dy}px)`;
  targetPad.classList.add("win");

  // after some time, send frog back
  setTimeout(() => {
    frogImg.style.transition = "transform 0.5s ease-out";
    frogImg.style.transform = "translateX(-50%)";
  }, 1500);
}

// ========= Socket.IO + backend =========
const socket = io(); // same origin

async function registerUser() {
  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, username: USERNAME })
    });
    const data = await res.json();
    if (data && data.success) {
      walletBalance = data.balance || 0;
      updateWalletUI();
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
  console.log("socket connected");
  joinGameRoom();
});

socket.on("connection_response", (data) => {
  console.log("server:", data);
});

socket.on("round_data", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  if (payload.round_number) roundIdSpan.textContent = payload.round_number;
  timerText.textContent = rd.time_remaining ?? "--";
  playerCountSpan.textContent = (rd.bets || []).length;
  updatePadsFromBets(rd.bets || []);
});

socket.on("new_round", (payload) => {
  if (payload.game_type !== GAME) return;
  roundIdSpan.textContent = payload.round_number || "";
  const rd = payload.round_data || {};
  timerText.textContent = rd.time_remaining ?? "--";
  updatePadsFromBets(rd.bets || []);
  setStatus("New round started", "ok");
  frogImg.style.transform = "translateX(-50%)";
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  timerText.textContent = (payload.time_remaining ?? 0).toString();
  playerCountSpan.textContent = payload.total_bets ?? 0;
});

socket.on("betting_closed", (payload) => {
  if (payload.game_type !== GAME) return;
  setStatus("Betting closed for this round", "error");
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  updatePadsFromBets(rd.bets || []);
  playerCountSpan.textContent = (rd.bets || []).length;
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    walletBalance = payload.new_balance;
    updateWalletUI();
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
  animateFrogToNumber(winning);
});

// ========= UI events =========
numButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const n = parseInt(btn.dataset.number, 10);
    setSelectedNumber(n);
  });
});

placeBetBtn.addEventListener("click", () => {
  if (selectedNumber === null) {
    setStatus("Select a number first", "error");
    return;
  }

  if (walletBalance < FIXED_BET_AMOUNT) {
    setStatus("Insufficient balance", "error");
    return;
  }

  // amount is fixed per your config – we ignore user typing for now
  socket.emit("place_bet", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber
  });
});

// ========= init =========
registerUser().then(() => {
  joinGameRoom();
});
setSelectedNumber(0);
