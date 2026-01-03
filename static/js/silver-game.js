// ================= BASIC SETUP (DB USER) =================
const GAME = window.GAME_TYPE || "silver";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 10;

// optional: support multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;

// Real logged-in user from Flask session (passed in HTML)
const USER_ID = window.GAME_USER_ID || null;
const USERNAME = window.GAME_USERNAME || "Player";

// Where popup "Home" button goes
const HOME_URL = "/home";

// ================= DOM REFERENCES =================
// IMPORTANT: use the pond container for coordinates
const pondEl = document.querySelector(".pond");
const frogImg = document.getElementById("frogSprite");
const frogVideo = document.getElementById("frogJumpVideo");
const pads = Array.from(document.querySelectorAll(".pad"));

const numChips = Array.from(document.querySelectorAll(".num-chip"));
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

// popup elements (used both for result + "slots full")
const popupEl = document.getElementById("resultPopup");
const popupTitleEl = document.getElementById("popupTitle");
const popupMsgEl = document.getElementById("popupMessage");
const popupHomeBtn = document.getElementById("popupHomeBtn");
const popupLobbyBtn = document.getElementById("popupLobbyBtn");

// ================= FROG JUMP VIDEO CONFIG =================
const FROG_VIDEOS = {
  front: "/static/video/front-jump-frog.mp4",
  left: "/static/video/left-jump-frog.mp4",
  right: "/static/video/right-jump-frog.mp4",
};

const frogVideoSource = document.getElementById("frogVideoSource");

// Display username
if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

let walletBalance = 0;
let selectedNumber = 0;
let currentTable = null;
let lastResultShown = null;

// flags / intervals
let frogPreviewPlayed = false;
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;

// IMPORTANT: persistent flag – once true, never set back to false
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

  // do NOT set userHasBet = false here – only ever turn it true
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
 * One pad = one bet (first 6 bets).
 */
function updatePadsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");

    if (i < list.length) {
      const b = list[i];
      pad.dataset.number = String(b.number);
      if (numSpan) numSpan.textContent = b.number;
      if (userSpan) userSpan.textContent = b.username;
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

/**
 * Ensure at least one pad shows winning number.
 */
function ensurePadForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;

  const existing = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );
  if (existing) return;

  const pad = pads[0];
  if (!pad) return;

  const numSpan = pad.querySelector(".pad-number");
  const userSpan = pad.querySelector(".pad-user");

  pad.dataset.number = String(winningNumber);
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

// ================= FROG ANIMATION =================

// base transition for static frog
if (frogImg) {
  frogImg.style.transition = "transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1)";
  frogImg.style.transformOrigin = "center center";
}

// decide jump direction based on pad index
function getJumpDirectionByPadIndex(index) {
  // pads layout:
  // [0][1][2]
  // [3][4][5]
  if (index === 0 || index === 1) return "left";
  if (index === 2 || index === 3) return "front";
  return "right";
}

// find pad showing winning number
function findPadForNumber(winningNumber) {
  const targetStr = String(winningNumber);
  const pad = pads.find((p) => {
    if (p.dataset.number === targetStr) return true;
    const label = p.querySelector(".pad-number");
    return label && label.textContent.trim() === targetStr;
  });
  if (!pad) {
    console.warn("[frog] No pad found for number:", winningNumber);
  }
  return pad;
}

// ================= TRANSFORM FALLBACK =================

function hopFrogToWinningNumberTransform(winningNumber) {
  if (!frogImg) return;

  const targetPad = findPadForNumber(winningNumber);
  if (!targetPad) return;

  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const frogX = frogRect.left + frogRect.width / 2;
  const frogY = frogRect.top + frogRect.height / 2;

  const padX = padRect.left + padRect.width / 2;
  const padY = padRect.top + padRect.height * 0.3;

  const dx = padX - frogX;
  const dy = padY - frogY;

  frogImg.style.transition =
    "transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1)";
  frogImg.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;

  setTimeout(() => {
    frogImg.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
    targetPad.classList.add("win");
  }, 720);
}

// ================= VIDEO JUMP (MAIN) =================

