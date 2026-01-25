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
let myCurrentBets = [];  // ✅ Track all my bets in current round

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

// ✅ FIXED: Handle both old structure and new structure
function updateMyBets(bets) {
  // Get all my bets from the bets array
  const myBets = (bets || []).filter(b => {
    // Handle both user_id and userId field names
    const betUserId = String(b.user_id || b.userId || "");
    return betUserId === String(USER_ID);
  });
  
  // Update global tracker
  myCurrentBets = myBets;
  
  if (myBets.length > 0) {
    userHasBet = true;
  }
  
  // Update bet count in top-left
  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }
  
  // Update my bets display
  if (!myBetsRow) return;
  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
  } else {
    // Extract just the numbers and display them
    const numbers = myBets.map(b => b.number).sort((a, b) => a - b);
    myBetsRow.innerHTML = numbers.map(n => `<span class="my-bet-chip">${n}</span>`).join(", ");
  }
  
  console.log("[updateMyBets] My bets:", myBets.length, "Numbers:", myBets.map(b => b.number));
}

function updatePadsFromBets(bets) {
  const list = (bets || []).slice(0, 6);
  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    
    // Don't remove win class if game is finished
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
  
  console.log("[updatePadsFromBets] Updated with", list.length, 'bets');
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

// ✅ FIXED: Show correct popup for game result
function showResultPopup(outcomeInfo) {
  if (!popupEl) return;
  const { outcome } = outcomeInfo;
  
  let title = "Game Finished";
  if (outcome === "win") {
    title = "Congratulations! 🎉";
  } else if (outcome === "lose") {
    title = "Hard Luck! 😢";
  }
  
  popupTitleEl.textContent = title;
  popupMsgEl.textContent = "Please keep playing to keep your winning chances high.";
  popupEl.style.display = "flex";
  
  // Auto-redirect after 5 seconds
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

  const targetPad = lockedWinningPad || findPadForNumber(winningNumber);
  if (!targetPad) {
    console.warn("[frog] No target pad found for number:", winningNumber);
    jumpStarted = false;
    return;
  }

  const padIndex = pads.indexOf(targetPad);
  const direction = getJumpDirectionByPadIndex(padIndex);
  const animationClass = `jump-${direction}`;

  console.log(`[frog] Starting new keyframe animation → ${direction} to number ${winningNumber} (pad ${padIndex})`);

  // 1. Hide idle
  frogIdleVideo.pause();
  frogIdleVideo.style.display = "none";

  // 2. Prepare jump video
  frogVideoSource.src = FROG_VIDEOS[direction] || FROG_VIDEOS.front;
  frogJumpVideo.load();
  frogJumpVideo.style.display = "block";
  frogJumpVideo.currentTime = 0;

  // 3. Start video and keyframe animation
  frogJumpVideo.onloadeddata = () => {
    console.log("[frog] Jump video ready → playing + keyframe animation");
    frogJumpVideo.play().catch(e => console.error("[frog] Play failed:", e));
    frogContainer.classList.add(animationClass, "jumping");
  };

  // 4. When video ends → win effect + reset animation
  frogJumpVideo.onended = () => {
    console.log("[frog] Jump animation finished");
    frogJumpVideo.style.display = "none";
    frogIdleVideo.style.display = "block";
    frogIdleVideo.play();

    targetPad.classList.add("win");
    gameFinished = true;

    // Return to center after celebration
    setTimeout(() => {
      frogContainer.classList.remove("jumping", "jump-left", "jump-front", "jump-right");
    }, 1800);

    // Show result popup
    if (pendingOutcomeInfo) {
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
        console.log("[timer] Normal jump trigger at 10s");
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
    if (!data.tables?.length) return setStatus("No active tables", "error");
    let table = TABLE_CODE 
      ? data.tables.find(t => t.round_code === TABLE_CODE) 
      : data.tables[0];
    if (!table) return;
    currentTable = table;
    
    // ✅ ONLY update game result/timer from polling
    // ✅ DO NOT update pads/bets (Socket.IO handles that in real-time)
    updateGameUIMinimal(table);
  } catch (err) {
    console.error("[fetch] error:", err);
  }
}

function updateGameUIMinimal(table) {
  // Update ONLY what polling should handle: round ID, timer, and game result
  roundIdSpan.textContent = table.round_code || "-";

  if (!gameFinished) {
    const oldSec = displayRemainingSeconds;
    displayRemainingSeconds = table.time_remaining || 0;
    if (oldSec !== displayRemainingSeconds) renderTimer();
  }

  // ✅ DO NOT call updatePadsFromBets() here - Socket.IO handles it LIVE
  // ✅ DO NOT call updateMyBets() here - Socket.IO handles it LIVE

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled = displayRemainingSeconds <= 15 || 
      (table.max_players && table.players >= table.max_players);
  }

  const isFull = table.is_full || (table.max_players && table.players >= table.max_players);
  if (!gameFinished && !userHasBet && isFull) {
    disableBettingUI();
    clearInterval(tablePollInterval);
    tablePollInterval = null;
    showSlotsFullPopup();
    return;
  }

  // ✅ ONLY polling should handle game results (not Socket.IO)
  if (table.result != null && table.result !== lastResultShown) {
    console.log(`[result] Received ${table.result} at ${displayRemainingSeconds}s left`);
    lastResultShown = table.result;
    storedResult = table.result;
    ensurePadForWinningNumber(table.result);
    lockedWinningPad = findPadForNumber(table.result);
    pendingOutcomeInfo = determineUserOutcome(table);

    if (!userHasBet) {
      // User didn't bet, just show game finished popup
      showSlotsFullPopup();
      return;
    }

    // User did bet, trigger frog jump
    if (!jumpStarted && displayRemainingSeconds <= 12) {
      console.log("[force] Late result → starting jump now");
      hopFrogToWinningNumber(storedResult);
    }
  }

  if (table.result === null && lastResultShown !== null) {
    console.log("[reset] New round detected");
    jumpStarted = false;
    storedResult = null;
    lastResultShown = null;
    gameFinished = false;
    userHasBet = false;
    myCurrentBets = [];  // ✅ Reset my bets for new round
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
    
    // Reset UI for new round
    if (userBetCountLabel) userBetCountLabel.textContent = "0";
    if (myBetsRow) myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
    
    // Re-enable betting UI
    if (placeBetBtn) placeBetBtn.disabled = false;
    numChips.forEach(c => c.disabled = false);
  }
}

function startPolling() {
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
  console.log("[socket] Connected to server");
  socket.emit("join_game", { game_type: GAME, user_id: USER_ID });
  fetchBalance();
  fetchTableData();
});

