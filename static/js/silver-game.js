// ================= CONSTANTS & CONFIG =================

const GAME = (typeof GAME_TYPE !== 'undefined') ? GAME_TYPE : "silver";
const FIXED_BET_AMOUNT = (typeof FIXED_BET_AMOUNT !== 'undefined') ? FIXED_BET_AMOUNT : 10;

// Optional: support multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;

// Real logged-in user from Flask session (passed in HTML)
const USER_ID = (typeof GAME_USER_ID !== 'undefined') ? GAME_USER_ID : null;
const USERNAME = (typeof GAME_USERNAME !== 'undefined') ? GAME_USERNAME : "Player";

// Where popup "Home" button goes
const HOME_URL = "/home";

// Animation timing constants
const JUMP_ANIMATION_DURATION = 720; // ms
const POPUP_SHOW_DELAY = JUMP_ANIMATION_DURATION + 500; // ms
const POLLING_INTERVAL = 2000; // ms
const LOCAL_TIMER_TICK = 1000; // ms
const PREVIEW_START_TIME = 10; // seconds

// Frog video sources
const FROG_VIDEOS = {
  front: "/static/video/front-jump-frog.mp4",
  left: "/static/video/left-jump-frog.mp4",
  right: "/static/video/right-jump-frog.mp4",
};

// ================= DOM REFERENCES =================

const pondEl = document.querySelector(".pond");
const frogImg = document.getElementById("frogSprite");
const frogVideo = document.getElementById("frogJumpVideo");
const frogVideoSource = frogVideo?.querySelector("source");
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

// Popup elements
const popupEl = document.getElementById("resultPopup");
const popupTitleEl = document.getElementById("popupTitle");
const popupMsgEl = document.getElementById("popupMessage");
const popupHomeBtn = document.getElementById("popupHomeBtn");
const popupLobbyBtn = document.getElementById("popupLobbyBtn");

// ================= STATE MANAGEMENT =================

let walletBalance = 0;
let selectedNumber = 0;
let currentTable = null;
let lastResultShown = null;

// Flags
let frogPreviewPlayed = false;
let gameFinished = false;
let userHasBet = false;
let frogVideoUnlocked = false;
let bettingInProgress = false;
let timerStarted = false;

// Intervals
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;

// Video event handler storage (to prevent memory leaks)
const videoHandlers = new Map();

// ================= UI HELPERS =================

/**
 * Display status message with optional styling
 */
function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

/**
 * Update wallet balance with animation
 */
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

/**
 * Format seconds to MM:SS display
 */
function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Render timer display
 */
function renderTimer() {
  if (!timerText) return;
  timerText.textContent = formatTime(displayRemainingSeconds);
}

/**
 * Set selected number and update UI
 */
function setSelectedNumber(n) {
  // Validate number is in range [0-9]
  if (typeof n !== 'number' || isNaN(n) || n < 0 || n > 9) {
    console.warn("[betting] Invalid number selected:", n);
    return;
  }
  
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

/**
 * Sanitize username to prevent XSS
 */
function sanitizeUsername(username) {
  return String(username || "").slice(0, 30);
}

/**
 * Update my bets display and userHasBet flag
 */
function updateMyBets(bets) {
  const myBets = (bets || []).filter(
    (b) => String(b.user_id) === String(USER_ID)
  );

  // CRITICAL FIX: Reset flag each time - only set true if bets exist
  if (myBets.length > 0) {
    userHasBet = true;
  } else {
    userHasBet = false; // ← ADDED: Reset flag
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

  myBets.forEach((b) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = sanitizeUsername(b.number);
    myBetsRow.appendChild(chip);
  });
}

/**
 * Update pad displays with first 6 bets
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
      if (userSpan) userSpan.textContent = sanitizeUsername(b.username);
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

/**
 * Ensure winning number is displayed on at least one pad
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

/**
 * Disable all betting UI elements
 */
function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach((chip) => {
    chip.disabled = true;
  });
}

/**
 * Determine user outcome (win/lose/none)
 */
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

/**
 * Show end game popup with outcome message
 */
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

/**
 * Show "slots full" popup and redirect
 */
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

/**
 * Sync URL with current table code
 */
function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  try {
    const url = new URL(window.location.href);
    const currentParam = url.searchParams.get("table");
    if (currentParam === roundCode) return;
    url.searchParams.set("table", roundCode);
    window.history.replaceState({}, "", url.toString());
  } catch (err) {
    console.warn("[url] Unable to sync with table code", err);
  }
}

// ================= FROG VIDEO UNLOCK (MOBILE FIX) =================

/**
 * Unlock video playback on user interaction (required for mobile)
 */
