// ======== BASIC SETUP ========

const GAME = GAME_TYPE || "silver";

// Get table code from URL parameter
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get('table');

console.log('Game loaded. Table code:', TABLE_CODE);

// User ID and name
let uid = localStorage.getItem("user_id");
if (!uid) {
  uid = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("user_id", uid);
}
const USER_ID = uid;

let uname = localStorage.getItem("username");
if (!uname) {
  uname = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("username", uname);
}
const USERNAME = uname;

// ======== DOM REFERENCES ========

const frogImg = document.getElementById("frogSprite");
const pondEl = document.querySelector(".pond");
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
const userNameLabel = document.getElementById("userName");
const userBetCountLabel = document.getElementById("userBetCount");
const myBetsRow = document.getElementById("myBetsRow");

userNameLabel.textContent = USERNAME;

let walletBalance = 0;
let selectedNumber = 0;
let currentTableData = null;

// ======== FETCH TABLE DATA FROM BACKEND ========

async function fetchTableData() {
  if (!TABLE_CODE) {
    console.warn('No table code provided in URL');
    setStatus('No table selected', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/tables/${GAME}`);
    const data = await response.json();

    if (data.tables) {
      // Find specific table by round_code
      const table = data.tables.find(t => t.round_code === TABLE_CODE);

      if (table) {
        currentTableData = table;
        updateGameUI(table);
      } else {
        console.error('Table not found:', TABLE_CODE);
        setStatus('Table not found', 'error');
      }
    }
  } catch (error) {
    console.error('Error fetching table data:', error);
  }
}

// Update UI with backend table data
function updateGameUI(table) {
  // Update round code
  if (table.round_code) {
    roundIdSpan.textContent = table.round_code;
  }

  // Update player count
  playerCountSpan.textContent = table.players || 0;

  // Update timer
  const mins = Math.floor(table.time_remaining / 60);
  const secs = table.time_remaining % 60;
  timerText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  // Update lily pads with bets
  updatePadsFromBets(table.bets || []);

  // Update user's bets display
  updateMyBets(table.bets || []);

  // Check if betting is closed
  if (table.is_betting_closed) {
    setStatus('Betting closed for this round', 'error');
    placeBetBtn.disabled = true;
  } else {
    placeBetBtn.disabled = false;
  }

  // Show result if game is finished
  if (table.is_finished && table.result !== null && table.result !== undefined) {
    hopFrogToWinningNumber(table.result);
    setStatus(`Winning number: ${table.result}`, 'ok');
  }
}

// Auto-refresh table data every 2 seconds
setInterval(fetchTableData, 2000);

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

// Update "Your bets in this game" row
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

// Show one username + number per lily pad
function updatePadsFromBets(bets) {
  // Group bets by number
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) {
      betsByNumber[b.number] = [];
    }
    betsByNumber[b.number].push(b);
  });

  // Get unique numbers (up to 6)
  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);

  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");

    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      
      // Show number
      pad.dataset.number = number;
      numSpan.textContent = number;
      
      // Show first user who bet on this number
      userSpan.textContent = betsOnNumber[0].username;
    } else {
      // Empty pad
      pad.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    }
  });
}

// ======== FROG ANIMATION ========

function hopFrogToWinningNumber(winningNumber) {
  if (!frogImg || !pondEl) return;

  const targetPad = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );

  if (!targetPad) {
    console.log("No pad showing number", winningNumber);
    return;
  }

  const pondRect = pondEl.getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const baseCenterX = frogRect.left + frogRect.width / 2 - pondRect.left;
  const baseCenterY = frogRect.top + frogRect.height / 2 - pondRect.top;

  const endX = padRect.left + padRect.width / 2 - pondRect.left;
  const endY = padRect.top + padRect.height * 0.25 - pondRect.top;

  const startX = baseCenterX;
  const startY = baseCenterY;

  const deltaX = endX - startX;
  const deltaY = endY - startY;

  const duration = 750;
  const peak = -80;
  const startTime = performance.now();

  frogImg.style.transition = "none";
  frogImg.style.zIndex = "6";
  frogImg.style.willChange = "transform";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t));

    const scale = 1 + 0.08 * Math.sin(Math.PI * t);

    const relX = x - baseCenterX;
    const relY = yArc - baseCenterY;

    frogImg.style.transform = `translate(${relX}px, ${relY}px) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      frogImg.style.transform = `translate(${endX - baseCenterX}px, ${
        endY - baseCenterY
      }px) scale(1)`;
      targetPad.classList.add("win");
      frogImg.style.willChange = "auto";
    }
  }

  requestAnimationFrame(step);
}

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

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const data = await res.json();
    if (data && typeof data.balance === 'number') {
      updateWallet(data.balance);
    }
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
  console.log('Socket connected');
  joinGameRoom();
  fetchBalance();
  fetchTableData(); // Initial fetch
});

socket.on("connection_response", (data) => {
  console.log("server:", data);
});

socket.on("round_data", (payload) => {
  if (payload.game_type !== GAME) return;
  
  // Only update if it's our table
  if (TABLE_CODE && payload.round_data && payload.round_data.round_code !== TABLE_CODE) {
    return;
  }
  
  const rd = payload.round_data || {};

  if (rd.round_code) {
    roundIdSpan.textContent = rd.round_code;
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
  placeBetBtn.disabled = true;
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  
  // Refresh table data to get updated bets
  fetchTableData();
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }
  
  // Refresh table data
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
  hopFrogToWinningNumber(winning);
  
  // Check if user won
  const userWinner = (payload.winners || []).find(w => w.user_id === USER_ID);
  if (userWinner) {
    setTimeout(() => {
      setStatus(`🎉 YOU WON ₹${userWinner.payout}!`, "ok");
      fetchBalance(); // Update wallet
    }, 1500);
  }
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

fetchBalance();
fetchTableData();
setSelectedNumber(0);
setStatus("");