socket.on("disconnect", () => {
  console.log("[socket] Disconnected from server");
});

socket.on("connect_error", (error) => {
  console.error("[socket] Connection error:", error);
});

// ✅ LISTEN FOR OWN BET SUCCESS (direct response to place_bet)
socket.on("bet_success", payload => {
  console.log("[bet_success] Own bet placed:", payload);
  if (gameFinished) return;
  
  userHasBet = true;
  setStatus("Bet placed ✓", "ok");
  
  // Update wallet immediately
  if (payload.new_balance != null) {
    updateWallet(payload.new_balance);
  }
  
  // Update lily pads IMMEDIATELY with all players data
  if (payload.players && Array.isArray(payload.players)) {
    console.log("[bet_success] Updating pads with players:", payload.players);
    updatePadsFromBets(payload.players);
    updateMyBets(payload.players);
    
    // Update player count
    if (playerCountSpan) {
      playerCountSpan.textContent = payload.players.length;
    }
  }
  
  // Update round info if provided
  if (payload.round_code && roundIdSpan) {
    roundIdSpan.textContent = payload.round_code;
  }
});

// ✅ LISTEN FOR BROADCAST TABLE UPDATES (other players' bets in real-time)
socket.on("update_table", payload => {
  console.log("[update_table] Broadcast received - table update:", payload);
  // ✅ REMOVED: if (gameFinished) return; - Allow updates during game finish for last bets
  
  // Update player count and lily pads with all players
  if (payload.players && Array.isArray(payload.players)) {
    console.log("[update_table] Players data received, updating UI:", payload.players);
    playerCountSpan.textContent = payload.players.length;
    
    // IMMEDIATELY update lily pads with all players' bets
    updatePadsFromBets(payload.players);
    updateMyBets(payload.players);
  }
  
  // Update timer if provided
  if (payload.time_remaining != null) {
    displayRemainingSeconds = payload.time_remaining;
    renderTimer();
  }
  
  // Update slots available
  if (payload.slots_available != null && placeBetBtn) {
    const slotsEmpty = payload.slots_available > 0;
    placeBetBtn.disabled = !slotsEmpty || displayRemainingSeconds <= 15;
  }
  
  // Disable betting if closed
  if (payload.is_betting_closed) {
    disableBettingUI();
  }
  
  // Update round info
  if (payload.round_code && roundIdSpan) {
    roundIdSpan.textContent = payload.round_code;
  }
});

// ✅ LISTEN FOR BET ERRORS
socket.on("bet_error", payload => {
  console.error("[bet_error]", payload.message || "Unknown error");
  setStatus(payload.message || "Bet error", "error");
});

// ================= EVENT LISTENERS =================

// Number chip selection
numChips.forEach(chip => {
  chip.addEventListener("click", () => {
    if (!gameFinished && !chip.disabled) {
      setSelectedNumber(parseInt(chip.dataset.number, 10));
    }
  });
});

// Place bet button
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

  console.log("[place_bet] Emitting to backend:", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber
  });

  socket.emit("place_bet", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber,
  });
});

// Popup buttons
popupHomeBtn?.addEventListener("click", () => {
  window.location.href = HOME_URL;
});

popupLobbyBtn?.addEventListener("click", () => {
  window.history.back();
});

// ================= INITIALIZATION =================
console.log(`[init] Game initialized - user=${USER_ID} | username=${USERNAME} | game=${GAME} | bet_amount=${FIXED_BET_AMOUNT}`);

fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
