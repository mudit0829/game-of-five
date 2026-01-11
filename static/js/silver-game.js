// ================= BASIC SETUP (DB USER) =================
const GAME = window.GAME_TYPE || "silver";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 10;
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;
const USER_ID = window.GAME_USER_ID || null;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ================= DOM REFERENCES =================
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

function updateMyBets(bets) {
  const myBets = (bets || []).filter(b => String(b.user_id) === String(USER_ID));
  if (myBets.length > 0) userHasBet = true;
  if (userBetCountLabel) userBetCountLabel.textContent = myBets.length;
  if (!myBetsRow) return;
  myBetsRow.innerHTML = myBets.length === 0 
    ? '<span style="color:#6b7280;font-size:11px;">none</span>'
    : myBets.map(b => `<span class="my-bet-chip">${b.number}</span>`).join(", ");
}

function updatePadsFromBets(bets) {
  const list = (bets || []).slice(0, 6);
  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");
    if (i < list.length) {
      pad.dataset.number = String(list[i].number);
      if (numSpan) numSpan.textContent = list[i].number;
      if (userSpan) userSpan.textContent = list[i].username;
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
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

function showEndPopup(outcomeInfo) {
  if (!popupEl) return;
  const { outcome } = outcomeInfo;
  popupTitleEl.textContent = outcome === "win" ? "Congratulations!" : outcome === "lose" ? "Hard Luck!" : "Game Finished";
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

  const targetPad = findPadForNumber(winningNumber);
  if (!targetPad) {
    console.warn("[frog] No pad found for", winningNumber);
    jumpStarted = false;
    return;
  }

  const index = pads.indexOf(targetPad);
  const direction = getJumpDirectionByPadIndex(index);
  const src = FROG_VIDEOS[direction] || FROG_VIDEOS.front;

  console.log(`[frog] JUMP → ${direction} to ${winningNumber} (pad ${index}) at ${displayRemainingSeconds}s left`);

  frogIdleVideo.pause();
  frogIdleVideo.style.display = "none";
  frogVideoSource.src = src;
  frogJumpVideo.load();
  frogJumpVideo.style.display = "block";
  frogJumpVideo.currentTime = 0;

  frogJumpVideo.onloadeddata = () => {
    console.log("[frog] Video ready → playing");
    frogJumpVideo.play().catch(e => console.error("[frog] Play error:", e));
  };

  frogJumpVideo.onended = () => {
    console.log("[frog] Jump finished");
    frogJumpVideo.style.display = "none";
    frogIdleVideo.style.display = "block";
    frogIdleVideo.play();
    targetPad.classList.add("win");
    gameFinished = true;
    if (pendingOutcomeInfo) showEndPopup(pendingOutcomeInfo);
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

      // Try normal trigger at 10s
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
    updateGameUI(table);
  } catch (err) {
    console.error("fetch error", err);
  }
}

function updateGameUI(table) {
  roundIdSpan.textContent = table.round_code || "-";
  playerCountSpan.textContent = table.players || 0;

  // Always trust server timer (prevents local drift)
  if (!gameFinished) {
    const oldSec = displayRemainingSeconds;
    displayRemainingSeconds = table.time_remaining || 0;
    if (oldSec !== displayRemainingSeconds) renderTimer();
  }

  updatePadsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (placeBetBtn && !gameFinished) {
    placeBetBtn.disabled = displayRemainingSeconds <= 15 || 
      (table.max_players && table.players >= table.max_players);
  }

  // Slots full → popup for non-betters
  const isFull = table.is_full || (table.max_players && table.players >= table.max_players);
  if (!gameFinished && !userHasBet && isFull) {
    disableBettingUI();
    clearInterval(tablePollInterval);
    tablePollInterval = null;
    showSlotsFullPopup();
    return;
  }

  // Result arrived
  if (table.result != null && table.result !== lastResultShown) {
    console.log(`[result] Received ${table.result} at ${displayRemainingSeconds}s left`);
    lastResultShown = table.result;
    storedResult = table.result;
    ensurePadForWinningNumber(table.result);
    lockedWinningPad = findPadForNumber(table.result);
    pendingOutcomeInfo = determineUserOutcome(table);

    if (!userHasBet) return showSlotsFullPopup();

    // Jump if not started yet (even at low seconds)
    if (!jumpStarted && displayRemainingSeconds <= 12) {  // ← increased window to 12s
      console.log("[force] Late result → starting jump now");
      hopFrogToWinningNumber(storedResult);
    }
  }

  // New round reset
  if (table.result === null && lastResultShown !== null) {
    console.log("[reset] New round detected");
    jumpStarted = false;
    storedResult = null;
    lastResultShown = null;
    gameFinished = false;
    userHasBet = false;
    pendingOutcomeInfo = null;
    lockedWinningPad = null;
    pads.forEach(p => p.classList.remove("win"));
    frogJumpVideo.pause();
    frogJumpVideo.style.display = "none";
    frogJumpVideo.currentTime = 0;
    frogIdleVideo.style.display = "block";
    frogIdleVideo.play();
    if (popupEl) popupEl.style.display = "none";
  }
}

function startPolling() {
  fetchTableData();
  tablePollInterval = setInterval(fetchTableData, 1500); // faster polling = catch result earlier
}

// ================= SOCKET & EVENTS =================
const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const { balance } = await res.json();
    if (typeof balance === "number") updateWallet(balance);
  } catch (e) {}
}

socket.on("connect", () => {
  socket.emit("join_game", { game_type: GAME, user_id: USER_ID });
  fetchBalance();
  fetchTableData();
});

socket.on("bet_success", payload => {
  if (gameFinished) return;
  userHasBet = true;
  setStatus("Bet placed", "ok");
  if (payload.new_balance != null) updateWallet(payload.new_balance);
  fetchTableData();
});

socket.on("bet_error", payload => setStatus(payload.message || "Bet error", "error"));

numChips.forEach(chip => {
  chip.addEventListener("click", () => {
    if (!gameFinished) setSelectedNumber(parseInt(chip.dataset.number, 10));
  });
});

placeBetBtn?.addEventListener("click", () => {
  if (gameFinished) return setStatus("Game finished", "error");
  if (!currentTable) return setStatus("Game not ready", "error");
  if (walletBalance < FIXED_BET_AMOUNT) return setStatus("Insufficient balance", "error");
  if (selectedNumber == null) return setStatus("Select number", "error");

  socket.emit("place_bet", {
    game_type: GAME,
    user_id: USER_ID,
    username: USERNAME,
    number: selectedNumber,
  });
});

popupHomeBtn?.addEventListener("click", () => window.location.href = HOME_URL);
popupLobbyBtn?.addEventListener("click", () => window.history.back());

// ================= START =================
fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
console.log(`[init] user=${USER_ID} | game=${GAME} | bet=${FIXED_BET_AMOUNT}`);
