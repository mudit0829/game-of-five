// ================== Roulette Wheel (Backend-driven, multi-bet, snake_case API + socket events) ==================

const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const TOTAL_SLOTS = WHEEL_ORDER.length;
const DEG_PER_SLOT = 360 / TOTAL_SLOTS;

const POINTER_OFFSET_DEG = 0;
const SPIN_DURATION_MS = 4200;
const EXTRA_FULL_SPINS = 5;

// ================= STATE =================
let walletBalance = 0;
let selectedNumbers = new Set();
let isSpinning = false;
let lastRotationDeg = 0;

let wheelRotateEl = null;

let currentRoundCode = null;
let currentTableNumber = null;
let currentPhase = "betting_open";
let currentPlayerCount = 0;
let currentTotalBets = 0;
let maxBetsPerUser = 19;
let lastDeclaredResult = null;

let lockedNumbers = new Set();
let currentPlayers = [];

let freeSpinFrame = null;
let freeSpinActive = false;

// ================= AUDIO + VIBRATION =================
const BG_AUDIO_SRC = "/static/audio/roulette.mp3";
const RESULT_AUDIO_SRC = "/static/audio/result.mp3";

const spinLoopAudio = new Audio(BG_AUDIO_SRC);
spinLoopAudio.loop = true;
spinLoopAudio.preload = "auto";
spinLoopAudio.volume = 0.75;

const resultAudio = new Audio(RESULT_AUDIO_SRC);
resultAudio.loop = false;
resultAudio.preload = "auto";
resultAudio.volume = 1.0;

let audioUnlocked = false;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    spinLoopAudio.play().then(() => {
      spinLoopAudio.pause();
      spinLoopAudio.currentTime = 0;
    }).catch(() => {});
  } catch (e) {}

  try {
    resultAudio.play().then(() => {
      resultAudio.pause();
      resultAudio.currentTime = 0;
    }).catch(() => {});
  } catch (e) {}
}

["pointerdown", "touchstart", "mousedown", "keydown"].forEach((evt) => {
  window.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
});

function startSpinLoop() {
  if (!audioUnlocked) return;
  try {
    if (spinLoopAudio.paused) {
      spinLoopAudio.currentTime = 0;
      spinLoopAudio.play().catch(() => {});
    }
  } catch (e) {}
}

function stopSpinLoop() {
  try {
    if (!spinLoopAudio.paused) spinLoopAudio.pause();
    spinLoopAudio.currentTime = 0;
  } catch (e) {}
}

function playResultOnce() {
  if (!audioUnlocked) return;
  try {
    resultAudio.currentTime = 0;
    resultAudio.play().catch(() => {});
  } catch (e) {}
}

function vibrateOnResult() {
  try {
    if ("vibrate" in navigator) navigator.vibrate([120, 60, 120]);
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSpinLoop();
    stopFreeSpin();
  }
});

// ================= DOM =================
const wheelImg = document.getElementById("rouletteWheel");
const spinBtn = document.getElementById("spinBtn");
const placeBetBtn = document.getElementById("placeBetBtn");

const walletBalanceSpan = document.getElementById("walletBalance");
const headerUserBetsCount = document.getElementById("userBetsCountText");
const headerTotalPlayers = document.getElementById("totalPlayersText");
const headerUsername = document.getElementById("usernameText");
const gameIdTextEl = document.getElementById("gameIdText");

const numbersGrid = document.getElementById("numbersGrid");
const myBetsRow = document.getElementById("myBetsRow");
const statusEl = document.getElementById("statusMessage");
const lastResultEl = document.getElementById("lastResult");
const timerTextEl = document.getElementById("timerText");

const USER_ID = window.__USER_ID__;
const USERNAME = window.__USERNAME__ || "";
const GAMETYPE = window.__GAMETYPE__ || "roulette";

const preferredRoundCode = new URLSearchParams(window.location.search).get("table");

console.log("[Roulette] JS loaded", { USER_ID, USERNAME, GAMETYPE, preferredRoundCode });

