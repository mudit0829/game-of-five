// ========== BASIC SETUP (DB USER, multi-table) ==========

const GAME = GAME_TYPE || "gold";

// --- Get table code from URL (multi-table sync!) ---
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table");

// REAL logged-in user from Flask session
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// ========== DOM SETUP ==========
const pitch = document.querySelector(".pitch");
const ballImg = document.getElementById("ballSprite");
const cssPlayer = document.getElementById("cssPlayer");
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

if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

let walletBalance = 0;
let selectedNumber = 0;
let playerShown = false;
let currentTableData = null;

// ========== UI HELPERS ==========

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

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => b.user_id === USER_ID);
  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }

  myBetsRow.innerHTML = "";
  if (myBets.length === 0) {
    myBetsRow.innerHTML =
      '<span style="color: #6b7280; font-size: 11px;">none</span>';
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

// ---- GOALS FROM BETS ====
function updateGoalsFromBets(bets) {
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) betsByNumber[b.number] = [];
    betsByNumber[b.number].push(b);
  });

  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);

  goals.forEach((goal, i) => {
    const numSpan = goal.querySelector(".pad-number");
    const userSpan = goal.querySelector(".pad-user");
    goal.classList.remove("win");

    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      goal.dataset.number = number;
      numSpan.textContent = number;
      userSpan.textContent = betsOnNumber[0].username;
    } else {
      goal.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    }
  });
}

// ======== DOTTED LINE TRAJECTORY ========
function createTrajectoryLine(startX, startY, endX, endY, peak) {
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
  pitch.appendChild(svg);

  setTimeout(() => svg.parentNode && svg.parentNode.removeChild(svg), 1200);
}

if (!document.getElementById("trajectory-styles")) {
  const style = document.createElement("style");
  style.id = "trajectory-styles";
  style.textContent = `
    @keyframes drawPath {
      to { stroke-dashoffset: 0; }
    }
    @keyframes goalFlash {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5);}
      50% { opacity:1; transform: translate(-50%, -50%) scale(1);}
      100% { opacity:0; transform: translate(-50%, -50%) scale(1.2);}
    }`;
  document.head.appendChild(style);
}

// ========== BALL SHOOTING ANIMATION ==========
function shootBallToWinningNumber(winningNumber) {
  const pitchRect = pitch.getBoundingClientRect();
  const ballRect = ballImg.getBoundingClientRect();
  const targetGoal = goals.find(
    (g) => g.dataset.number === String(winningNumber)
  );

  if (!targetGoal) {
    console.log("Winning number not on a goal:", winningNumber);
    return;
  }

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

  const pitchStartX = ballRect.left + ballRect.width / 2 - pitchRect.left;
  const pitchStartY = ballRect.top + ballRect.height / 2 - pitchRect.top;
  const pitchEndX = goalRect.left + goalRect.width / 2 - pitchRect.left;
  const pitchEndY = goalRect.top + goalRect.height / 2 - pitchRect.top;

  createTrajectoryLine(pitchStartX, pitchStartY, pitchEndX, pitchEndY, peak);

  cssPlayer && cssPlayer.classList.add("kick");

  setTimeout(() => {
    const originalTransform = ballImg.style.transform;

    ballImg.style.position = "fixed";
    ballImg.style.transition = "none";
    ballImg.style.zIndex = "1000";
    ballImg.style.left = startX + "px";
    ballImg.style.top = startY + "px";
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

      ballImg.style.left = x + "px";
      ballImg.style.top = yArc + "px";
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
        flash.style.background =
          "radial-gradient(circle, rgba(34,197,94,0.6) 0%, transparent 70%)";
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
        }, 900);
      }
    }

    requestAnimationFrame(step);
  }, 280);

  setTimeout(() => cssPlayer && cssPlayer.classList.remove("kick"), 800);
}

// ========== BACKEND API SYNC (tables) ==========

async function fetchTableData() {
  if (!TABLE_CODE) {
    setStatus("No table selected", "error");
    return;
  }
  try {
    const response = await fetch(`/api/tables/gold`);
    const data = await response.json();
    if (data.tables) {
      const table = data.tables.find((t) => t.round_code === TABLE_CODE);
      if (table) {
        currentTableData = table;
        updateGameUI(table);
      } else {
        setStatus("Table not found", "error");
      }
    }
  } catch (e) {
    console.error("fetchTableData error", e);
  }
}

function updateGameUI(table) {
  roundIdSpan.textContent = table.round_code;
  playerCountSpan.textContent = table.players || 0;
  const mins = Math.floor(table.time_remaining / 60);
  const secs = table.time_remaining % 60;
  timerText.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  updateGoalsFromBets(table.bets || []);
  updateMyBets(table.bets || []);
  placeBetBtn.disabled = !!table.is_betting_closed;

  if (table.is_betting_closed) {
    setStatus("Betting closed for this round", "error");
    placeBetBtn.disabled = true;
  }
  if (table.is_finished && table.result !== null && table.result !== undefined) {
    shootBallToWinningNumber(table.result);
    setStatus(`Winning number: ${table.result}`, "ok");
  }
}

setInterval(fetchTableData, 2000);

// ========== SOCKET.IO ==========
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
  if (
    TABLE_CODE &&
    payload.round_data &&
    payload.round_data.round_code !== TABLE_CODE
  )
    return;
  const rd = payload.round_data || {};
  roundIdSpan.textContent = rd.round_code;
  timerText.textContent = rd.time_remaining ?? "--";
  playerCountSpan.textContent = rd.players ?? 0;
  updateGoalsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
});

socket.on("new_round", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  roundIdSpan.textContent = rd.round_code;
  timerText.textContent = rd.time_remaining ?? "--";
  playerCountSpan.textContent = rd.players ?? 0;
  updateGoalsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  setStatus("New round started", "ok");

  ballImg.style.position = "";
  ballImg.style.left = "";
  ballImg.style.top = "";
  ballImg.style.transform = "";
  ballImg.style.zIndex = "10";
  playerArea.classList.remove("visible");
  playerShown = false;
  timerPill.classList.remove("urgent");
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  const timeRemaining = payload.time_remaining ?? 0;
  timerText.textContent = timeRemaining.toString().padStart(2, "0");
  playerCountSpan.textContent = payload.players ?? 0;
  if (timeRemaining <= 15 && !playerShown) {
    playerArea.classList.add("visible");
    playerShown = true;
  }
  if (timeRemaining <= 10) {
    timerPill.classList.add("urgent");
  } else {
    timerPill.classList.remove("urgent");
  }
});

socket.on("betting_closed", (payload) => {
  if (payload.game_type !== GAME) return;
  setStatus("Betting closed", "error");
  placeBetBtn.disabled = true;
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  fetchTableData();
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed!", "ok");
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
  shootBallToWinningNumber(winning);
});

// ========== UI EVENTS ==========
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
  if (selectedNumber == null) {
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

// ========== INIT ==========
fetchBalance();
fetchTableData();
setSelectedNumber(0);
setStatus("");
