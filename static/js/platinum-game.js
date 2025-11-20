// ========= BASIC SETUP =========
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get('table');
const GAME = GAME_TYPE || "platinum";

// Unique user for platinum
let uid = localStorage.getItem("platinum_user_id");
if (!uid) {
  uid = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("platinum_user_id", uid);
}
const USER_ID = uid;

let uname = localStorage.getItem("platinum_username");
if (!uname) {
  uname = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("platinum_username", uname);
}
const USERNAME = uname;

// Set in the UI
document.getElementById("userName").textContent = USERNAME;

let walletBalance = 0;
let selectedNumber = 0;
let currentTableData = null;

// ---------------------------
// UI Helpers
// ---------------------------
function selectNumber(n) {
  selectedNumber = n;
  document.querySelectorAll(".num-chip").forEach(btn => {
    btn.classList.toggle("selected", parseInt(btn.dataset.number) === n);
  });
}

function setStatus(msg, type = "") {
  const s = document.getElementById("statusMessage");
  s.textContent = msg;
  s.className = "status";
  if (type) s.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = balance;
  document.getElementById("walletBalance").textContent = walletBalance;
  document.querySelector(".coins").classList.add("coin-bounce");
  setTimeout(() => {
    document.querySelector(".coins").classList.remove("coin-bounce");
  }, 500);
}

function updateBoatsFromBets(bets) {
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) betsByNumber[b.number] = [];
    betsByNumber[b.number].push(b);
  });

  // Get unique numbers (up to 6)
  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);
  const boats = document.querySelectorAll(".boat");
  boats.forEach((boat, i) => {
    const numSpan = boat.querySelector(".boat-number");
    const userSpan = boat.querySelector(".boat-user");
    boat.classList.remove("win");
    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      boat.dataset.number = number;
      numSpan.textContent = number;
      userSpan.textContent = betsOnNumber[0].username;
    } else {
      boat.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    }
  });
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter(b => b.user_id === USER_ID);
  document.getElementById("userBets").textContent = myBets.length;
  const container = document.getElementById("myBetsContainer");
  container.innerHTML = "";
  if (myBets.length === 0) {
    container.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
    return;
  }
  myBets.forEach(b => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    container.appendChild(chip);
  });
}

// ----------------------------
// PARATROOPER LANDING ANIMATION
// ----------------------------
function landCSSParatrooper(winningNumber) {
  const boats = document.querySelectorAll(".boat");
  let targetBoat = null;
  boats.forEach(boat => {
    if (boat.dataset.number === String(winningNumber)) {
      targetBoat = boat;
    }
  });
  if (!targetBoat) return;

  const rect = targetBoat.getBoundingClientRect();
  const para = document.getElementById("cssParatrooper");
  // Landing position
  const landingTop = rect.top - 70;
  const landingLeft = rect.left + rect.width / 2;
  para.style.transition = "none";
  para.style.top = "-300px";
  para.style.left = "50%";
  para.style.transform = "translateX(-50%)";
  para.classList.remove("falling");
  void para.offsetWidth;
  setTimeout(() => {
    para.classList.add("falling");
    para.style.transition = "top 2.8s cubic-bezier(0.22, 0.61, 0.36, 1), left 2.8s cubic-bezier(0.22, 0.61, 0.36, 1)";
    para.style.top = landingTop + "px";
    para.style.left = landingLeft + "px";
    setTimeout(() => {
      targetBoat.classList.add("win");
      createLandingSplash(rect);
      setTimeout(() => para.classList.remove("falling"), 100);
    }, 2600);
  }, 50);
}

// Splash/ripple effect
function createLandingSplash(boatRect) {
  const centerX = boatRect.left + boatRect.width / 2;
  const centerY = boatRect.top + boatRect.height / 2;
  const splash = document.createElement("div");
  splash.style.position = "fixed";
  splash.style.top = centerY + "px";
  splash.style.left = centerX + "px";
  splash.style.transform = "translate(-50%, -50%)";
  splash.style.width = "250px";
  splash.style.height = "250px";
  splash.style.background = "radial-gradient(circle, rgba(34,197,94,0.7) 0%, rgba(34,197,94,0.4) 40%, transparent 70%)";
  splash.style.borderRadius = "50%";
  splash.style.pointerEvents = "none";
  splash.style.animation = "splashPulse 1s ease-out";
  splash.style.zIndex = "100";
  document.body.appendChild(splash);

  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const ripple = document.createElement("div");
      ripple.style.position = "fixed";
      ripple.style.top = centerY + "px";
      ripple.style.left = centerX + "px";
      ripple.style.transform = "translate(-50%, -50%)";
      ripple.style.width = "100px";
      ripple.style.height = "100px";
      ripple.style.border = "3px solid rgba(34, 197, 94, 0.6)";
      ripple.style.borderRadius = "50%";
      ripple.style.pointerEvents = "none";
      ripple.style.animation = "rippleExpand 1.2s ease-out";
      ripple.style.zIndex = "99";
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 1200);
    }, i * 200);
  }
  setTimeout(() => splash.remove(), 1000);
}

