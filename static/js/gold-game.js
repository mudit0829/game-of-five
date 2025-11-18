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
const playerImg = document.getElementById("playerSprite");
const playerArea = document.querySelector(".player-area");
const goals = Array.from(document.querySelectorAll(".goal.pad"));
const numChips = Array.from(document.querySelectorAll(".num-chip"));
const betInput = document.getElementById("betAmount");
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

// ========= DOTTED LINE TRAJECTORY ANIMATION =========
function createTrajectoryLine(startX, startY, endX, endY, peak) {
  // Create SVG overlay for dotted line
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
  
  // Calculate control point for quadratic curve (arc)
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2 + peak;

  // Quadratic Bezier curve: M start, Q control end
  const pathData = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
  path.setAttribute("d", pathData);
  path.setAttribute("stroke", "#fbbf24"); // Yellow/gold color
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-dasharray", "8 6"); // Dotted pattern
  path.setAttribute("fill", "none");
  path.setAttribute("opacity", "0.8");
  
  // Animate the stroke
  path.style.strokeDashoffset = "1000";
  path.style.animation = "drawPath 0.6s ease-out forwards";

  svg.appendChild(path);
  pitch.appendChild(svg);

  // Remove after animation
  setTimeout(() => {
    if (svg.parentNode) {
      svg.parentNode.removeChild(svg);
    }
  }, 1200);
}

// Add CSS animation for path drawing
const style = document.createElement("style");
style.textContent = `
  @keyframes drawPath {
    to {
      stroke-dashoffset: 0;
    }
  }
`;
document.head.appendChild(style);

// ========= PROFESSIONAL BALL SHOOTING ANIMATION =========
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

  // Starting center of ball (relative to pitch)
  const startX = ballRect.left + ballRect.width / 2 - pitchRect.left;
  const startY = ballRect.top + ballRect.height / 2 - pitchRect.top;

  // End point: center of goal (slightly in front of net)
  const endX = goalRect.left + goalRect.width / 2 - pitchRect.left;
  const endY = goalRect.top + goalRect.height * 0.35 - pitchRect.top;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  // Arc height based on distance (longer shots = higher arc)
  const peak = -Math.min(120, distance * 0.35);
  
  const duration = 800; // ms - smooth professional speed
  const startTime = performance.now();

  // Create dotted trajectory line
  createTrajectoryLine(startX, startY, endX, endY, peak);

  // Trigger player kick animation FIRST
  playerImg.classList.add("kick");
  
  // Start ball movement after brief delay (kick wind-up)
  setTimeout(() => {
    ballImg.style.transition = "none";
    ballImg.style.zIndex = "15"; // Ball above everything during flight

    function step(now) {
      const elapsed = now - startTime;
      const tRaw = elapsed / duration;
      const t = Math.min(Math.max(tRaw, 0), 1);

      // Ease-out cubic for smooth deceleration
      const ease = 1 - Math.pow(1 - t, 3);

      // Calculate position along curved path
      const x = startX + deltaX * ease;
      const yLinear = startY + deltaY * ease;
      
      // Add parabolic arc (smooth curve)
      const yArc = yLinear + peak * (4 * t * (1 - t));

      const relX = x - ballRect.width / 2;
      const relY = yArc - ballRect.height / 2;

      // Rotate ball for realism (more spins for longer distance)
      const rotation = t * (distance * 1.5);
      
      // Scale ball slightly smaller as it goes away (depth effect)
      const scale = 1 - (t * 0.15);
      
      ballImg.style.transform = `translate(${relX}px, ${relY}px) rotate(${rotation}deg) scale(${scale})`;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // Ball reached goal!
        ballImg.style.zIndex = "10";
        
        // Trigger goal celebration
        targetGoal.classList.add("win");
        
        // Create goal flash effect
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
        targetGoal.appendChild(flash);
        
        setTimeout(() => flash.remove(), 600);

        // Return ball after celebration
        setTimeout(() => {
          ballImg.style.transition = "transform 0.6s ease-out";
          ballImg.style.transform = "translate(0, 0) rotate(0deg) scale(1)";
        }, 1000);
      }
    }

    requestAnimationFrame(step);
  }, 150); // Delay for kick wind-up

  // Remove kick animation after completion
  setTimeout(() => playerImg.classList.remove("kick"), 500);
}

// Add goal flash animation
const flashStyle = document.createElement("style");
flashStyle.textContent = `
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
document.head.appendChild(flashStyle);

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
  ballImg.style.transform = "translate(0, 0) rotate(0deg) scale(1)";
  
  // Hide player for new round
  playerArea.classList.remove("visible");
  playerShown = false;
  timerPill.classList.remove("urgent");
});

socket.on("timer_update", (payload) => {
  if (payload.game_type !== GAME) return;
  const timeRemaining = payload.time_remaining ?? 0;
  
  timerText.textContent = timeRemaining.toString().padStart(2, "0");
  playerCountSpan.textContent = payload.players ?? 0;
  
  // Show player when 15 seconds or less
  if (timeRemaining <= 15 && !playerShown) {
    playerArea.classList.add("visible");
    playerShown = true;
  }
  
  // Add urgent styling when time is low
  if (timeRemaining <= 10) {
    timerPill.classList.add("urgent");
  } else {
    timerPill.classList.remove("urgent");
  }
});

socket.on("betting_closed", (payload) => {
  if (payload.game_type !== GAME) return;
  setStatus("Betting closed for this round", "error");
});

socket.on("bet_placed", (payload) => {
  if (payload.game_type !== GAME) return;
  const rd = payload.round_data || {};
  updateGoalsFromBets(rd.bets || []);
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
  shootBallToWinningNumber(winning);
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
