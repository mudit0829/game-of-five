// ================= BASIC SETUP (DB USER) =================

const GAME = GAME_TYPE || "platinum";

// optional: multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;

// Real logged-in user from Flask session
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// where "Home" button goes
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

const boats = Array.from(document.querySelectorAll(".boat"));
const cssParatrooper = document.getElementById("cssParatrooper");

const numChips = Array.from(document.querySelectorAll(".num-chip"));
const placeBetBtn = document.getElementById("placeBetBtn");

const roundCodeSpan = document.getElementById("roundCode");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const timerPill = document.querySelector(".timer-pill");
const walletBalanceSpan = document.getElementById("walletBalance");
const statusEl = document.getElementById("statusMessage");
const coinsWrapper = document.querySelector(".coins");
const userNameLabel = document.getElementById("userName");
const userBetsLabel = document.getElementById("userBets");
const myBetsContainer = document.getElementById("myBetsContainer");

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

// once the user has bet in this round
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

  if (userBetsLabel) {
    userBetsLabel.textContent = myBets.length;
  }

  if (!myBetsContainer) return;
  myBetsContainer.innerHTML = "";

  if (myBets.length === 0) {
    const span = document.createElement("span");
    span.style.color = "#6b7280";
    span.style.fontSize = "11px";
    span.textContent = "none";
    myBetsContainer.appendChild(span);
    return;
  }

  myBets.forEach((b, index) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsContainer.appendChild(chip);
    if (index < myBets.length - 1) {
      myBetsContainer.appendChild(document.createTextNode(", "));
    }
  });
}

/**
 * Use up to 6 unique numbers, one per boat.
 */
function updateBoatsFromBets(bets) {
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) betsByNumber[b.number] = [];
    betsByNumber[b.number].push(b);
  });

  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);

  boats.forEach((boatEl, i) => {
    const numSpan = boatEl.querySelector(".boat-number");
    const userSpan = boatEl.querySelector(".boat-user");
    boatEl.classList.remove("win");

    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      boatEl.dataset.number = String(number);
      if (numSpan) numSpan.textContent = number;
      if (userSpan) userSpan.textContent = betsOnNumber[0].username;
    } else {
      boatEl.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

/**
 * Ensure at least one boat shows the winning number
 */
function ensureBoatForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;
  const existing = boats.find(
    (b) => b.dataset.number === String(winningNumber)
  );
  if (existing) return;

  const firstBoat = boats[0];
  if (!firstBoat) return;

  const numSpan = firstBoat.querySelector(".boat-number");
  const userSpan = firstBoat.querySelector(".boat-user");

  firstBoat.dataset.number = String(winningNumber);
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

// ================= PARATROOPER ANIMATION =================

function dropParatrooperToWinningNumber(winningNumber) {
  if (!cssParatrooper) return;

  const targetBoat = boats.find(
    (b) => b.dataset.number === String(winningNumber)
  );
  if (!targetBoat) {
    console.log("Winning number not on any boat:", winningNumber);
    return;
  }

  const boatRect = targetBoat.getBoundingClientRect();
  const startTop = -300;
  const endTop = boatRect.top - 120; // a bit above boat
  const startLeft = window.innerWidth / 2;
  const endLeft = boatRect.left + boatRect.width / 2;

  cssParatrooper.style.top = `${startTop}px`;
  cssParatrooper.style.left = `${startLeft}px`;
  cssParatrooper.classList.add("falling");

  const duration = 1200;
  const startTime = performance.now();

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);
    const ease = 1 - Math.pow(1 - t, 3);

    const currentTop = startTop + (endTop - startTop) * ease;
    const currentLeft = startLeft + (endLeft - startLeft) * ease;

    cssParatrooper.style.top = `${currentTop}px`;
    cssParatrooper.style.left = `${currentLeft}px`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      cssParatrooper.classList.remove("falling");
      targetBoat.classList.add("win");
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
    const res = await fetch("/api/tables/platinum");
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

  if (roundCodeSpan) roundCodeSpan.textContent = table.round_code || "--";
  if (playerCountSpan) playerCountSpan.textContent = table.players || 0;

  displayRemainingSeconds = table.time_remaining || 0;
  renderTimer();

  updateBoatsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled = !!table.is_betting_closed;
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

    ensureBoatForWinningNumber(table.result);
    dropParatrooperToWinningNumber(table.result);

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
