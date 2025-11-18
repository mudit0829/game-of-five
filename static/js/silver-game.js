// ======== BASIC SETUP ========

const GAME = GAME_TYPE || "silver"; // "silver" game type from Flask

// simple local user id / name
let uid = localStorage.getItem("silver_user_id");
if (!uid) {
  uid = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("silver_user_id", uid);
}
const USER_ID = uid;

let uname = localStorage.getItem("silver_username");
if (!uname) {
  uname = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("silver_username", uname);
}
const USERNAME = uname;

// ======== DOM REFERENCES ========

const frogImg = document.getElementById("frogSprite");
// IMPORTANT: use the .pond card, not the frog's parent
const pondEl = document.querySelector(".pond"); // CHANGED

const pads = Array.from(document.querySelectorAll(".pad")); // lily pads

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

// ======== UI HELPERS ========

function setStatus(msg, type = "") {
  if (!statusEl) return;
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

// update "Your bets in this game" row
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

// show one username + number per lily pad
function updatePadsFromBets(bets) {
  const uniqueBets = [];
  (bets || []).forEach((b) => {
    if (!uniqueBets.find((x) => x.number === b.number)) {
      uniqueBets.push(b);
    }
  });

  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");

    const bet = uniqueBets[i];

    if (!bet) {
      pad.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    } else {
      pad.dataset.number = String(b.number);
      numSpan.textContent = bet.number;
      userSpan.textContent = bet.username;
    }
  });
}

// ======== FROG ANIMATION ========

// Jump in a smooth arc from current frog position to the pad that has winningNumber
function hopFrogToWinningNumber(winningNumber) {
  if (!frogImg || !pondEl) return;

  const targetPad = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );

  if (!targetPad) {
    console.log("No pad currently showing number", winningNumber);
    return;
  }

  const pondRect = pondEl.getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  // current frog center relative to pond
  const baseCenterX = frogRect.left + frogRect.width / 2 - pondRect.left;
  const baseCenterY = frogRect.top + frogRect.height / 2 - pondRect.top;

  // target position: a little above the pad center
  const endX = padRect.left + padRect.width / 2 - pondRect.left;
  const endY = padRect.top + padRect.height * 0.25 - pondRect.top;

  const startX = baseCenterX;
  const startY = baseCenterY;

  const deltaX = endX - startX;
  const deltaY = endY - startY;

  const duration = 750; // ms
  const peak = -80; // height of the arc
  const startTime = performance.now();

  frogImg.style.transition = "none";
  frogImg.style.zIndex = "6";
  frogImg.style.willChange = "transform";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    // ease in-out
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;

    // parabolic arc: peak at t=0.5
    const yArc = yLinear + peak * (4 * t * (1 - t));

    // little scale bump in the middle of jump
    const scale = 1 + 0.08 * Math.sin(Math.PI * t);

    const relX = x - baseCenterX;
    const relY = yArc - baseCenterY;

    frogImg.style.transform = `translate(${relX}px, ${relY}px) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // sit nicely on pad at end
      frogImg.style.transform = `translate(${endX - baseCenterX}px, ${
        endY - baseCenterY
      }px) scale(1)`;
      targetPad.classList.add("win");
      frogImg.style.willChange = "auto";
    }
  }

  requestAnimationFrame(step);
}

// reset frog back to original center (used on new round)
function resetFrogPosition() {
  if (!frogImg) return;
  frogImg.style.transition = "transform 0.4s ease-out";
  frogImg.style.transform = "translate(0, 0) scale(1)";
  frogImg.style.zIndex = "5";
  setTimeout(() => {
    frogImg.style.transition = "none";
  }, 400);
}

// ======== SOCKET.IO / BACKEND ========

const socket = io();

async function registerUser() {
  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, username: USERNAME }),
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
    user_id: USER_ID,
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

  updatePadsFromBets(rd.bets || []);
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
  updatePadsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  setStatus("New round started", "ok");

  resetFrogPosition();
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  timerText.textContent = (payload.time_remaining ?? 0)
    .toString()
    .padStart(2, "0");
  playerCountSpan.textContent = payload.players ?? 0;
});

socket.on("betting_closed", (payload) => {
  if (payload.game_type !== GAME) return;
  setStatus("Betting closed for this round", "error");
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  updatePadsFromBets(rd.bets || []);
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
  hopFrogToWinningNumber(winning);
});

// ======== UI EVENTS ========

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
    number: selectedNumber,
  });
});

// ======== INIT ========

registerUser().then(joinGameRoom);
setSelectedNumber(0);
setStatus("");
