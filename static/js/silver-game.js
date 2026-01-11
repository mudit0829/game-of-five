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
const pondEl = document.querySelector(".pond");
const frogIdleVideo = document.getElementById("frogIdleVideo");
const frogJumpVideo = document.getElementById("frogJumpVideo");
const frogVideoSource = document.getElementById("frogVideoSource");
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
// popup elements
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

// 🔓 Unlock video playback on first user interaction
let videoUnlocked = false;
document.addEventListener("click", () => {
  if (videoUnlocked || !frogJumpVideo) return;
  frogJumpVideo.muted = true;
  frogJumpVideo.play().then(() => {
    frogJumpVideo.pause();
    frogJumpVideo.currentTime = 0;
    videoUnlocked = true;
    console.log("[frog] video unlocked by user interaction");
  }).catch(() => {});
}, { once: true });

// Display username
if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

let walletBalance = 0;
let selectedNumber = 0;
let currentTable = null;
let lastResultShown = null;
let lockedWinningPad = null;

// flags / intervals
let frogPreviewPlayed = false;
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;
let jumpStarted = false;
let storedResult = null;

// IMPORTANT: persistent flag – once true, never set back to false
let userHasBet = false;

// Store outcome for popup
let pendingOutcomeInfo = null;

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
  popupEl.style.visibility = "visible";
  popupEl.style.opacity = "1";

  // AUTO-RETURN TO LOBBY AFTER 5 SECONDS
  setTimeout(() => {
    window.history.back();
  }, 5000);
}

function showSlotsFullPopup() {
  if (!popupEl) return;
  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl)
    popupMsgEl.textContent =
      "This game is already full. You will be redirected to lobby to join another table.";

  popupEl.style.display = "flex";
  popupEl.style.visibility = "visible";
  popupEl.style.opacity = "1";

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
function getJumpDirectionByPadIndex(index) {
  if (index === 0 || index === 1) return "left";
  if (index === 2 || index === 3) return "front";
  return "right";
}

function findPadForNumber(winningNumber) {
  const targetStr = String(winningNumber);
  const pad = pads.find((p) => {
    if (p.dataset.number === targetStr) return true;
    const label = p.querySelector(".pad-number");
    return label && label.textContent.trim() === targetStr;
  });
  return pad;
}

function hopFrogToWinningNumber(winningNumber) {
  const targetPad = lockedWinningPad || findPadForNumber(winningNumber);
  if (!targetPad) {
    console.warn("[frog] No target pad found for number:", winningNumber);
    return;
  }

  const padIndex = pads.indexOf(targetPad);
  const direction = getJumpDirectionByPadIndex(padIndex);
  const videoSrc = FROG_VIDEOS[direction] || FROG_VIDEOS.front;

  console.log("[frog] Starting jump →", direction, "to number:", winningNumber, "at seconds left:", displayRemainingSeconds);

  // hide idle
  frogIdleVideo.pause();
  frogIdleVideo.style.display = "none";

  // prepare jump video
  frogVideoSource.src = videoSrc;
  frogJumpVideo.load();
  frogJumpVideo.style.display = "block";
  frogJumpVideo.currentTime = 0;

  frogJumpVideo.onloadeddata = () => {
    console.log("[frog] Video loaded, attempting to play");
    frogJumpVideo.play().catch(e => console.error("[frog] Play failed:", e));
  };

  frogJumpVideo.onended = () => {
    console.log("[frog] Jump video ended");
    frogJumpVideo.style.display = "none";
    frogIdleVideo.style.display = "block";
    frogIdleVideo.play();
    targetPad.classList.add("win");

    gameFinished = true;
    if (pendingOutcomeInfo) {
      showEndPopup(pendingOutcomeInfo);
      pendingOutcomeInfo = null;
    }
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

      // Close betting at 0:15
      if (displayRemainingSeconds === 15) {
        disableBettingUI();
      }

      // 🐸 START JUMP AT 0:10 (when 10 seconds remain)
      if (displayRemainingSeconds === 10 && !jumpStarted) {
        if (storedResult !== null) {
          console.log("[frog] Triggering timed jump at 10s");
          jumpStarted = true;
          hopFrogToWinningNumber(storedResult);
        } else {
          console.warn("[frog] No result available at 10s - waiting for force trigger");
        }
      }

      // Highlight winning pad at 0:05 as fallback (if video is ~5s long)
      if (displayRemainingSeconds === 5 && lockedWinningPad) {
        lockedWinningPad.classList.add("win");
      }
    }
  }, 1000);
}

// ================= BACKEND POLLING =================
async function fetchTableData() {
  if (gameFinished && lastResultShown !== null) return;
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

  if (roundIdSpan) roundIdSpan.textContent = table.round_code || "-";
  if (playerCountSpan) playerCountSpan.textContent = table.players || 0;

  // Sync timer to server every poll to prevent drift
  if (!gameFinished) {
    displayRemainingSeconds = table.time_remaining || 0;
  }
  renderTimer();

  updatePadsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled =
      displayRemainingSeconds <= 15 ||
      (typeof table.max_players === "number" &&
        table.players >= table.max_players);
  }

  // Slots full check
  const maxPlayers = typeof table.max_players === "number" ? table.max_players : null;
  const isFull = table.is_full === true || (maxPlayers !== null && table.players >= maxPlayers);

  if (!gameFinished && !userHasBet && isFull) {
    disableBettingUI();
    if (tablePollInterval) {
      clearInterval(tablePollInterval);
      tablePollInterval = null;
    }
    showSlotsFullPopup();
    return;
  }

  // ================= RESULT HANDLING =================
  const hasResult = table.result !== null && table.result !== undefined && table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    console.log("[game] Result received:", table.result, "at local seconds left:", displayRemainingSeconds);
    lastResultShown = table.result;
    storedResult = table.result;
    ensurePadForWinningNumber(table.result);
    lockedWinningPad = findPadForNumber(table.result);
    pendingOutcomeInfo = determineUserOutcome(table);

    if (!userHasBet) {
      showSlotsFullPopup();
      return;
    }

    // Force jump if we already passed the jump time
    if (!jumpStarted && displayRemainingSeconds <= 10) {
      console.log("[frog] Force triggering jump at", displayRemainingSeconds, "s");
      jumpStarted = true;
      hopFrogToWinningNumber(storedResult);
    }
  }

  // ================= NEW ROUND RESET =================
  if (table.result === null && lastResultShown !== null) {
    console.log("[game] New round → resetting");
    jumpStarted = false;
    storedResult = null;
    lastResultShown = null;
    gameFinished = false;
    userHasBet = false;
    pendingOutcomeInfo = null;
    lockedWinningPad = null;
    pads.forEach(p => p.classList.remove("win"));

    if (frogJumpVideo) {
      frogJumpVideo.pause();
      frogJumpVideo.currentTime = 0;
      frogJumpVideo.style.display = "none";
    }
    if (frogIdleVideo) {
      frogIdleVideo.style.display = "block";
      frogIdleVideo.play();
    }
    if (popupEl) {
      popupEl.style.display = "none";
    }
  }
}

function startPolling() {
  fetchTableData();
  if (tablePollInterval) clearInterval(tablePollInterval);
  tablePollInterval = setInterval(() => {
    fetchTableData();
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
    const maxPlayers = typeof currentTable.max_players === "number" ? currentTable.max_players : null;
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
fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");

console.log(
  `[game] initialized - user=${USER_ID}, game=${GAME}, bet=${FIXED_BET_AMOUNT}`
);
