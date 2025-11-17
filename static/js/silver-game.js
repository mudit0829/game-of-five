// ===== basic identity =====
const GAME = GAME_TYPE || "silver";

let uid = localStorage.getItem("frog_user_id");
if (!uid) {
  uid = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("frog_user_id", uid);
}
const USER_ID = uid;

let uname = localStorage.getItem("frog_username");
if (!uname) {
  uname = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("frog_username", uname);
}
const USERNAME = uname;

// ===== DOM =====
const frogImg = document.getElementById("frogSprite");
const pads = Array.from(document.querySelectorAll(".pad"));
const numChips = Array.from(document.querySelectorAll(".num-chip"));
const betInput = document.getElementById("betAmount");
const placeBetBtn = document.getElementById("placeBetBtn");
const roundIdSpan = document.getElementById("roundId");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const walletBalanceSpan = document.getElementById("walletBalance");
const statusEl = document.getElementById("statusMessage");
const coinsWrapper = document.querySelector(".coins");

let walletBalance = 0;
let selectedNumber = 0; // default

function setStatus(msg, type = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = balance;
  walletBalanceSpan.textContent = walletBalance.toFixed(0);
  coinsWrapper.classList.add("coin-bounce");
  setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

/**
 * Fill pads with up to 6 unique bet numbers.
 * If you want fixed 1–6 labels, you can replace this logic with
 * padNumber = index + 1 instead.
 */
function updatePadsFromBets(bets) {
  const uniqueNumbers = [];
  (bets || []).forEach((b) => {
    if (!uniqueNumbers.includes(b.number)) uniqueNumbers.push(b.number);
  });

  pads.forEach((pad, i) => {
    const span = pad.querySelector(".pad-number");
    const num = uniqueNumbers[i];
    pad.classList.remove("win");

    if (num === undefined) {
      pad.dataset.number = "";
      span.textContent = "";
    } else {
      pad.dataset.number = String(num);
      span.textContent = num;
    }
  });
}

// ===== Smooth frog jump (arc) =====

function jumpFrogToWinningNumber(winningNumber) {
  const targetPad = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );
  if (!targetPad) {
    console.log("Winning number not on any pad:", winningNumber);
    return;
  }

  const pondRect = document.querySelector(".pond").getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const startX = frogRect.left + frogRect.width / 2 - pondRect.left;
  const startY = frogRect.top + frogRect.height / 2 - pondRect.top;
  const endX = padRect.left + padRect.width / 2 - pondRect.left;
  const endY = padRect.top + padRect.height / 2 - pondRect.top;

  const deltaX = endX - startX;
  const deltaY = endY - startY;

  const duration = 600; // ms
  const peak = -80;     // jump height (negative = up)
  const startTime = performance.now();

  // remove any inline transform so we can control from JS
  frogImg.style.transition = "none";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    // Smooth easing
    const ease = t < 0.5
      ? 2 * t * t
      : -1 + (4 - 2 * t) * t;

    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t)); // parabola

    // convert to relative to left/top
    const relX = x - frogRect.width / 2;
    const relY = yArc - frogRect.height / 2;

    frogImg.style.transform = `translate(${relX}px, ${relY}px)`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // highlight pad
      targetPad.classList.add("win");
      // return to base after short delay
      setTimeout(() => {
        frogImg.style.transition = "transform 0.6s ease-out";
        frogImg.style.transform = "translateX(0) translateY(0)";
      }, 700);
    }
  }

  requestAnimationFrame(step);
}

// ===== backend / socket =====

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
  frogImg.style.transform = "translateX(0) translateY(0)";
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  timerText.textContent = (payload.time_remaining ?? 0).toString().padStart(2, "0");
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
  jumpFrogToWinningNumber(winning);
});

// ===== UI events =====

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

// ===== init =====
registerUser().then(joinGameRoom);
setSelectedNumber(0);
setStatus("");
