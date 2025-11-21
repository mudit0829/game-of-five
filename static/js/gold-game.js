// ================= BASIC SETUP (DB USER) =================

const GAME = GAME_TYPE || "gold";

// optional: support multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
// mutable so we can keep it in sync
let tableCodeFromUrl = urlParams.get("table") || null;

// Real logged-in user from Flask session (passed in HTML)
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// Where "Home" button on popup goes
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

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

// popup elements
const popupEl = document.getElementById("resultPopup");
const popupTitleEl = document.getElementById("popupTitle");
const popupMsgEl = document.getElementById("popupMessage");
const popupHomeBtn = document.getElementById("popupHomeBtn");
const popupLobbyBtn = document.getElementById("popupLobbyBtn");

if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

let walletBalance = 0;
let selectedNumber = 0;

let currentTable = null;
let lastResultShown = null;

// flags / intervals
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;

// once true, never false – used for "slots full" logic
let userHasBet = false;

// ================= UI HELPERS =================

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

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function renderTimer() {
  if (!timerText) return;
  timerText.textContent = formatTime(displayRemainingSeconds);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );

  if (myBets.length > 0) {
    userHasBet = true; // lock as betting user
  }

  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }

  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  if (myBets.length === 0) {
    myBetsRow.innerHTML =
      '<span style="color:#6b7280;font-size:11px;">none</span>';
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

/**
 * Use up to 6 bets, one per goal.
 */
function updateGoalsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  goals.forEach((goal, i) => {
    const numSpan = goal.querySelector(".pad-number");
    const userSpan = goal.querySelector(".pad-user");
    goal.classList.remove("win");

    if (i < list.length) {
      const b = list[i];
      goal.dataset.number = String(b.number);
      if (numSpan) numSpan.textContent = b.number;
      if (userSpan) userSpan.textContent = b.username;
    } else {
      goal.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

/**
 * Ensure at least one goal shows winning number so the ball can target it.
 */
function ensureGoalForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;

  const existing = goals.find(
    (g) => g.dataset.number === String(winningNumber)
  );
  if (existing) return;

  const goal = goals[0];
  if (!goal) return;

  const numSpan = goal.querySelector(".pad-number");
  const userSpan = goal.querySelector(".pad-user");

  goal.dataset.number = String(winningNumber);
  if (numSpan) numSpan.textContent = winningNumber;
  if (userSpan) userSpan.textContent = "";
}

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach((chip) => {
    chip.disabled = true;
  });
}

function determineUserOutcome(table) {
  const result = table.result;
  const myBets = (table.bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );
  if (!myBets.length) {
    return { outcome: "none", result };
  }
  const won = myBets.some((b) => String(b.number) === String(result));
  return { outcome: won ? "win" : "lose", result };
}

function showEndPopup(outcomeInfo) {
  if (!popupEl) return;

  const { outcome } = outcomeInfo;

  let title = "Game Finished";
  let message =
    "This game has ended. Please keep playing to keep your winning chances high.";

  if (outcome === "win") {
    title = "Congratulations!";
    message =
      "You have won the game. Please keep playing to keep your winning chances high.";
  } else if (outcome === "lose") {
    title = "Hard Luck!";
    message =
      "You have lost the game. Please keep playing to keep your winning chances high.";
  }

  if (popupTitleEl) popupTitleEl.textContent = title;
  if (popupMsgEl) popupMsgEl.textContent = message;

  popupEl.style.display = "flex";
}

function showSlotsFullPopup() {
  if (!popupEl) return;

  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl)
    popupMsgEl.textContent =
      "This game is already full. You will be redirected to lobby to join another table.";

  popupEl.style.display = "flex";

  setTimeout(() => {
    window.history.back();
  }, 2000);
}

function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  try {
    const url = new URL(window.location.href);
    const currentParam = url.searchParams.get("table");
    if (currentParam === roundCode) return;
    url.searchParams.set("table", roundCode);
    window.history.replaceState({}, "", url.toString());
    tableCodeFromUrl = roundCode;
  } catch (err) {
    console.warn("Unable to sync URL with table code", err);
  }
}

// ================= BALL SHOOTING ANIMATION =================

function ensureTrajectoryStyles() {
  if (document.getElementById("trajectory-styles")) return;
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

function createTrajectoryLine(startX, startY, endX, endY, peak) {
  ensureTrajectoryStyles();
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
  if (pitch) pitch.appendChild(svg);

  setTimeout(() => svg.parentNode && svg.parentNode.removeChild(svg), 1200);
}

function shootBallToWinningNumber(winningNumber) {
  if (!pitch || !ballImg) return;

  const targetGoal = goals.find(
    (g) => g.dataset.number === String(winningNumber)
  );
  if (!targetGoal) {
    console.log("Winning number not on a goal:", winningNumber);
    return;
  }

  const pitchRect = pitch.getBoundingClientRect();
  const ballRect = ballImg.getBoundingClientRect();
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

  if (cssPlayer) cssPlayer.classList.add("kick");

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

// ================= TIMER (LOCAL 1-SECOND COUNTDOWN) =================

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (gameFinished) return;
    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds -= 1;
      renderTimer();
    }
  }, 1000);
}