function unlockFrogVideoPlayback() {
  if (frogVideoUnlocked) return;

  const unlocker = document.getElementById("frogUnlocker");
  if (!unlocker) return;

  unlocker.muted = true;
  unlocker.play()
    .then(() => {
      unlocker.pause();
      frogVideoUnlocked = true;
      console.log("[frog] video playback unlocked");
    })
    .catch(() => {
      console.warn("[frog] video unlock failed, will retry");
    });
}

// ================= FROG ANIMATION =================

/**
 * Get jump direction based on pad index
 * Pad layout:
 * [0][1][2]
 * [3][4][5]
 */
function getJumpDirectionByPadIndex(index) {
  if (index === 0 || index === 1) return "left";
  if (index === 2 || index === 3) return "front";
  return "right";
}

/**
 * Find pad element for winning number
 */
function findPadForNumber(winningNumber) {
  const targetStr = String(winningNumber);

  return pads.find((p) => {
    if (p.dataset.number === targetStr) return true;
    const label = p.querySelector(".pad-number");
    return label && label.textContent.trim() === targetStr;
  });
}

/**
 * Cleanup video event handlers to prevent memory leaks
 */
function cleanupVideoHandlers() {
  videoHandlers.forEach((handler, event) => {
    if (frogVideo) {
      frogVideo.removeEventListener(event, handler);
    }
  });
  videoHandlers.clear();
}

/**
 * Hop frog using CSS transform (fallback)
 */
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

  if (frogImg) {
    frogImg.style.transition =
      "transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1)";
    frogImg.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
  }

  setTimeout(() => {
    if (frogImg) {
      frogImg.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
    }
    targetPad.classList.add("win");
  }, JUMP_ANIMATION_DURATION);
}

/**
 * Hop frog using video animation (main method)
 */
function hopFrogToWinningNumberVideo(winningNumber) {
  if (!frogVideo || !frogImg || !pondEl || !frogVideoSource) {
    hopFrogToWinningNumberTransform(winningNumber);
    return;
  }

  const targetPad = findPadForNumber(winningNumber);
  if (!targetPad) {
    hopFrogToWinningNumberTransform(winningNumber);
    return;
  }

  const padIndex = pads.indexOf(targetPad);
  if (padIndex === -1) {
    hopFrogToWinningNumberTransform(winningNumber);
    return;
  }

  // Stop any preview playback
  frogVideo.pause();
  frogVideo.currentTime = 0;
  frogVideo.style.display = "none";

  // Get direction and video source
  const direction = getJumpDirectionByPadIndex(padIndex);
  const videoSrc = FROG_VIDEOS[direction] || FROG_VIDEOS.front;

  frogVideoSource.src = videoSrc;
  frogVideo.load();

  // Calculate positions
  const pondRect = pondEl.getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const startX = frogRect.left - pondRect.left;
  const startY = frogRect.top - pondRect.top;

  frogVideo.style.left = `${startX}px`;
  frogVideo.style.top = `${startY}px`;
  frogVideo.classList.add("playing");
  frogVideo.currentTime = 0;

  if (frogImg) {
    frogImg.classList.add("hidden");
  }

  // CRITICAL FIX: Use event listeners with cleanup instead of inline properties
  const loadHandler = () => {
    frogVideo.play().catch((err) => {
      console.warn("[frog] play failed, using transform fallback:", err);
      hopFrogToWinningNumberTransform(winningNumber);
    });
  };

  const endHandler = () => {
    // Cleanup handlers
    cleanupVideoHandlers();

    frogVideo.classList.remove("playing");

    const endX = padRect.left - pondRect.left;
    const endY = padRect.top - pondRect.top;

    if (frogImg) {
      frogImg.style.transition = "transform 0.2s ease-out";
      frogImg.style.transform = `translate(${endX - startX}px, ${endY - startY}px)`;
      frogImg.classList.remove("hidden");
    }

    targetPad.classList.add("win");
  };

  // Store handlers for cleanup
  videoHandlers.set('loadeddata', loadHandler);
  videoHandlers.set('ended', endHandler);

  // Attach listeners (one-time)
  frogVideo.addEventListener('loadeddata', loadHandler, { once: true });
  frogVideo.addEventListener('ended', endHandler, { once: true });
}

/**
 * Main entry point: decide animation method based on time
 */
function hopFrogToWinningNumber(winningNumber) {
  if (displayRemainingSeconds <= PREVIEW_START_TIME) {
    hopFrogToWinningNumberVideo(winningNumber);
  } else {
    hopFrogToWinningNumberTransform(winningNumber);
  }
}

/**
 * Show frog static breathing animation
 */
