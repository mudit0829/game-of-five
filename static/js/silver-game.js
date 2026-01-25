// ================= BASIC SETUP =================
const GAME = window.GAME_TYPE || "silver";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 10;
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;
const USER_ID = window.GAME_USER_ID || null;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ================= DOM REFERENCES =================
const pondEl = document.querySelector(".pond");
const frogContainer = document.getElementById("frogContainer");
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

// Unlock video on interaction
let videoUnlocked = false;
document.addEventListener("click", () => {
  if (videoUnlocked || !frogJumpVideo) return;
  frogJumpVideo.muted = true;
  frogJumpVideo.play().then(() => {
    frogJumpVideo.pause();
    frogJumpVideo.currentTime = 0;
    videoUnlocked = true;
    console.log("[frog] video unlocked");
  }).catch(() => {});
}, { once: true });

if (userNameLabel) userNameLabel.textContent = USERNAME;

let walletBalance = 0;
let selectedNumber = 0;
let currentTable = null;
let lastResultShown = null;
let lockedWinningPad = null;
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;
let jumpStarted = false;
let storedResult = null;
let userHasBet = false;
let pendingOutcomeInfo = null;
let myCurrentBets = [];

// ================= HELPERS =================
function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (type ? " " + type : "");
}

function updateWallet(balance) {
  walletBalance = balance;
  if (walletBalanceSpan) walletBalanceSpan.textContent = walletBalance.toFixed(0);
}

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function renderTimer() {
  if (timerText) timerText.textContent = formatTime(displayRemainingSeconds);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach(chip => {
    chip.classList.toggle("selected", parseInt(chip.dataset.number, 10) === n);
  });
}

// ✅ FIXED: Update my bets display with correct format
function updateMyBets(bets) {
  const myBets = (bets || []).filter(b => {
    const betUserId = String(b.user_id || b.userId || "");
    return betUserId === String(USER_ID);
  });
  
  myCurrentBets = myBets;
  
  if (myBets.length > 0) {
    userHasBet = true;
  }
  
  // ✅ UPDATE YELLOW #2: Show total bet count
  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }
  
  // ✅ UPDATE YELLOW #1: Show "Your Bets: 1, 6" format
  if (myBetsRow) {
    if (myBets.length === 0) {
      myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
    } else {
      const numbers = myBets.map(b => b.number).sort((a, b) => a - b);
      myBetsRow.innerHTML = numbers.map(n => `<span class="my-bet-chip">${n}</span>`).join(", ");
    }
  }
  
  console.log("[updateMyBets] Count:", myBets.length, "Numbers:", myBets.map(b => b.number).join(","));
}

function updatePadsFromBets(bets) {
  const list = (bets || []).slice(0, 6);
  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    
    if (!gameFinished) {
      pad.classList.remove("win");
    }
    
    if (i < list.length) {
      const bet = list[i];
      pad.dataset.number = String(bet.number);
      if (numSpan) numSpan.textContent = bet.number;
      if (userSpan) userSpan.textContent = bet.username;
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
  
  console.log("[updatePadsFromBets] Updated", list.length, "pads from bets");
}

function ensurePadForWinningNumber(winningNumber) {
  if (winningNumber == null) return;
  const str = String(winningNumber);
  if (pads.some(p => p.dataset.number === str)) return;
  const pad = pads[0];
  if (!pad) return;
  pad.dataset.number = str;
  const numSpan = pad.querySelector(".pad-number");
  if (numSpan) numSpan.textContent = str;
}

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach(c => c.disabled = true);
}

function determineUserOutcome(table) {
  const result = table.result;
  const myBets = (table.bets || []).filter(b => String(b.user_id) === String(USER_ID));
  if (!myBets.length) return { outcome: "none", result };
  return { outcome: myBets.some(b => String(b.number) === String(result)) ? "win" : "lose", result };
}

// ✅ FIXED: Show result popup when game ends
function showResultPopup(outcomeInfo) {
  if (!popupEl) return;
  const { outcome } = outcomeInfo;
  
  let title = "Game Finished";
  if (outcome === "win") {
    title = "Congratulations! 🎉";
  } else if (outcome === "lose") {
    title = "Hard Luck! 😢";
  }
  
  console.log("[popup] Showing:", title);
  popupTitleEl.textContent = title;
  popupMsgEl.textContent = "Please keep playing to keep your winning chances high.";
  popupEl.style.display = "flex";
  
  setTimeout(() => window.history.back(), 5000);
}

function showSlotsFullPopup() {
  if (!popupEl) return;
  popupTitleEl.textContent = "All slots are full";
  popupMsgEl.textContent = "This game is already full. Redirecting to lobby...";
  popupEl.style.display = "flex";
  setTimeout(() => window.history.back(), 2000);
}

// ================= FROG LOGIC =================
function getJumpDirectionByPadIndex(index) {
  if (index <= 1) return "left";
  if (index <= 3) return "front";
  return "right";
}

