// ========= Basics =========
const GAME = GAME_TYPE || "gold";

let uid = localStorage.getItem("gold_user_id");
if (!uid) {
  uid = "user_" + Math.floor(Math.random() * 1e8);
  localStorage.setItem("gold_user_id", uid);
}
const USER_ID = uid;

let uname = localStorage.getItem("gold_username");
if (!uname) {
  uname = "Player" + Math.floor(Math.random() * 9999);
  localStorage.setItem("gold_username", uname);
}
const USERNAME = uname;

// ========= DOM =========
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

userNameLabel.textContent = USERNAME;

let walletBalance = 0;
let selectedNumber = 0;
let playerShown = false;

// ========= UI helpers =========
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

// ---- my bets inline display ----
function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => b.user_id === USER_ID);
  userBetCountLabel.textContent = myBets.length;

  myBetsRow.innerHTML = "";
  
  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color: #6b7280; font-size: 11px;">none</span>';
    return;
  }

  myBets.forEach((b, index) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsRow.appendChild(chip);
    
    // Add comma separator except for last item
    if (index < myBets.length - 1) {
      myBetsRow.appendChild(document.createTextNode(", "));
    }
  });
}

// ---- goals from bets ----
function updateGoalsFromBets(bets) {
  const uniqueBets = [];
  (bets || []).forEach((b) => {
    if (!uniqueBets.find((x) => x.number === b.number)) {
      uniqueBets.push(b);
    }
  });

  goals.forEach((goal, i) => {
    const numSpan = goal.querySelector(".pad-number");
    const userSpan = goal.querySelector(".pad-user");
    goal.classList.remove("win");

    const bet = uniqueBets[i];

    if (!bet) {
      goal.dataset.number = "";
      numSpan.textContent = "";
      userSpan.textContent = "";
    } else {
      goal.dataset.number = String(bet.number);
      numSpan.textContent = bet.number;
      userSpan.textContent = bet.username;
    }
  });
}

// ========= DOTTED LINE TRAJECTORY =========
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

  setTimeout(() => {
    if (svg.parentNode) {
      svg.parentNode.removeChild(svg);
    }
  }, 1200);
}

// CSS animations
if (!document.getElementById("trajectory-styles")) {
  const style = document.createElement("style");
  style.id = "trajectory-styles";
  style.textContent = `
    @keyframes drawPath {
      to { stroke-dashoffset: 0; }
    }
    @keyframes goalFlash {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.5);
      }
      50% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(1.2);
      }
    }
  `;
  document.head.appendChild(style);
}

// ========= PROFESSIONAL BALL SHOOTING =========
// ========= PROFESSIONAL BALL SHOOTING WITH KICK =========
function shootBallToWinningNumber(winningNumber) {
  const pitchRect = pitch.getBoundingClientRect();
  const ballRect = ballImg.getBoundingClientRect();
  const targetGoal = goals.find(
    (g) => g.dataset.number === String(winningNumber)
  );

  if (!targetGoal) {
    console.log("Winning number not on any goal:", winningNumber);
    return;
  }

  const goalRect = targetGoal.getBoundingClientRect();

  // Viewport coordinates
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

  // Trajectory line (relative to pitch)
  const pitchStartX = ballRect.left + ballRect.width / 2 - pitchRect.left;
  const pitchStartY = ballRect.top + ballRect.height / 2 - pitchRect.top;
  const pitchEndX = goalRect.left + goalRect.width / 2 - pitchRect.left;
  const pitchEndY = goalRect.top + goalRect.height / 2 - pitchRect.top;
  
  createTrajectoryLine(pitchStartX, pitchStartY, pitchEndX, pitchEndY, peak);

  // TRIGGER KICK ANIMATION
  cssPlayer.classList.add("kick");
  
  // Wait for kick wind-up (280ms - when foot hits ball)
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

      // Ease-out cubic for smooth deceleration
      const ease = 1 - Math.pow(1 - t, 3);

      const x = startX + deltaX * ease;
      const yLinear = startY + deltaY * ease;
      const yArc = yLinear + peak * (4 * t * (1 - t));

      const rotation = t * (distance * 1.5);
      const scale = 1 - (t * 0.12);
      
      ballImg.style.left = x + "px";
      ballImg.style.top = yArc + "px";
      ballImg.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // Goal reached!
        targetGoal.classList.add("win");
        
        // Goal flash
        const flash = document.createElement("div");
        flash.style.position = "absolute";
        flash.style.top = "50%";
        flash.style.left = "50%";
        flash.style.transform = "translate(-50%, -50%)";
        flash.style.width = "150%";
        flash.style.height = "150%";
        flash.style.background = "radial-gradient(circle, rgba(34,197,94,0.6) 0%, transparent 70%)";
        flash.style.borderRadius = "50%";
        flash.style.pointerEvents = "none";
        flash.style.animation = "goalFlash 0.6s ease-out";
        flash.style.zIndex = "100";
        targetGoal.appendChild(flash);
        
        setTimeout(() => flash.remove(), 600);

        // Return ball
        setTimeout(() => {
          ballImg.style.position = "";
          ballImg.style.left = "";
          ballImg.style.top = "";
          ballImg.style.transition = "transform 0.5s ease-out";
          ballImg.style.transform = originalTransform || "translate(0, 0)";
          ballImg.style.zIndex = "10";
        }, 900);
      }
    }

    requestAnimationFrame(step);
  }, 280); // Ball launches when foot makes contact

  // Remove kick class after animation completes
  setTimeout(() => cssPlayer.classList.remove("kick"), 800);
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

  updateGoalsFromBets(rd.bets || []);
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
  updateGoalsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  setStatus("New round started", "ok");
  
  // Reset ball
  ballImg.style.position = "";
  ballImg.style.left = "";
  ballImg.style.top = "";
  ballImg.style.transform = "";
  ballImg.style.zIndex = "10";
  
  // Hide player
  playerArea.classList.remove("visible");
  playerShown = false;
  timerPill.classList.remove("urgent");
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  const timeRemaining = payload.time_remaining ?? 0;
  
  timerText.textContent = timeRemaining.toString().padStart(2, "0");
  playerCountSpan.textContent = payload.players ?? 0;
  
  // Show CSS player at 15 seconds
  if (timeRemaining <= 15 && !playerShown) {
    playerArea.classList.add("visible");
    playerShown = true;
  }
  
  // Urgent timer
  if (timeRemaining <= 10) {
    timerPill.classList.add("urgent");
  } else {
    timerPill.classList.remove("urgent");
  }
});

socket.on("betting_closed", (payload) => {
  if (payload.game_type !== GAME) return;
  setStatus("Betting closed", "error");
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  updateGoalsFromBets(rd.bets || []);
  updateMyBets(rd.bets || []);
  playerCountSpan.textContent = rd.players ?? 0;
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed!", "ok");
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
  setStatus(`Winner: ${winning}! 🎉`, "ok");
  
  setTimeout(() => {
    shootBallToWinningNumber(winning);
  }, 100);
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
