// ================= BASIC SETUP =================
// ✅ CRITICAL: Use window.* variables

const GAME = window.GAME_TYPE || "diamond";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 100;

const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

const USER_ID = window.GAME_USER_ID;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

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
const timerPill = document.querySelector(".timer-pill");
const walletBalanceSpan = document.getElementById("walletBalance");
const statusEl = document.getElementById("statusMessage");
const coinsWrapper = document.querySelector(".coins");
const userNameLabel = document.getElementById("userName");
const userBetCountLabel = document.getElementById("userBetCount");
const myBetsRow = document.getElementById("myBetsRow");

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
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;
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

// ✅ FIXED: Update my bets display
function updateMyBets(bets) {
  const myBets = (bets || []).filter(b => {
    const betUserId = String(b.user_id || b.userId || "");
    return betUserId === String(USER_ID);
  });

  if (myBets.length > 0) {
    userHasBet = true;
  }

  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }

  if (!myBetsRow) return;
  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
  } else {
    const numbers = myBets.map(b => b.number).sort((a, b) => a - b);
    myBetsRow.innerHTML = numbers.map(n => `<span class="my-bet-chip">${n}</span>`).join(", ");
  }

  console.log("[updateMyBets] Count:", myBets.length, "Numbers:", myBets.map(b => b.number).join(","));
}

// ✅ FIXED: Update targets from bets
function updateTargetsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  targets.forEach((target, i) => {
    const numSpan = target.querySelector(".pad-number");
    const userSpan = target.querySelector(".pad-user");
    target.classList.remove("win");

    if (i < list.length) {
      const b = list[i];
      target.dataset.number = String(b.number);
      if (numSpan) numSpan.textContent = b.number;
      if (userSpan) userSpan.textContent = b.username;
    } else {
      target.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });

  console.log("[updateTargetsFromBets] Updated", list.length, "targets from bets");
}

function ensureTargetForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;

  const existing = targets.find(
    (t) => t.dataset.number === String(winningNumber)
  );
  if (existing) return;

  const target = targets[0];
  if (!target) return;

  const numSpan = target.querySelector(".pad-number");
  const userSpan = target.querySelector(".pad-user");

  target.dataset.number = String(winningNumber);
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
  let message = "This game has ended. Please keep playing to keep your winning chances high.";

  if (outcome === "win") {
    title = "Congratulations! 🎉";
    message = "You have won the game. Please keep playing to keep your winning chances high.";
  } else if (outcome === "lose") {
    title = "Hard Luck! 😢";
    message = "You have lost the game. Please keep playing to keep your winning chances high.";
  }

  if (popupTitleEl) popupTitleEl.textContent = title;
  if (popupMsgEl) popupMsgEl.textContent = message;

  popupEl.style.display = "flex";
}

function showSlotsFullPopup() {
  if (!popupEl) return;

  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl) popupMsgEl.textContent = "This game is already full. You will be redirected to lobby to join another table.";

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

// ================= ARROW ANIMATION (ENHANCED) =================

function ensureArrowStyles() {
  if (document.getElementById("arrow-anim-styles")) return;
  const style = document.createElement("style");
  style.id = "arrow-anim-styles";
  style.textContent = `
    @keyframes archerDraw {
      0% { transform: scaleX(1) rotate(0deg); }
      50% { transform: scaleX(0.85) rotate(-5deg); }
      100% { transform: scaleX(1) rotate(0deg); }
    }
    @keyframes targetFlash {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
      50% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.3); }
    }
  `;
  document.head.appendChild(style);
}

function shootArrowToWinningNumber(winningNumber) {
  if (!rangeEl || !arrowImg || !archerImg) {
    console.warn("[arrow] Missing DOM elements");
    return;
  }

  const target = targets.find(
    (t) => t.dataset.number === String(winningNumber)
  );
  if (!target) {
    console.log("[arrow] Winning number not on any target:", winningNumber);
    return;
  }

  console.log("[arrow] Shooting arrow to target with number:", winningNumber);
  ensureArrowStyles();

  const rangeRect = rangeEl.getBoundingClientRect();
  const arrowRect = arrowImg.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Calculate positions relative to range
  const startX = arrowRect.left + arrowRect.width * 0.2 - rangeRect.left;
  const startY = arrowRect.top + arrowRect.height * 0.5 - rangeRect.top;

  const endX = targetRect.left + targetRect.width * 0.5 - rangeRect.left;
  const endY = targetRect.top + targetRect.height * 0.5 - rangeRect.top;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const duration = 650;
  const peak = -Math.min(150, distance * 0.4);
  const startTime = performance.now();

  // ✅ ARCHER SHOOT ANIMATION
  console.log("[archer] Playing shoot animation");
  archerImg.style.animation = "archerDraw 0.4s ease-in-out";
  setTimeout(() => {
    archerImg.style.animation = "none";
  }, 400);

  // Reset arrow to starting position
  arrowImg.style.transition = "none";
  arrowImg.style.left = "auto";
  arrowImg.style.top = "auto";
  arrowImg.style.position = "relative";

  function step(now) {
    const elapsed = now - startTime;
    const tRaw = elapsed / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    // Easing: ease-out-cubic
    const ease = 1 - Math.pow(1 - t, 3);
    
    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t));

    // Calculate angle for arrow rotation
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    
    // Scale arrow slightly smaller as it travels
    const scale = 1 - t * 0.15;

    arrowImg.style.position = "fixed";
    arrowImg.style.left = x + "px";
    arrowImg.style.top = yArc + "px";
    arrowImg.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;
    arrowImg.style.zIndex = "1000";

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // ✅ TARGET HIT ANIMATION
      console.log("[target] Hit! Playing victory animation");
      target.classList.add("win");

      // Flash effect at impact
      const flash = document.createElement("div");
      flash.style.position = "absolute";
      flash.style.top = "50%";
      flash.style.left = "50%";
      flash.style.width = "180%";
      flash.style.height = "180%";
      flash.style.background = "radial-gradient(circle, rgba(59,130,246,0.8) 0%, rgba(59,130,246,0.3) 50%, transparent 100%)";
      flash.style.borderRadius = "50%";
      flash.style.pointerEvents = "none";
      flash.style.animation = "targetFlash 0.6s ease-out forwards";
      flash.style.zIndex = "100";
      target.appendChild(flash);

      setTimeout(() => flash.remove(), 600);

      // Arrow stays in target for 700ms, then returns
      setTimeout(() => {
        console.log("[arrow] Returning to starting position");
        arrowImg.style.transition = "all 0.5s ease-out";
        arrowImg.style.position = "relative";
        arrowImg.style.left = "auto";
        arrowImg.style.top = "auto";
        arrowImg.style.transform = "translate(0, 0) rotate(0deg) scale(1)";
        arrowImg.style.zIndex = "10";
      }, 700);
    }
  }

  requestAnimationFrame(step);
}