function showFrogStatic() {
  if (frogVideo) {
    frogVideo.pause();
    frogVideo.classList.remove("playing");
  }
  if (frogImg) {
    frogImg.classList.remove("hidden");
  }
}

// ================= TIMER MANAGEMENT =================

/**
 * Ensure local timer only starts once per round
 */
function ensureLocalTimer() {
  if (timerStarted) return;
  timerStarted = true;
  startLocalTimer();
}

/**
 * Stop local timer and reset flag
 */
function stopLocalTimer() {
  timerStarted = false;
  if (localTimerInterval) {
    clearInterval(localTimerInterval);
    localTimerInterval = null;
  }
}

/**
 * Start 1-second countdown timer
 */
function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);

  localTimerInterval = setInterval(() => {
    if (gameFinished) return;

    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds = Math.max(0, displayRemainingSeconds - 1);
      renderTimer();

      // Play preview EXACTLY ONCE at 10 seconds
      if (displayRemainingSeconds === PREVIEW_START_TIME && !frogPreviewPlayed) {
        frogPreviewPlayed = true;
        console.log("[frog] 10 seconds reached – start jump preview");

        if (frogVideo && frogVideoSource) {
          frogVideo.pause();
          frogVideoSource.src = FROG_VIDEOS.front;
          frogVideo.load();

          const previewHandler = () => {
            if (frogImg) {
              frogImg.classList.add("hidden");
            }
            frogVideo.classList.add("playing");
            frogVideo.muted = true;
            unlockFrogVideoPlayback();
            frogVideo.play().catch((err) => {
              console.warn("[frog] preview play blocked", err);
            });
          };

          frogVideo.addEventListener('loadeddata', previewHandler, { once: true });
        }
      }

      // Show static frog before preview
      if (displayRemainingSeconds > PREVIEW_START_TIME) {
        showFrogStatic();
      }
    }
  }, LOCAL_TIMER_TICK);
}

// ================= BACKEND POLLING =================

/**
 * Fetch current table data from API
 */
async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/silver");

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    const data = await res.json();

    if (!data.tables?.length) {
      setStatus("No active tables", "error");
      return;
    }

    // Find current table or use first available
    let table = TABLE_CODE
      ? data.tables.find((t) => t.round_code === TABLE_CODE)
      : null;

    if (!table) {
      table = data.tables[0];
    }

    if (!table) {
      setStatus("Table not found", "error");
      return;
    }

    syncUrlWithTable(table.round_code);
    currentTable = table;
    updateGameUI(table);
  } catch (err) {
    console.error("[api] fetchTableData error:", err);
    setStatus("Failed to load game data", "error");
  }
}

/**
 * Update game UI with table data
 */
function updateGameUI(table) {
  if (!table) return;

  // === BASIC UI UPDATE ===
  if (roundIdSpan) roundIdSpan.textContent = table.round_code ?? "-";
  if (playerCountSpan) playerCountSpan.textContent = table.players ?? 0;

  displayRemainingSeconds = table.time_remaining ?? 0;
  renderTimer();

  updatePadsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  // Update bet button state
  if (placeBetBtn && !gameFinished) {
    const maxPlayers =
      typeof table.max_players === "number" ? table.max_players : null;
    const isBettingClosed = table.is_betting_closed === true;
    const isFull =
      maxPlayers !== null && table.players >= maxPlayers;

    placeBetBtn.disabled = isBettingClosed || isFull;
  }

  // === SLOTS FULL CHECK ===
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
    stopLocalTimer();

    showSlotsFullPopup();
    return;
  }

  // === RESULT HANDLING ===
  const hasResult = table.result !== null && table.result !== undefined && table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    lastResultShown = table.result;

    setStatus(`Winning number: ${table.result}`, "ok");
    ensurePadForWinningNumber(table.result);

    hopFrogToWinningNumber(table.result);

    // End game after animation completes
    if (!gameFinished) {
      gameFinished = true;
      disableBettingUI();

      if (tablePollInterval) {
        clearInterval(tablePollInterval);
        tablePollInterval = null;
      }
      stopLocalTimer();

      const outcomeInfo = determineUserOutcome(table);

      setTimeout(() => {
        showEndPopup(outcomeInfo);
      }, POPUP_SHOW_DELAY);
    }
  } else if (!hasResult) {
    // === NEW ROUND RESET ===
    if (lastResultShown !== null) {
      // Only reset if we had a result before (new round)
      lastResultShown = null;
      frogPreviewPlayed = false;
      gameFinished = false;
      userHasBet = false;
      stopLocalTimer();
      ensureLocalTimer();

      pads.forEach((p) => p.classList.remove("win"));

      if (frogImg) {
        frogImg.style.transition = "transform 0.3s ease-out";
        frogImg.style.transform = "translate(0px, 0px) scale(1)";
        frogImg.classList.remove("hidden");
      }

      if (frogVideo) {
        frogVideo.pause();
        frogVideo.currentTime = 0;
        frogVideo.classList.remove("playing");
        cleanupVideoHandlers();
      }
    } else if (!timerStarted) {
      // First time: start timer
      ensureLocalTimer();
    }
  }
}