// ================= BACKEND POLLING (TABLE DATA) =================

async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/gold");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let table = null;

    if (tableCodeFromUrl) {
      // strict: only use the table that matches what lobby gave us
      table =
        data.tables.find((t) => t.round_code === tableCodeFromUrl) || null;

      if (!table) {
        // that game finished and disappeared – don't silently switch to another
        gameFinished = true;
        disableBettingUI();
        if (tablePollInterval) {
          clearInterval(tablePollInterval);
          tablePollInterval = null;
        }
        if (localTimerInterval) {
          clearInterval(localTimerInterval);
          localTimerInterval = null;
        }

        setStatus(
          "This game has finished. You'll be taken back to lobby to join a new one.",
          "error"
        );
        setTimeout(() => {
          window.history.back();
        }, 2000);
        return;
      }
    } else {
      // no ?table= in URL – pick first table and lock URL to it
      table = data.tables[0];
      syncUrlWithTable(table.round_code);
    }

    currentTable = table;
    updateGameUI(table);
  } catch (err) {
    console.error("fetchTableData error", err);
  }
}

function updateGameUI(table) {
  if (!table) return;

  if (roundIdSpan) roundIdSpan.textContent = table.round_code || "-";
  if (playerCountSpan) playerCountSpan.textContent = table.players || 0;

  displayRemainingSeconds = table.time_remaining || 0;
  renderTimer();

  updateGoalsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled = !!table.is_betting_closed;
  }

  // Highlight urgent timer when low
  if (displayRemainingSeconds <= 10) {
    timerPill && timerPill.classList.add("urgent");
  } else {
    timerPill && timerPill.classList.remove("urgent");
  }

  // Show player animation in last 15s (optional)
  if (playerArea) {
    if (displayRemainingSeconds <= 15) {
      playerArea.classList.add("visible");
    } else {
      playerArea.classList.remove("visible");
    }
  }

  // ==== SLOTS FULL CHECK (only if userHasBet is still false) ====
  const maxPlayers =
    typeof table.max_players === "number" ? table.max_players : null;
  const isFull =
    table.is_full === true ||
    (maxPlayers !== null && table.players >= maxPlayers);

  if (!gameFinished && !userHasBet && isFull) {
    gameFinished = true;
    disableBettingUI();
    if (tablePollInterval) {
      clearInterval(tablePollInterval);
      tablePollInterval = null;
    }
    if (localTimerInterval) {
      clearInterval(localTimerInterval);
      localTimerInterval = null;
    }
    showSlotsFullPopup();
    return;
  }

  // ===== Result handling =====
  const hasResult =
    table.result !== null && table.result !== undefined && table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    lastResultShown = table.result;
    setStatus(`Winning number: ${table.result}`, "ok");

    ensureGoalForWinningNumber(table.result);
    shootBallToWinningNumber(table.result);

    if (!gameFinished) {
      gameFinished = true;
      disableBettingUI();

      if (tablePollInterval) {
        clearInterval(tablePollInterval);
        tablePollInterval = null;
      }
      if (localTimerInterval) {
        clearInterval(localTimerInterval);
        localTimerInterval = null;
      }

      const outcomeInfo = determineUserOutcome(table);
      setTimeout(() => {
        showEndPopup(outcomeInfo);
      }, 1000);
    }
  } else if (!hasResult) {
    lastResultShown = null;
  }
}

function startPolling() {
  fetchTableData();
  if (tablePollInterval) clearInterval(tablePollInterval);
  tablePollInterval = setInterval(() => {
    if (!gameFinished) {
      fetchTableData();
    }
  }, 2000);
}

// ================= BALANCE / SOCKET =================

const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const data = await res.json();
    if (typeof data.balance === "number") {
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
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

socket.on("bet_success", (payload) => {
  if (gameFinished) return;

  userHasBet = true; // as soon as our bet is accepted

  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }
  fetchTableData();
});

socket.on("bet_error", (payload) => {
  if (gameFinished) return;
  setStatus(payload.message || "Bet error", "error");
});

// ================= UI EVENTS =================

numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (gameFinished) return;
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    if (gameFinished) {
      setStatus("This game has already finished.", "error");
      return;
    }

    if (walletBalance < FIXED_BET_AMOUNT) {
      setStatus("Insufficient balance", "error");
      return;
    }
    if (selectedNumber === null || selectedNumber === undefined) {
      setStatus("Select a number first", "error");
      return;
    }

    // ===== FRONTEND: prevent duplicate number in this table =====
    if (
      currentTable &&
      Array.isArray(currentTable.bets) &&
      currentTable.bets.some(
        (b) => String(b.number) === String(selectedNumber)
      )
    ) {
      setStatus(
        "This number is already taken in this game. Please choose another.",
        "error"
      );
      return;
    }

    socket.emit("place_bet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });
  });
}

// popup buttons
if (popupHomeBtn) {
  popupHomeBtn.addEventListener("click", () => {
    window.location.href = HOME_URL;
  });
}

if (popupLobbyBtn) {
  popupLobbyBtn.addEventListener("click", () => {
    window.history.back();
  });
}

// ================= INIT =================

fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