// ================= TIMER =================

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

// ================= POLLING =================

async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/diamond");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let table = null;

    if (tableCodeFromUrl) {
      table = data.tables.find((t) => t.round_code === tableCodeFromUrl) || null;

      if (!table) {
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

        setStatus("This game has finished. You'll be taken back to lobby to join a new one.", "error");
        setTimeout(() => {
          window.history.back();
        }, 2000);
        return;
      }
    } else {
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

  displayRemainingSeconds = table.time_remaining || 0;
  renderTimer();

  // ✅ CRITICAL: Update targets from polling (for initial load + other players' bets)
  if (table.bets && Array.isArray(table.bets) && table.bets.length > 0) {
    console.log("[polling] Updating targets from API bets:", table.bets.length);
    updateTargetsFromBets(table.bets);
    updateMyBets(table.bets);
    if (playerCountSpan) {
      playerCountSpan.textContent = table.bets.length;
    }
  }

  if (placeBetBtn && !gameFinished) {
    const maxPlayers = typeof table.max_players === "number" ? table.max_players : null;
    const slotsFull = !!table.is_full || (maxPlayers !== null && table.players >= maxPlayers);

    placeBetBtn.disabled = !!table.is_betting_closed || !!table.is_finished || slotsFull;
  }

  if (displayRemainingSeconds <= 10) {
    timerPill && timerPill.classList.add("urgent");
  } else {
    timerPill && timerPill.classList.remove("urgent");
  }

  const maxPlayers = typeof table.max_players === "number" ? table.max_players : null;
  const isFull = table.is_full === true || (maxPlayers !== null && table.players >= maxPlayers);

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

  const hasResult = table.result !== null && table.result !== undefined && table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    lastResultShown = table.result;
    setStatus(`Winning number: ${table.result}`, "ok");

    ensureTargetForWinningNumber(table.result);
    shootArrowToWinningNumber(table.result);

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

// ================= SOCKET =================

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
  console.log("[socket] CONNECTED");
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

socket.on("disconnect", () => {
  console.log("[socket] DISCONNECTED");
});

socket.on("connect_error", (error) => {
  console.error("[socket] CONNECTION ERROR:", error);
});

// ✅ LISTEN FOR OWN BET SUCCESS
socket.on("bet_success", (payload) => {
  console.log("[bet_success] Received - players:", payload.players?.length || 0);
  if (gameFinished) return;

  userHasBet = true;
  setStatus(payload.message || "Bet placed ✓", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }

  if (payload.players && Array.isArray(payload.players)) {
    console.log("[bet_success] Updating UI with", payload.players.length, "players");
    updateTargetsFromBets(payload.players);
    updateMyBets(payload.players);
    if (playerCountSpan) {
      playerCountSpan.textContent = payload.players.length;
    }
  }
});

// ✅ LISTEN FOR BROADCAST TABLE UPDATES
socket.on("update_table", (payload) => {
  console.log("[update_table] BROADCAST received - players:", payload.players?.length || 0);
  if (gameFinished) return;

  if (payload.players && Array.isArray(payload.players)) {
    console.log("[update_table] Updating UI with", payload.players.length, "players");
    playerCountSpan.textContent = payload.players.length;
    updateTargetsFromBets(payload.players);
    updateMyBets(payload.players);
  }

  if (payload.time_remaining != null) {
    displayRemainingSeconds = payload.time_remaining;
    renderTimer();
  }

  if (payload.is_betting_closed) {
    disableBettingUI();
  }
});

// ✅ LISTEN FOR BET ERRORS
socket.on("bet_error", (payload) => {
  if (gameFinished) return;
  console.error("[bet_error]:", payload.message);
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

    if (!currentTable) {
      setStatus("Game is not ready yet. Please wait...", "error");
      return;
    }

    const maxPlayers = typeof currentTable.max_players === "number" ? currentTable.max_players : null;
    const slotsFull = currentTable.is_full === true || (maxPlayers !== null && currentTable.players >= maxPlayers);

    if (slotsFull) {
      setStatus("All slots are full for this game.", "error");
      disableBettingUI();
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

    socket.emit("place_bet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });
  });
}

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

console.log(`[INIT] Game=${GAME}, User=${USER_ID}, Username=${USERNAME}, Bet=${FIXED_BET_AMOUNT}`);

fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