function findPadForNumber(num) {
  const str = String(num);
  return pads.find(p => p.dataset.number === str || p.querySelector(".pad-number")?.textContent.trim() === str);
}

function hopFrogToWinningNumber(winningNumber) {
  if (jumpStarted) return;
  jumpStarted = true;
  console.log("[frog] Starting jump to number:", winningNumber);

  const targetPad = lockedWinningPad || findPadForNumber(winningNumber);
  if (!targetPad) {
    console.warn("[frog] No target pad found for number:", winningNumber);
    jumpStarted = false;
    return;
  }

  const padIndex = pads.indexOf(targetPad);
  const direction = getJumpDirectionByPadIndex(padIndex);
  const animationClass = `jump-${direction}`;

  console.log(`[frog] Jump animation → ${direction} to number ${winningNumber} (pad ${padIndex})`);

  frogIdleVideo.pause();
  frogIdleVideo.style.display = "none";

  frogVideoSource.src = FROG_VIDEOS[direction] || FROG_VIDEOS.front;
  frogJumpVideo.load();
  frogJumpVideo.style.display = "block";
  frogJumpVideo.currentTime = 0;

  frogJumpVideo.onloadeddata = () => {
    console.log("[frog] Video ready, playing...");
    frogJumpVideo.play().catch(e => console.error("[frog] Play error:", e));
    frogContainer.classList.add(animationClass, "jumping");
  };

  frogJumpVideo.onended = () => {
    console.log("[frog] Jump animation finished");
    frogJumpVideo.style.display = "none";
    frogIdleVideo.style.display = "block";
    frogIdleVideo.play();

    targetPad.classList.add("win");
    gameFinished = true;

    setTimeout(() => {
      frogContainer.classList.remove("jumping", "jump-left", "jump-front", "jump-right");
    }, 1800);

    if (pendingOutcomeInfo) {
      console.log("[frog] Showing result popup after jump");
      showResultPopup(pendingOutcomeInfo);
      pendingOutcomeInfo = null;
    }
  };
}

// ================= TIMER =================
function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (gameFinished) return;
    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds--;
      renderTimer();
      if (displayRemainingSeconds === 15) disableBettingUI();
      if (displayRemainingSeconds === 10 && storedResult !== null && !jumpStarted) {
        console.log("[timer] Trigger jump at 10s, result:", storedResult);
        hopFrogToWinningNumber(storedResult);
      }
    }
  }, 1000);
}

// ================= POLLING & UPDATE =================
async function fetchTableData() {
  if (gameFinished && lastResultShown !== null) return;
  try {
    const res = await fetch("/api/tables/silver");
    const data = await res.json();
    if (!data.tables?.length) {
      console.log("[fetch] No tables available");
      return setStatus("No active tables", "error");
    }
    
    let table = TABLE_CODE 
      ? data.tables.find(t => t.round_code === TABLE_CODE) 
      : data.tables[0];
    
    if (!table) {
      console.log("[fetch] Table not found");
      return;
    }
    
    currentTable = table;
    console.log("[fetch] Table data:", {
      round: table.round_code,
      players: table.players,
      bets: table.bets?.length || 0,
      result: table.result,
      time: table.time_remaining
    });
    
    updateGameUIMinimal(table);
  } catch (err) {
    console.error("[fetch] error:", err);
  }
}

function updateGameUIMinimal(table) {
  roundIdSpan.textContent = table.round_code || "-";

  if (!gameFinished) {
    const oldSec = displayRemainingSeconds;
    displayRemainingSeconds = table.time_remaining || 0;
    if (oldSec !== displayRemainingSeconds) renderTimer();
  }

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled = displayRemainingSeconds <= 15 || 
      (table.max_players && table.players >= table.max_players);
  }

  const isFull = table.is_full || (table.max_players && table.players >= table.max_players);
  if (!gameFinished && !userHasBet && isFull) {
    console.log("[game] Slots full and user didn't bet");
    disableBettingUI();
    clearInterval(tablePollInterval);
    tablePollInterval = null;
    showSlotsFullPopup();
    return;
  }

  // ✅ CRITICAL: Handle game result
  if (table.result != null && table.result !== lastResultShown) {
    console.log(`[GAME RESULT] Result announced: ${table.result}, time remaining: ${displayRemainingSeconds}s, userHasBet: ${userHasBet}`);
    
    lastResultShown = table.result;
    storedResult = table.result;
    ensurePadForWinningNumber(table.result);
    lockedWinningPad = findPadForNumber(table.result);
    pendingOutcomeInfo = determineUserOutcome(table);

    console.log("[GAME RESULT] Outcome info:", pendingOutcomeInfo);

    if (!userHasBet) {
      console.log("[game] User didn't bet, showing slots full popup");
      showSlotsFullPopup();
      return;
    }

    if (!jumpStarted && displayRemainingSeconds <= 12) {
      console.log("[game] Triggering jump now");
      hopFrogToWinningNumber(storedResult);
    } else {
      console.log("[game] Jump already started or time not right:", { jumpStarted, displayRemainingSeconds });
    }
  }

  // ✅ CRITICAL: Handle new round
  if (table.result === null && lastResultShown !== null) {
    console.log("[NEW ROUND] Resetting for new round");
    jumpStarted = false;
    storedResult = null;
    lastResultShown = null;
    gameFinished = false;
    userHasBet = false;
    myCurrentBets = [];
    pendingOutcomeInfo = null;
    lockedWinningPad = null;
    
    pads.forEach(p => p.classList.remove("win"));
    frogContainer.classList.remove("jumping", "jump-left", "jump-front", "jump-right");
    frogJumpVideo.pause();
    frogJumpVideo.style.display = "none";
    frogJumpVideo.currentTime = 0;
    frogIdleVideo.style.display = "block";
    frogIdleVideo.play();
    
    if (popupEl) popupEl.style.display = "none";
    
    if (userBetCountLabel) userBetCountLabel.textContent = "0";
    if (myBetsRow) myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
    
    if (placeBetBtn) placeBetBtn.disabled = false;
    numChips.forEach(c => c.disabled = false);
  }
}

