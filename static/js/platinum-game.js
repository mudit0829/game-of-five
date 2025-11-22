// ================== BASIC SETUP ==================

const GAME = GAME_TYPE || "platinum";

// --- multi-table: read table code from URL, keep it in a mutable variable ---
const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

// real logged-in user from Flask session
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// ================== DOM REFERENCES ==================

const roundCodeSpan = document.getElementById("roundCode");
const playerCountSpan = document.getElementById("playerCount");
const userNameLabel = document.getElementById("userName");
const userBetsLabel = document.getElementById("userBets");
const timerText = document.getElementById("timerText");
const timerPill = document.querySelector(".timer-pill");
const walletBalanceSpan = document.getElementById("walletBalance");
const coinsWrapper = document.querySelector(".coins");

const boats = Array.from(document.querySelectorAll(".boat"));
const myBetsContainer = document.getElementById("myBetsContainer");
const placeBetBtn = document.getElementById("placeBetBtn");
const statusEl = document.getElementById("statusMessage");

// Paratrooper image element
const paratrooper = document.getElementById("paratrooperSprite");

// Make sure paratrooper starts hidden & off-screen
if (paratrooper) {
  paratrooper.style.opacity = "0";
  paratrooper.style.top = "-260px";
  paratrooper.style.left = "50%";
  paratrooper.style.transform = "translate(-50%, -50%)";
  paratrooper.style.transition = "none";
}

if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

// ================== STATE ==================

let walletBalance = 0;
let selectedNumber = 0;

let currentTable = null;
let gameFinished = false;
let tablePollInterval = null;

let resultAnimationShownForRound = null;
let resultModalShownForRound = null;
let kickedForNoBet = false;

// ================== UI HELPERS ==================

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
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  document.querySelectorAll(".num-chip").forEach((chip) => {
    chip.disabled = true;
  });
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );

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

  myBets.forEach((b) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsContainer.appendChild(chip);
  });
}

function updateBoatsFromBets(bets) {
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) betsByNumber[b.number] = [];
    betsByNumber[b.number].push(b);
  });

  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);

  boats.forEach((boat, i) => {
    const numSpan = boat.querySelector(".boat-number");
    const userSpan = boat.querySelector(".boat-user");
    boat.classList.remove("win");

    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      boat.dataset.number = number;
      if (numSpan) numSpan.textContent = number;
      if (userSpan) userSpan.textContent = betsOnNumber[0].username;
    } else {
      boat.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

// ============== URL SYNC WITH TABLE CODE ==============

function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  const url = new URL(window.location.href);
  url.searchParams.set("table", roundCode);
  window.history.replaceState({}, "", url.toString());
  tableCodeFromUrl = roundCode;
}

// ============== POPUP MODALS ==============

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(15,23,42,0.85)";
  overlay.style.backdropFilter = "blur(6px)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";
  return overlay;
}