window.addEventListener("error", (e) => {
  console.error("[Roulette] window.error:", e.message, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[Roulette] unhandledrejection:", e.reason);
});

if (headerUsername) headerUsername.textContent = USERNAME || "Player";

// ================= UI HELPERS =================
function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWalletUI() {
  if (walletBalanceSpan) walletBalanceSpan.textContent = String(Math.floor(walletBalance));
}

function formatMMSS(totalSeconds) {
  const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function getMyBetNumbers() {
  return currentPlayers
    .filter((p) => String(p.user_id) === String(USER_ID))
    .map((p) => parseInt(p.number, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

function getUniquePlayerCountFromPlayers(players) {
  return new Set(
    (players || [])
      .map((p) => p?.user_id)
      .filter((v) => v !== null && v !== undefined)
      .map(String)
  ).size;
}

function clearSelectedNumbers() {
  selectedNumbers.clear();
  document.querySelectorAll(".num-chip").forEach((chip) => {
    chip.classList.remove("selected");
  });
}

function toggleSelectedNumber(n) {
  if (selectedNumbers.has(n)) {
    selectedNumbers.delete(n);
  } else {
    selectedNumbers.add(n);
  }

  document.querySelectorAll(".num-chip").forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", selectedNumbers.has(v));
  });
}

function applyLockedStateToChips() {
  const myBetNumbers = new Set(getMyBetNumbers());

  document.querySelectorAll(".num-chip").forEach((chip) => {
    const n = parseInt(chip.dataset.number, 10);
    const isLocked = lockedNumbers.has(n);
    const alreadyMine = myBetNumbers.has(n);

    chip.classList.toggle("bet-locked", isLocked);
    chip.disabled = isSpinning || alreadyMine;

    if (isLocked && !alreadyMine && selectedNumbers.has(n)) {
      selectedNumbers.delete(n);
      chip.classList.remove("selected");
    }
  });
}

function updateHeaderPlayersCount() {
  if (!headerTotalPlayers) return;
  headerTotalPlayers.textContent = `${currentPlayerCount} PLAYERS`;
}

function updateMyBetsUIFromPlayers() {
  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  const myNums = getMyBetNumbers();

  if (headerUserBetsCount) headerUserBetsCount.textContent = String(myNums.length);

  if (myNums.length === 0) {
    const span = document.createElement("span");
    span.className = "none-label";
    span.textContent = "none";
    myBetsRow.appendChild(span);
    return;
  }

  myNums.forEach((n) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = String(n);
    myBetsRow.appendChild(chip);
  });
}

function showRoundResultPopup(resultNumber) {
  const myBetNumbers = getMyBetNumbers();
  const isWin = myBetNumbers.includes(Number(resultNumber));

  const title = isWin ? "Congratulations!" : "Hard Luck!";
  const text = isWin
    ? `Winning number is ${resultNumber}. You won this round.`
    : `Winning number is ${resultNumber}. Better luck next round.`;

  if (window.Swal && typeof window.Swal.fire === "function") {
    window.Swal.fire({
      title,
      text,
      icon: isWin ? "success" : "error",
      confirmButtonText: "OK"
    });
  } else {
    alert(`${title}\n${text}`);
  }
}

function refreshControls(socketConnected) {
  const myBetCount = getMyBetNumbers().length;
  const canSelectMore = (myBetCount + selectedNumbers.size) <= maxBetsPerUser;
  const bettingOpen = currentPhase === "betting_open";

  if (placeBetBtn) {
    placeBetBtn.disabled =
      isSpinning ||
      !socketConnected ||
      !bettingOpen ||
      selectedNumbers.size === 0 ||
      !canSelectMore;
  }

  if (spinBtn) {
    spinBtn.disabled = true;
    spinBtn.title = "Wheel spins automatically in the last 15 seconds";
  }
}

function createNumberGrid() {
  if (!numbersGrid) return;

  numbersGrid.innerHTML = "";

  for (let n = 0; n <= 36; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "num-chip";
    btn.textContent = String(n);
    btn.dataset.number = String(n);

    btn.addEventListener("click", () => {
      unlockAudioOnce();
      if (isSpinning) return;

      const myBetNumbers = new Set(getMyBetNumbers());

      if (myBetNumbers.has(n)) {
        setStatus("You already placed this number in this round.", "error");
        refreshControls(socketConnected);
        return;
      }

      if (lockedNumbers.has(n)) {
        setStatus("This number is already bet by another player.", "error");
        refreshControls(socketConnected);
        return;
      }

      const myCurrentCount = getMyBetNumbers().length;
      if (!selectedNumbers.has(n) && (myCurrentCount + selectedNumbers.size) >= maxBetsPerUser) {
        setStatus(`Maximum ${maxBetsPerUser} bets allowed in this round.`, "error");
        refreshControls(socketConnected);
        return;
      }

      toggleSelectedNumber(n);
      setStatus("");
      refreshControls(socketConnected);
    });

    numbersGrid.appendChild(btn);
  }
}

// ================= WHEEL WRAPPER =================
function injectWheelStylesOnce() {
  if (document.getElementById("wheelHiddenLabelStyles")) return;
  const style = document.createElement("style");
  style.id = "wheelHiddenLabelStyles";
  style.textContent = `
    #wheelRotate{ position:relative; display:inline-block; will-change:transform; transform:rotate(0deg); transform-origin:50% 50%; }
    #wheelRotate img{ display:block; width:100%; height:auto; transform:none !important; }
    #wheelLabels{ position:absolute; inset:0; pointer-events:none; }
    .wheel-label{ position:absolute; left:50%; top:50%; transform-origin:0 0; font-size:10px; font-weight:700; opacity:0; user-select:none; white-space:nowrap; }
  `;
  document.head.appendChild(style);
}

function setupWheelWrapperAndLabels() {
  if (!wheelImg) {
    console.error("Missing #rouletteWheel image element.");
    setStatus("Wheel image missing (#rouletteWheel).", "error");
    return;
  }

  injectWheelStylesOnce();

  if (document.getElementById("wheelRotate")) {
    wheelRotateEl = document.getElementById("wheelRotate");
    return;
  }

  const parent = wheelImg.parentElement;
  if (!parent) return;

  const wrap = document.createElement("div");
  wrap.id = "wheelRotate";
  parent.insertBefore(wrap, wheelImg);
  wrap.appendChild(wheelImg);

  const labels = document.createElement("div");
  labels.id = "wheelLabels";
  wrap.appendChild(labels);

  wheelRotateEl = wrap;
}

// ================= ROTATION =================
function mod(n, m) {
  return ((n % m) + m) % m;
}

function getRotationDeg(el) {
  const st = window.getComputedStyle(el);
  const tr = st.transform || "none";
  if (tr === "none") return 0;

  const m = tr.match(/^matrix\((.+)\)$/);
  if (!m) return 0;

  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  const [a, b] = parts;
  let angle = Math.atan2(b, a) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

function numberAtPointer(rotationDeg) {
  const corrected = rotationDeg + POINTER_OFFSET_DEG;
  const idx = mod(Math.round((-corrected) / DEG_PER_SLOT), TOTAL_SLOTS);
  return WHEEL_ORDER[idx];
}

function stopFreeSpin() {
  if (freeSpinFrame) {
    cancelAnimationFrame(freeSpinFrame);
    freeSpinFrame = null;
  }
  freeSpinActive = false;
}

function startFreeSpin() {
  if (!wheelRotateEl || freeSpinActive) return;

  stopFreeSpin();
  freeSpinActive = true;

  const step = () => {
    if (!freeSpinActive) return;
    lastRotationDeg += 8;
    wheelRotateEl.style.transition = "none";
    wheelRotateEl.style.transform = `rotate(${lastRotationDeg}deg)`;
    freeSpinFrame = requestAnimationFrame(step);
  };

  freeSpinFrame = requestAnimationFrame(step);
}

function spinToServerResult(targetNumber) {
  if (!wheelRotateEl) return;

  stopFreeSpin();

  const liveDeg = getRotationDeg(wheelRotateEl);
  lastRotationDeg = liveDeg;

  const idx = WHEEL_ORDER.indexOf(targetNumber);
  if (idx === -1) {
    console.error("Target not found in wheel order:", targetNumber);
    return;
  }

  const targetAngle = -(idx * DEG_PER_SLOT) - POINTER_OFFSET_DEG;
  const baseNormalized = ((liveDeg % 360) + 360) % 360;
  const targetNormalized = ((targetAngle % 360) + 360) % 360;
  const forwardDelta = (360 + targetNormalized - baseNormalized) % 360;
  const finalRotation = liveDeg + (EXTRA_FULL_SPINS * 360) + forwardDelta;

  lastRotationDeg = finalRotation;
  wheelRotateEl.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.15, 0.8, 0.25, 1)`;
  wheelRotateEl.style.transform = `rotate(${finalRotation}deg)`;
}

// ================= HTTP =================
async function fetchBalance() {
  try {
    const res = await fetch("/api/balance", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.balance === "number") {
      walletBalance = data.balance;
      updateWalletUI();
    }
  } catch (e) {
    console.warn("[Roulette] fetchBalance failed:", e);
  }
}

function chooseTable(tables) {
  if (!Array.isArray(tables) || tables.length === 0) return null;

  if (preferredRoundCode) {
    const exact = tables.find((t) => t && t.round_code === preferredRoundCode);
    if (exact) return exact;
  }

  return (
    tables.find((t) => t && t.is_started && !t.is_finished && !t.is_betting_closed) ||
    tables.find((t) => t && t.is_started && !t.is_finished) ||
    tables[0]
  );
}

async function fetchRouletteTableState() {
  try {
    const res = await fetch(`/api/tables/${encodeURIComponent(GAMETYPE)}`, { cache: "no-store" });
    const ct = res.headers.get("content-type") || "";

    if (!res.ok) {
      console.warn("[Roulette] /api/tables status:", res.status);
      return;
    }

    if (!ct.includes("application/json")) {
      setStatus("Session expired. Please login again.", "error");
      return;
    }

    const data = await res.json();
    const t = chooseTable(data.tables);
    if (!t) return;

    const previousRoundCode = currentRoundCode;

    currentRoundCode = t.round_code || currentRoundCode;
    currentTableNumber = t.table_number ?? currentTableNumber;
    currentPhase = t.phase || "betting_open";
    currentPlayerCount = Number.isFinite(t.player_count) ? t.player_count : (Number.isFinite(t.players) ? t.players : 0);
    currentTotalBets = Number.isFinite(t.total_bets) ? t.total_bets : 0;
    maxBetsPerUser = Number.isFinite(t.max_bets_per_user) ? t.max_bets_per_user : 19;

    if (gameIdTextEl) {
      gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";
    }

    currentPlayers = Array.isArray(t.bets) ? t.bets : [];

    if (!currentPlayerCount) {
      currentPlayerCount = getUniquePlayerCountFromPlayers(currentPlayers);
    }

    lockedNumbers = new Set(
      currentPlayers.map((p) => parseInt(p.number, 10)).filter((n) => Number.isFinite(n))
    );

    if (previousRoundCode && currentRoundCode !== previousRoundCode) {
      clearSelectedNumbers();
      lastDeclaredResult = null;
      stopSpinLoop();
      stopFreeSpin();
      isSpinning = false;
      if (lastResultEl) lastResultEl.textContent = "Result: --";
    }

    updateHeaderPlayersCount();
    updateMyBetsUIFromPlayers();
    applyLockedStateToChips();

    if (typeof t.time_remaining === "number" && timerTextEl) {
      timerTextEl.textContent = formatMMSS(t.time_remaining);
    }

    if (currentPhase === "betting_closed") {
      setStatus("Betting closed. Wheel will spin automatically.", "ok");
    } else if (currentPhase === "spinning") {
      setStatus("Wheel spinning...", "ok");
    } else if (currentPhase === "result" && lastDeclaredResult !== null) {
      setStatus(`Result declared: ${lastDeclaredResult}`, "ok");
    } else if (currentPhase === "betting_open") {
      setStatus("");
    }

    refreshControls(socketConnected);
  } catch (e) {
    console.error("[Roulette] fetchRouletteTableState failed:", e);
  }
}

// ================= SOCKET =================
let socket = null;
let socketConnected = false;

function initSocket() {
  if (typeof io !== "function") {
    setStatus("Socket client not loaded (CDN failed).", "error");
    return;
  }

  socket = io(window.location.origin, {
    transports: ["polling"],
    upgrade: false
  });

  socket.on("connect", () => {
    socketConnected = true;
    console.log("[Roulette] socket connected:", socket.id);
    setStatus("");

    socket.emit("join_game", { game_type: GAMETYPE, user_id: USER_ID });
    refreshControls(true);
  });

  socket.on("connect_error", (err) => {
    socketConnected = false;
    console.error("[Roulette] connect_error:", err);
    setStatus(`Socket error: ${err?.message || err}`, "error");
    refreshControls(false);
  });

  socket.on("disconnect", (reason) => {
    socketConnected = false;
    console.warn("[Roulette] socket disconnected:", reason);
    setStatus("Socket disconnected. Refresh page.", "error");
    refreshControls(false);
  });

  socket.on("bet_error", (data) => {
    setStatus(data?.message || "Bet rejected.", "error");
    fetchBalance();
    fetchRouletteTableState();
  });

  socket.on("bet_success", (data) => {
    if (typeof data?.new_balance === "number") {
      walletBalance = data.new_balance;
      updateWalletUI();
    }

    if (data?.round_code) currentRoundCode = data.round_code;
    if (gameIdTextEl) {
      gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";
    }

    setStatus(data?.message || "Bet placed.", "ok");

    if (Array.isArray(data?.players)) {
      currentPlayers = data.players;
      currentPlayerCount = Number.isFinite(data?.player_count)
        ? data.player_count
        : getUniquePlayerCountFromPlayers(currentPlayers);
      currentTotalBets = Number.isFinite(data?.total_bets)
        ? data.total_bets
        : currentPlayers.length;

      if (data?.phase) currentPhase = data.phase;

      lockedNumbers = new Set(
        currentPlayers.map((p) => parseInt(p.number, 10)).filter((n) => Number.isFinite(n))
      );

      updateHeaderPlayersCount();
      updateMyBetsUIFromPlayers();
      applyLockedStateToChips();
    } else {
      fetchRouletteTableState();
    }

    refreshControls(socketConnected);
  });

  socket.on("update_table", (payload) => {
    if (!payload || payload.game_type !== GAMETYPE) return;

    if (payload.round_code) currentRoundCode = payload.round_code;
    if (gameIdTextEl) {
      gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";
    }

    if (Array.isArray(payload.players)) {
      currentPlayers = payload.players;
      currentPlayerCount = Number.isFinite(payload?.player_count)
        ? payload.player_count
        : getUniquePlayerCountFromPlayers(currentPlayers);
      currentTotalBets = Number.isFinite(payload?.total_bets)
        ? payload.total_bets
        : currentPlayers.length;

      lockedNumbers = new Set(
        currentPlayers.map((p) => parseInt(p.number, 10)).filter((n) => Number.isFinite(n))
      );

      updateHeaderPlayersCount();
      updateMyBetsUIFromPlayers();
      applyLockedStateToChips();
    }

    if (payload?.phase) currentPhase = payload.phase;

    if (typeof payload.time_remaining === "number" && timerTextEl) {
      timerTextEl.textContent = formatMMSS(payload.time_remaining);
    }

    refreshControls(socketConnected);
  });

  socket.on("spin_started", (payload) => {
    if (!payload || payload.game_type !== GAMETYPE) return;
    if (payload.round_code !== currentRoundCode) return;

    currentPhase = payload.phase || "spinning";
    isSpinning = true;
    setStatus("Wheel spinning...", "ok");
    startSpinLoop();
    startFreeSpin();
    applyLockedStateToChips();
    refreshControls(socketConnected);
  });

  socket.on("result_declared", (payload) => {
    if (!payload || payload.game_type !== GAMETYPE) return;
    if (payload.round_code !== currentRoundCode) return;
    if (!Number.isFinite(payload.result)) return;

    currentPhase = payload.phase || "result";
    lastDeclaredResult = payload.result;
    isSpinning = true;

    spinToServerResult(payload.result);

    window.setTimeout(() => {
      stopSpinLoop();
      playResultOnce();
      vibrateOnResult();

      const finalDeg = wheelRotateEl ? getRotationDeg(wheelRotateEl) : 0;
      const shownNumber = numberAtPointer(finalDeg);

      if (lastResultEl) {
        lastResultEl.textContent = `Result: ${Number.isFinite(shownNumber) ? shownNumber : payload.result}`;
      }

      isSpinning = false;
      applyLockedStateToChips();
      refreshControls(socketConnected);
    }, SPIN_DURATION_MS + 80);
  });

  socket.on("round_finished", (payload) => {
    if (!payload || payload.game_type !== GAMETYPE) return;
    if (payload.round_code !== currentRoundCode) return;

    currentPhase = "finished";
    stopSpinLoop();
    stopFreeSpin();
    isSpinning = false;

    if (Number.isFinite(payload.result)) {
      lastDeclaredResult = payload.result;
      if (lastResultEl) lastResultEl.textContent = `Result: ${payload.result}`;
      playResultOnce();
      vibrateOnResult();
      showRoundResultPopup(payload.result);
    }

    clearSelectedNumbers();
    applyLockedStateToChips();
    refreshControls(socketConnected);

    fetchBalance();
    fetchRouletteTableState();
  });
}

// ================= ACTIONS =================
function handlePlaceBet() {
  unlockAudioOnce();
  if (isSpinning) return;

  if (!USER_ID) {
    setStatus("Login missing (user id is null). Logout + login again.", "error");
    return;
  }

  if (currentPhase !== "betting_open") {
    setStatus("Betting is closed for this round.", "error");
    return;
  }

  const numbers = Array.from(selectedNumbers).sort((a, b) => a - b);
  if (numbers.length === 0) {
    setStatus("Select at least one number first.", "error");
    return;
  }

  const myBetCount = getMyBetNumbers().length;
  if ((myBetCount + numbers.length) > maxBetsPerUser) {
    setStatus(`Maximum ${maxBetsPerUser} bets allowed in this round.`, "error");
    return;
  }

  if (!socket || !socketConnected) {
    setStatus("Socket not connected yet. Wait 2 seconds or refresh.", "error");
    return;
  }

  socket.emit("place_bet", {
    game_type: GAMETYPE,
    user_id: USER_ID,
    username: USERNAME,
    numbers,
    round_code: currentRoundCode
  });

  clearSelectedNumbers();
  refreshControls(socketConnected);
}

function handleSpin() {
  setStatus("Wheel spins automatically in the last 15 seconds.", "ok");
}

// ================= INIT =================
setupWheelWrapperAndLabels();
createNumberGrid();

clearSelectedNumbers();
setStatus("");

fetchBalance();
updateWalletUI();

fetchRouletteTableState();
setInterval(fetchRouletteTableState, 1500);
setInterval(fetchBalance, 5000);

initSocket();

if (placeBetBtn) placeBetBtn.addEventListener("click", handlePlaceBet);
if (spinBtn) {
  spinBtn.addEventListener("click", handleSpin);
  spinBtn.disabled = true;
}