/**
 * Start polling table data
 */
function startPolling() {
  fetchTableData();

  if (tablePollInterval) clearInterval(tablePollInterval);

  tablePollInterval = setInterval(() => {
    if (!gameFinished) {
      fetchTableData();
    }
  }, POLLING_INTERVAL);
}

// ================= SOCKET & BALANCE =================

const socket = io();

/**
 * Fetch user wallet balance
 */
async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);

    if (!res.ok) {
      throw new Error(`Balance fetch failed: ${res.status}`);
    }

    const data = await res.json();

    if (typeof data.balance === "number") {
      updateWallet(data.balance);
    }
  } catch (err) {
    console.error("[balance] fetch error:", err);
  }
}

/**
 * Join game room via socket
 */
function joinGameRoom() {
  socket.emit("join_game", {
    game_type: GAME,
    user_id: USER_ID,
  });
}

/**
 * Socket event: connection established
 */
socket.on("connect", () => {
  console.log("[socket] connected");
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

/**
 * Socket event: bet successful
 */
socket.on("bet_success", (payload) => {
  if (gameFinished) return;

  // Mark user as having bet
  userHasBet = true;
  bettingInProgress = false;

  setStatus(payload.message || "Bet placed", "ok");

  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }

  fetchTableData();
});

/**
 * Socket event: bet error
 */
socket.on("bet_error", (payload) => {
  if (gameFinished) return;

  bettingInProgress = false;
  setStatus(payload.message || "Bet error", "error");
});

/**
 * Socket cleanup on page exit
 */
window.addEventListener("beforeunload", () => {
  socket.disconnect();
  if (tablePollInterval) clearInterval(tablePollInterval);
  stopLocalTimer();
});

// ================= UI EVENT LISTENERS =================

/**
 * Number chip selection
 */
numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (gameFinished) return;
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

/**
 * Place bet button handler
 */
if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    // Debounce: prevent rapid clicks
    if (bettingInProgress) {
      setStatus("Placing bet...", "");
      return;
    }

    if (gameFinished) {
      setStatus("This game has already finished.", "error");
      return;
    }

    if (!currentTable) {
      setStatus("Game is not ready yet. Please wait...", "error");
      return;
    }

    // Check slots
    const maxPlayers =
      typeof currentTable.max_players === "number"
        ? currentTable.max_players
        : null;

    if (maxPlayers !== null && currentTable.players >= maxPlayers) {
      setStatus("All slots are full for this game.", "error");
      disableBettingUI();
      return;
    }

    // Check balance
    if (walletBalance < FIXED_BET_AMOUNT) {
      setStatus(
        `Insufficient balance. Need ${FIXED_BET_AMOUNT}, have ${walletBalance.toFixed(0)}`,
        "error"
      );
      return;
    }

    // Check number selected
    if (selectedNumber === null || selectedNumber === undefined || selectedNumber === 0) {
      setStatus("Select a number first", "error");
      return;
    }

    // Emit bet
    bettingInProgress = true;
    socket.emit("place_bet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });

    // Timeout fallback to reset flag
    setTimeout(() => {
      if (bettingInProgress) {
        bettingInProgress = false;
      }
    }, 5000);
  });
}

/**
 * Popup home button
 */
if (popupHomeBtn) {
  popupHomeBtn.addEventListener("click", () => {
    window.location.href = HOME_URL;
  });
}

/**
 * Popup lobby button
 */
if (popupLobbyBtn) {
  popupLobbyBtn.addEventListener("click", () => {
    window.history.back();
  });
}

// ================= INITIALIZATION =================

// Display username
if (userNameLabel) {
  userNameLabel.textContent = sanitizeUsername(USERNAME);
}

// Initialize frog video state
if (frogVideo) {
  frogVideo.classList.remove("playing");
  frogVideo.muted = true;
}

if (frogImg) {
  frogImg.classList.remove("hidden");
}

// Start game
fetchBalance();
startPolling();
ensureLocalTimer();
setSelectedNumber(0);
setStatus("");

console.log(
  `[game] initialized - user=${USER_ID}, game=${GAME}, bet=${FIXED_BET_AMOUNT}`
);