function showResultModal({ title, message, onHome, onLobby }) {
  const overlay = createOverlay();

  const card = document.createElement("div");
  card.style.width = "90%";
  card.style.maxWidth = "360px";
  card.style.background =
    "radial-gradient(circle at top, #020617, #020617 60%, #000 100%)";
  card.style.borderRadius = "20px";
  card.style.padding = "18px 16px 14px";
  card.style.boxShadow = "0 20px 50px rgba(0,0,0,0.9)";
  card.style.border = "1px solid rgba(148,163,184,0.4)";
  card.style.color = "#e5e7eb";
  card.style.textAlign = "center";

  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  titleEl.style.fontSize = "18px";
  titleEl.style.fontWeight = "800";
  titleEl.style.marginBottom = "6px";

  const msgEl = document.createElement("div");
  msgEl.textContent = message;
  msgEl.style.fontSize = "13px";
  msgEl.style.color = "#cbd5e1";
  msgEl.style.marginBottom = "14px";

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "10px";
  btnRow.style.justifyContent = "center";

  const homeBtn = document.createElement("button");
  homeBtn.textContent = "Home Page";
  homeBtn.style.flex = "1";
  homeBtn.style.padding = "10px 0";
  homeBtn.style.borderRadius = "999px";
  homeBtn.style.border = "none";
  homeBtn.style.fontWeight = "700";
  homeBtn.style.fontSize = "14px";
  homeBtn.style.cursor = "pointer";
  homeBtn.style.background =
    "linear-gradient(135deg, #22c55e, #16a34a, #15803d)";
  homeBtn.style.color = "#020617";
  homeBtn.onclick = () => {
    document.body.removeChild(overlay);
    if (typeof onHome === "function") onHome();
  };

  const lobbyBtn = document.createElement("button");
  lobbyBtn.textContent = "Platinum Lobby";
  lobbyBtn.style.flex = "1";
  lobbyBtn.style.padding = "10px 0";
  lobbyBtn.style.borderRadius = "999px";
  lobbyBtn.style.border = "1px solid rgba(148,163,184,0.6)";
  lobbyBtn.style.fontWeight = "700";
  lobbyBtn.style.fontSize = "14px";
  lobbyBtn.style.cursor = "pointer";
  lobbyBtn.style.background = "rgba(15,23,42,0.9)";
  lobbyBtn.style.color = "#e5e7eb";
  lobbyBtn.onclick = () => {
    document.body.removeChild(overlay);
    if (typeof onLobby === "function") onLobby();
  };

  btnRow.appendChild(homeBtn);
  btnRow.appendChild(lobbyBtn);

  card.appendChild(titleEl);
  card.appendChild(msgEl);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function showFullSlotAndGoBack(messageText) {
  if (kickedForNoBet) return;
  kickedForNoBet = true;

  const overlay = createOverlay();

  const card = document.createElement("div");
  card.style.width = "90%";
  card.style.maxWidth = "340px";
  card.style.background =
    "radial-gradient(circle at top, #020617, #020617 60%, #000 100%)";
  card.style.borderRadius = "20px";
  card.style.padding = "18px 16px 14px";
  card.style.boxShadow = "0 20px 50px rgba(0,0,0,0.9)";
  card.style.border = "1px solid rgba(248,113,113,0.5)";
  card.style.color = "#e5e7eb";
  card.style.textAlign = "center";

  const titleEl = document.createElement("div");
  titleEl.textContent = "All slots are full";
  titleEl.style.fontSize = "17px";
  titleEl.style.fontWeight = "800";
  titleEl.style.color = "#fca5a5";
  titleEl.style.marginBottom = "6px";

  const msgEl = document.createElement("div");
  msgEl.textContent =
    messageText ||
    "This game is full and you have no active bet. We'll take you back to lobby for an available table.";
  msgEl.style.fontSize = "13px";
  msgEl.style.color = "#e5e7eb";
  msgEl.style.marginBottom = "14px";

  const btn = document.createElement("button");
  btn.textContent = "Back to Platinum Lobby";
  btn.style.display = "block";
  btn.style.width = "100%";
  btn.style.padding = "10px 0";
  btn.style.borderRadius = "999px";
  btn.style.border = "none";
  btn.style.fontWeight = "700";
  btn.style.fontSize = "14px";
  btn.style.cursor = "pointer";
  btn.style.background =
    "linear-gradient(135deg, #f97316, #ea580c, #b91c1c)";
  btn.style.color = "#020617";
  btn.onclick = () => {
    document.body.removeChild(overlay);
    window.location.href = "/game/platinum";
  };

  card.appendChild(titleEl);
  card.appendChild(msgEl);
  card.appendChild(btn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============== PARATROOPER ANIMATION (IMAGE) ==============

function dropParatrooperToWinningNumber(winningNumber) {
  if (!paratrooper) return;

  const targetBoat = boats.find(
    (b) => b.dataset.number === String(winningNumber)
  );
  if (!targetBoat) {
    console.log("Winning number not on any boat:", winningNumber);
    return;
  }

  const boatRect = targetBoat.getBoundingClientRect();

  // Where the paratrooper should land
  const targetX = boatRect.left + boatRect.width / 2;
  const targetY = boatRect.top + boatRect.height * 0.25;

  // Starting pos (off-screen top, centered)
  const startY = -220;
  const startX = window.innerWidth / 2;

  const endY = targetY - 80; // slightly above boat
  const endX = targetX;

  const duration = 1300;
  const startTime = performance.now();

  // Reset transition for fresh animation
  paratrooper.style.transition = "none";
  paratrooper.style.opacity = "1";
  paratrooper.style.top = `${startY}px`;
  paratrooper.style.left = `${startX}px`;

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    // smooth easing
    const ease = 1 - Math.pow(1 - t, 3);

    const currentX = startX + (endX - startX) * ease;
    const currentY = startY + (endY - startY) * ease;

    paratrooper.style.top = `${currentY}px`;
    paratrooper.style.left = `${currentX}px`;
    paratrooper.style.transform = "translate(-50%, -50%)";

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      targetBoat.classList.add("win");
      // send him back up after a while
      setTimeout(() => {
        paratrooper.style.transition = "top 0.6s ease-out, opacity 0.4s";
        paratrooper.style.top = "-260px";
        paratrooper.style.opacity = "0";

        // after hide, remove transition so next drop starts clean
        setTimeout(() => {
          paratrooper.style.transition = "none";
        }, 600);
      }, 800);
    }
  }

  requestAnimationFrame(step);
}

// ================== BACKEND SYNC (TABLES) ==================

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

    if (tableCodeFromUrl) {
      // Strict: use ONLY the table that matches the code from URL
      table =
        data.tables.find((t) => t.round_code === tableCodeFromUrl) || null;

      if (!table) {
        // The game you came for no longer exists (finished + cleaned)
        gameFinished = true;
        disableBettingUI();
        setStatus(
          "This game has finished. You'll be taken back to lobby for a new one.",
          "error"
        );

        if (tablePollInterval) {
          clearInterval(tablePollInterval);
          tablePollInterval = null;
        }

        setTimeout(() => {
          window.location.href = "/game/platinum";
        }, 2000);

        return;
      }
    } else {
      // No table in URL – pick first table and lock the URL to it
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

  if (roundCodeSpan) roundCodeSpan.textContent = table.round_code || "--";
  if (playerCountSpan) playerCountSpan.textContent = table.players || 0;

  const tr = table.time_remaining || 0;
  const mins = Math.floor(tr / 60);
  const secs = tr % 60;
  if (timerText) {
    timerText.textContent = `${mins}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  if (timerPill) {
    if (tr <= 10 && !table.is_finished && !table.is_betting_closed) {
      timerPill.classList.add("urgent");
    } else {
      timerPill.classList.remove("urgent");
    }
  }

  updateBoatsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  const myBets = (table.bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );
  const hasUserBet = myBets.length > 0;

  const slotsFull =
    (typeof table.slots_available === "number" &&
      table.slots_available <= 0) ||
    (typeof table.max_players === "number" &&
      table.players >= table.max_players) ||
    table.is_full === true;

  // if slots are full / betting closed / finished AND user has no bet, auto back
  if (
    !hasUserBet &&
    (slotsFull || table.is_betting_closed || table.is_finished) &&
    !kickedForNoBet
  ) {
    gameFinished = true;
    disableBettingUI();
    if (tablePollInterval) {
      clearInterval(tablePollInterval);
      tablePollInterval = null;
    }
    showFullSlotAndGoBack();
    return;
  }

  // Disable betting when betting closed / finished / slots full
  if (table.is_betting_closed || table.is_finished || slotsFull) {
    disableBettingUI();
  } else {
    // enable if still open and not full
    placeBetBtn.disabled = false;
    document.querySelectorAll(".num-chip").forEach((chip) => {
      chip.disabled = false;
    });
  }

  // Handle finished game -> animation + result popup
  if (
    table.is_finished &&
    table.result !== null &&
    table.result !== undefined
  ) {
    const roundId = table.round_code;

    // animate paratrooper only once per round
    if (resultAnimationShownForRound !== roundId) {
      resultAnimationShownForRound = roundId;
      dropParatrooperToWinningNumber(table.result);
      setStatus(`Winning number: ${table.result}`, "ok");
    }

    // show congratulations/hard luck popup only once per round
    if (resultModalShownForRound !== roundId && hasUserBet) {
      resultModalShownForRound = roundId;
      gameFinished = true;
      if (tablePollInterval) {
        clearInterval(tablePollInterval);
        tablePollInterval = null;
      }

      const userWon = myBets.some((b) => b.number === table.result);
      const title = userWon ? "Congratulations!" : "Hard Luck!";
      const msg = userWon
        ? "You have WON this game. Keep playing to keep your winning chances high."
        : "You LOST this game. Keep playing to keep your winning chances high.";

      showResultModal({
        title,
        message: msg,
        onHome: () => {
          window.location.href = "/home";
        },
        onLobby: () => {
          window.location.href = "/game/platinum";
        },
      });
    }
  }
}

// ================== SOCKET.IO + BALANCE ==================

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
  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }
  fetchTableData();
});

socket.on("bet_error", (payload) => {
  setStatus(payload.message || "Bet error", "error");
});

// ================== UI EVENTS ==================

document.querySelectorAll(".num-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    if (!currentTable) {
      setStatus("Game not ready yet", "error");
      return;
    }

    const slotsFull =
      (typeof currentTable.slots_available === "number" &&
        currentTable.slots_available <= 0) ||
      (typeof currentTable.max_players === "number" &&
        currentTable.players >= currentTable.max_players) ||
      currentTable.is_full === true;

    // HARD STOP: once all 6 slots are full, no more bets from anyone
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

    // per-user duplicate prevention (safe, uses only this user's bets)
    const myBets =
      (currentTable.bets || []).filter(
        (b) => String(b.user_id) === String(USER_ID)
      ) || [];
    const alreadyOnThisNumber = myBets.some(
      (b) => Number(b.number) === Number(selectedNumber)
    );
    if (alreadyOnThisNumber) {
      setStatus("You already placed a bet on this number", "error");
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

// ================== INIT ==================

fetchBalance();
fetchTableData();
setSelectedNumber(0);
setStatus("");

if (!tablePollInterval) {
  // poll every 1 second so timer moves by 1 second steps
  tablePollInterval = setInterval(fetchTableData, 1000);
}