function hopFrogToWinningNumberVideo(winningNumber) {
  console.log('[frog] Video jump for:', winningNumber);
  
  if (!frogVideo || !frogImg || !pondEl || !frogVideoSource) {
    console.warn('[frog] Missing element');
    hopFrogToWinningNumberTransform(winningNumber);
    return;
  }

  const targetPad = findPadForNumber(winningNumber);
  if (!targetPad) {
    console.warn('[frog] Pad not found');
    hopFrogToWinningNumberTransform(winningNumber);
    return;
  }

  const padIndex = pads.indexOf(targetPad);
  if (padIndex === -1) {
    hopFrogToWinningNumberTransform(winningNumber);
    return;
  }

  const direction = getJumpDirectionByPadIndex(padIndex);
  const videoSrc = FROG_VIDEOS[direction] || FROG_VIDEOS.front;

  frogVideo.pause();
  frogVideo.currentTime = 0;

  frogVideoSource.src = videoSrc;
  frogVideo.load();

  const pondRect = pondEl.getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const startX = frogRect.left - pondRect.left;
  const startY = frogRect.top - pondRect.top;

  // ===== HIDE IMAGE =====
  frogImg.style.visibility = "hidden";
  frogImg.style.display = "none";
  
  // ===== SHOW VIDEO =====
  frogVideo.style.position = "absolute";
  frogVideo.style.left = `${startX}px`;
  frogVideo.style.top = `${startY}px`;
  frogVideo.style.display = "block";
  frogVideo.style.visibility = "visible";
  frogVideo.style.zIndex = "9999";
  frogVideo.currentTime = 0;

  frogVideo.onloadeddata = () => {
    console.log('[frog] Playing video');
    frogVideo.play().catch((err) => {
      console.error('[frog] Play error:', err);
      hopFrogToWinningNumberTransform(winningNumber);
    });
  };

  frogVideo.onended = () => {
    console.log('[frog] Video complete');
    
    // ===== HIDE VIDEO, SHOW IMAGE =====
    frogVideo.style.display = "none";
    frogVideo.style.visibility = "hidden";
    
    const endX = padRect.left - pondRect.left;
    const endY = padRect.top - pondRect.top;

    frogImg.style.visibility = "visible";
    frogImg.style.display = "block";
    frogImg.style.transition = "transform 0.2s ease-out";
    frogImg.style.transform = `translate(${endX - startX}px, ${endY - startY}px)`;
    
    targetPad.classList.add("win");
  };

  frogVideo.onerror = (err) => {
    console.error('[frog] Video error:', err);
    hopFrogToWinningNumberTransform(winningNumber);
  };
}

// ================= TIMER (LOCAL 1-SECOND COUNTDOWN) =================

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);

  localTimerInterval = setInterval(() => {
    if (gameFinished) return;

    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds -= 1;
      renderTimer();

      // ▶️ PLAY PREVIEW EXACTLY ONCE AT 10 SECONDS
      if (displayRemainingSeconds === 10 && !frogPreviewPlayed) {
        frogPreviewPlayed = true;
        console.log("[frog] 10 seconds reached – start jump preview");

        if (frogVideo && frogVideoSource) {
          frogVideo.pause();
          frogVideoSource.src = FROG_VIDEOS.front;
          frogVideo.load();

          frogVideo.onloadeddata = () => {
            frogImg.style.visibility = "hidden";
            frogVideo.style.display = "block";
            frogVideo.style.visibility = "visible";
            frogVideo.currentTime = 0;
            frogVideo.muted = true;
            frogVideo.play().catch(() => {});
          };
        }
      }

      // 🐸 STATIC FROG BEFORE PREVIEW
      if (displayRemainingSeconds > 10) {
        showFrogStatic();
      }
    }
  }, 1000);
}

// ================= BACKEND POLLING (TABLE DATA) =================

async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/silver");
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

  // ================= BASIC UI =================
  if (roundIdSpan) roundIdSpan.textContent = table.round_code || "-";
  if (playerCountSpan) playerCountSpan.textContent = table.players || 0;

  displayRemainingSeconds = table.time_remaining || 0;
  renderTimer();

  updatePadsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled =
      !!table.is_betting_closed ||
      (typeof table.max_players === "number" &&
        table.players >= table.max_players);
  }

  // ================= SLOTS FULL CHECK =================
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

  // ================= RESULT HANDLING =================
  const hasResult =
    table.result !== null &&
    table.result !== undefined &&
    table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    lastResultShown = table.result;

    setStatus(`Winning number: ${table.result}`, "ok");
    ensurePadForWinningNumber(table.result);

    // IMPORTANT: do NOT hide frog here
    hopFrogToWinningNumber(table.result);

    // end game AFTER animation
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
      }, 1200); // synced with jump animation
    }
  } else if (!hasResult) {
    // ================= NEW ROUND RESET =================
    lastResultShown = null;
    frogPreviewPlayed = false;
    gameFinished = false;
    userHasBet = false;

    if (localTimerInterval) {
      clearInterval(localTimerInterval);
      localTimerInterval = null;
    }

    startLocalTimer();

    pads.forEach((p) => p.classList.remove("win"));

    if (frogImg) {
      frogImg.style.transition = "transform 0.3s ease-out";
      frogImg.style.transform = "translate(0px, 0px) scale(1)";
      frogImg.style.visibility = "visible";
    }

    if (frogVideo) {
      frogVideo.pause();
      frogVideo.currentTime = 0;
      frogVideo.style.display = "none";
    }
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

  // As soon as backend confirms bet, lock this as a betting user
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

    // hard stop: no bet if all 6 slots are full
    const maxPlayers =
      typeof currentTable.max_players === "number"
        ? currentTable.max_players
        : null;

    if (maxPlayers !== null && currentTable.players >= maxPlayers) {
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

    // ⚠️ Duplicate-number rule is enforced on backend.
    // We do NOT block here to avoid false "already taken" errors.
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

console.log(
  `[game] initialized - user=${USER_ID}, game=${GAME}, bet=${FIXED_BET_AMOUNT}`
);