function startPolling() {
  console.log("[init] Starting polling");
  fetchTableData();
  tablePollInterval = setInterval(fetchTableData, 1500);
}

// ================= SOCKET & EVENTS =================
const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const { balance } = await res.json();
    if (typeof balance === "number") updateWallet(balance);
  } catch (e) {
    console.error("[balance] fetch error:", e);
  }
}

socket.on("connect", () => {
  console.log("[socket] CONNECTED");
  socket.emit("join_game", { game_type: GAME, user_id: USER_ID });
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
socket.on("bet_success", payload => {
  console.log("[bet_success] Received - players:", payload.players?.length || 0);
  if (gameFinished) {
    console.log("[bet_success] Game finished, ignoring");
    return;
  }
  
  userHasBet = true;
  setStatus("Bet placed ✓", "ok");
  
  if (payload.new_balance != null) {
    updateWallet(payload.new_balance);
  }
  
  if (payload.players && Array.isArray(payload.players)) {
    console.log("[bet_success] Updating UI with", payload.players.length, "players");
    updatePadsFromBets(payload.players);
    updateMyBets(payload.players);
    
    if (playerCountSpan) {
      playerCountSpan.textContent = payload.players.length;
    }
  }
  
  if (payload.round_code && roundIdSpan) {
    roundIdSpan.textContent = payload.round_code;
  }
});

// ✅ LISTEN FOR BROADCAST TABLE UPDATES
socket.on("update_table", payload => {
  console.log("[update_table] BROADCAST received - players:", payload.players?.length || 0);
  
  if (payload.players && Array.isArray(payload.players)) {
    console.log("[update_table] Updating UI with", payload.players.length, "players");
    playerCountSpan.textContent = payload.players.length;
    updatePadsFromBets(payload.players);
    updateMyBets(payload.players);
  }
  
  if (payload.time_remaining != null) {
    displayRemainingSeconds = payload.time_remaining;
    renderTimer();
  }
  
  if (payload.slots_available != null && placeBetBtn) {
    const slotsEmpty = payload.slots_available > 0;
    placeBetBtn.disabled = !slotsEmpty || displayRemainingSeconds <= 15;
  }
  
  if (payload.is_betting_closed) {
    disableBettingUI();
  }
  
  if (payload.round_code && roundIdSpan) {
    roundIdSpan.textContent = payload.round_code;
  }
});

// ✅ LISTEN FOR BET ERRORS
socket.on("bet_error", payload => {
  console.error("[bet_error]:", payload.message);
  setStatus(payload.message || "Bet error", "error");
});

// ================= EVENT LISTENERS =================

numChips.forEach(chip => {
  chip.addEventListener("click", () => {
    if (!gameFinished && !chip.disabled) {
      setSelectedNumber(parseInt(chip.dataset.number, 10));
    }
  });
});

placeBetBtn?.addEventListener("click", () => {
  if (gameFinished) {
    return setStatus("Game finished", "error");
  }
  if (!currentTable) {
    return setStatus("Game not ready", "error");
  }
  if (walletBalance < FIXED_BET_AMOUNT) {
    return setStatus("Insufficient balance", "error");
  }
  if (selectedNumber == null || selectedNumber < 0) {
    return setStatus("Select a number", "error");
  }

  console.log("[place_bet] Emitting:", selectedNumber);
  socket.emit("place_bet", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber,
  });
});

popupHomeBtn?.addEventListener("click", () => {
  window.location.href = HOME_URL;
});

popupLobbyBtn?.addEventListener("click", () => {
  window.history.back();
});

// ================= INITIALIZATION =================
console.log(`[INIT] Game=${GAME}, User=${USER_ID}, Username=${USERNAME}, Bet=${FIXED_BET_AMOUNT}`);

fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