if (!document.getElementById("splash-animations")) {
  const style = document.createElement("style");
  style.id = "splash-animations";
  style.textContent = `
    @keyframes splashPulse {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3);}
      40% { opacity: 1; transform: translate(-50%, -50%) scale(1);}
      100% { opacity:0; transform: translate(-50%, -50%) scale(1.8);}
    }
    @keyframes rippleExpand {
      0% { opacity: 0.8; transform: translate(-50%, -50%) scale(0.5);}
      100% { opacity: 0; transform: translate(-50%, -50%) scale(2.5);}
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------
// Backend Sync: GET table (for our round)
// ---------------------------
async function fetchTableData() {
  if (!TABLE_CODE) {
    setStatus("No table selected", "error");
    return;
  }
  try {
    const response = await fetch(`/api/tables/platinum`);
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
  document.getElementById("roundCode").textContent = table.round_code;
  document.getElementById("playerCount").textContent = table.players || 0;
  const mins = Math.floor(table.time_remaining / 60);
  const secs = table.time_remaining % 60;
  document.getElementById("timerText").textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  updateBoatsFromBets(table.bets || []);
  updateMyBets(table.bets || []);
  document.getElementById("placeBetBtn").disabled = !!table.is_betting_closed;
  if (table.is_betting_closed) {
    setStatus('Betting closed for this round', "error");
  }
  if (table.is_finished && table.result !== null && table.result !== undefined) {
    landCSSParatrooper(table.result);
    setStatus(`Winning number: ${table.result}`, "ok");
  }
}
setInterval(fetchTableData, 2000);

// ---------------------------
// Socket.IO
// ---------------------------
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

socket.on("round_data", (data) => {
  if (data.game_type !== GAME) return;
  // Only update if it's our table
  if (TABLE_CODE && data.round_data && data.round_data.round_code !== TABLE_CODE) return;
  const rd = data.round_data || {};
  document.getElementById("roundCode").textContent = rd.round_code;
  document.getElementById("playerCount").textContent = rd.players ?? 0;
  updateBoatsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
});

socket.on("new_round", (data) => {
  if (data.game_type !== GAME) return;
  const rd = data.round_data || {};
  document.getElementById("roundCode").textContent = data.round_code;
  document.getElementById("playerCount").textContent = rd.players ?? 0;
  updateBoatsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  setStatus("New round started", "ok");
  const para = document.getElementById("cssParatrooper");
  para.style.transition = "none";
  para.style.top = "-300px";
  para.style.left = "50%";
  para.style.transform = "translateX(-50%)";
  para.classList.remove("falling");
  document.querySelector(".timer-pill").classList.remove("urgent");
});

socket.on("bet_placed", data => {
  if (data.game_type !== GAME) return;
  fetchTableData();
});

socket.on("bet_success", data => {
  updateWallet(data.new_balance);
  setStatus("Bet placed successfully!", "ok");
  fetchTableData();
});

socket.on("bet_error", data => {
  setStatus(data.message || "Bet error", "error");
});

socket.on("round_result", data => {
  if (data.game_type !== GAME) return;
  const winning = data.result;
  setStatus("Winning: " + winning + "! 🎉", "ok");
  setTimeout(() => {
    landCSSParatrooper(winning);
  }, 150);
});

socket.on("timer_update", data => {
  if (data.game_type !== GAME) return;
  const timeRemaining = data.time_remaining || 0;
  document.getElementById("timerText").textContent = timeRemaining.toString().padStart(2, "0");
  document.getElementById("playerCount").textContent = data.players || 0;
  const pill = document.querySelector(".timer-pill");
  if (timeRemaining <= 10) {
    pill.classList.add("urgent");
  } else {
    pill.classList.remove("urgent");
  }
});

socket.on("betting_closed", data => {
  if (data.game_type !== GAME) return;
  setStatus("Betting closed", "error");
  document.getElementById("placeBetBtn").disabled = true;
});

// Number selector
document.querySelectorAll(".num-chip").forEach(btn => {
  btn.addEventListener("click", () => {
    selectNumber(parseInt(btn.dataset.number));
  });
});

// Place bet
document.getElementById("placeBetBtn").onclick = () => {
  if (walletBalance < FIXED_BET_AMOUNT) {
    setStatus("Insufficient balance", "error");
    return;
  }
  if (selectedNumber === null) {
    setStatus("Select a number first", "error");
    return;
  }
  socket.emit("place_bet", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber
  });
};

// Register user for wallet
fetch("/register", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({user_id: USER_ID, username: USERNAME})
})
.then(r => r.json())
.then(d => {
  if (d && d.success) updateWallet(d.balance || 0);
})
.catch(err => { console.error("Registration error:", err); });

// Initialize
selectNumber(0);
setStatus("");
