// ================= BASIC SETUP (DB USER) =================

const GAME = GAME_TYPE || "diamond";

// optional: support multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;

// Real logged-in user from Flask session
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// Where the "Home" button on popup goes
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

const rangeEl = document.querySelector(".range");
const arrowImg = document.getElementById("arrowSprite");
const archerImg = document.getElementById("archerSprite");
const targets = Array.from(document.querySelectorAll(".target.pad"));

const numChips = Array.from(document.querySelectorAll(".num-chip"));
const betInput = document.getElementById("betAmount"); // visual only
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

// once the user has bet in this round, stays true
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
    userHasBet = true;
  }

  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }

  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  if (myBets.length === 0) {
    const span = document.createElement("span");
    span.style.color = "#6b7280";
    span.style.fontSize = "11px";
    span.textContent = "none";
    myBetsRow.appendChild(span);
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
 * Use up to 6 bets, one per target.
 */
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
}

/**
 * Ensure at least one target shows the winning number so arrow has somewhere to land.
 */
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
  } catch (err) {
    console.warn("Unable to sync URL with table code", err);
  }
}

// ================= ARROW ANIMATION =================

function shootArrowToWinningNumber(winningNumber) {
  if (!rangeEl || !arrowImg || !archerImg) return;

  const target = targets.find(
    (t) => t.dataset.number === String(winningNumber)
  );
  if (!target) {
    console.log("Winning number not on any target:", winningNumber);
    return;
  }

  const rangeRect = rangeEl.getBoundingClientRect();
  const arrowRect = arrowImg.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // start: arrow near bow
  const startX = arrowRect.left + arrowRect.width * 0.2 - rangeRect.left;
  const startY = arrowRect.top + arrowRect.height * 0.5 - rangeRect.top;

  // end: centre of target
  const endX = targetRect.left + targetRect.width * 0.5 - rangeRect.left;
  const endY = targetRect.top + targetRect.height * 0.5 - rangeRect.top;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const duration = 650;
  const peak = -80;
  const startTime = performance.now();

  // trigger archer shoot animation
  archerImg.classList.add("shoot");
  setTimeout(() => archerImg.classList.remove("shoot"), 350);

  arrowImg.style.transition = "none";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t));

    const relX = x - arrowRect.width * 0.2;
    const relY = yArc - arrowRect.height * 0.5;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    arrowImg.style.transform = `translate(${relX}px, ${relY}px) rotate(${angle}deg)`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      target.classList.add("win");
      setTimeout(() => {
        arrowImg.style.transition = "transform 0.5s ease-out";
        arrowImg.style.transform = "translate(0, 0) rotate(0deg)";
      }, 700);
    }
  }

  requestAnimationFrame(step);
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
    const res = await fetch("/api/tables/diamond");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let table = null;

    if (TABLE_CODE) {
      table = data.tables.find((t) => t.round_code === TABLE_CODE) || null;
    }
    if (!table) {
      table = data.tables[0];
    }

    syncUrlWithTable(table.round_code);

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

  updateTargetsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  // disable button also when slots are full
  if (placeBetBtn && !gameFinished) {
    const maxPlayers =
      typeof table.max_players === "number" ? table.max_players : null;
    const slotsFull =
      !!table.is_full ||
      (maxPlayers !== null && table.players >= maxPlayers);

    placeBetBtn.disabled =
      !!table.is_betting_closed || !!table.is_finished || slotsFull;
  }

  // urgent timer style
  if (displayRemainingSeconds <= 10) {
    timerPill && timerPill.classList.add("urgent");
  } else {
    timerPill && timerPill.classList.remove("urgent");
  }

  // ==== SLOTS FULL CHECK (for spectators with no bet) ====
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

  userHasBet = true;

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

    if (!currentTable) {
      setStatus("Game is not ready yet. Please wait...", "error");
      return;
    }

    // HARD STOP: no bet once all slots are full (for everyone)
    const maxPlayers =
      typeof currentTable.max_players === "number"
        ? currentTable.max_players
        : null;
    const slotsFull =
      currentTable.is_full === true ||
      (maxPlayers !== null && currentTable.players >= maxPlayers);

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

    // IMPORTANT:
    // We do NOT try to detect "number already taken" on the frontend
    // because that was causing false errors when list was out of sync.
    // Backend will enforce uniqueness and send bet_error if needed.

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
