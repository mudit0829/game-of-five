// ================== Roulette Wheel (Backend-aligned: snake_case API + socket events) ==================

const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
];

const TOTAL_SLOTS = WHEEL_ORDER.length;
const DEG_PER_SLOT = 360 / TOTAL_SLOTS;

const POINTER_OFFSET_DEG = 0;
const SPIN_DURATION_MS = 4200;
const EXTRA_FULL_SPINS = 5;

let walletBalance = 0;
let selectedNumber = null;
let isSpinning = false;
let lastRotationDeg = 0;

let wheelRotateEl = null;

let currentRoundCode = null;
let currentTableNumber = null;

let lockedNumbers = new Set();
let currentPlayers = [];

// ================= AUDIO + VIBRATION (NEW) =================
// Browsers often block audio until user interacts once. [web:392]
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

  // Prime both audio elements (best effort)
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

// Vibrate works only on supported devices/browsers; requires user activation. [web:384]
function vibrateOnResult() {
  try {
    if ("vibrate" in navigator) navigator.vibrate([120, 60, 120]);
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSpinLoop();
});

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

const USER_ID = window.__USER_ID__;          // should be from template
const USERNAME = window.__USERNAME__ || "";  // should be from template
const GAMETYPE = window.__GAMETYPE__ || "roulette";

const preferredRoundCode = new URLSearchParams(window.location.search).get("table"); // your ?table=R...

console.log("[Roulette] JS loaded", { USER_ID, USERNAME, GAMETYPE, preferredRoundCode });

window.addEventListener("error", (e) => {
  console.error("[Roulette] window.error:", e.message, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[Roulette] unhandledrejection:", e.reason);
});

if (headerUsername) headerUsername.textContent = USERNAME || "Player";

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

function setSelectedNumber(n) {
  selectedNumber = n;
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function applyLockedStateToChips() {
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const n = parseInt(chip.dataset.number, 10);
    const isLocked = lockedNumbers.has(n);
    chip.classList.toggle("bet-locked", isLocked);
    chip.disabled = isLocked || isSpinning;
  });

  if (selectedNumber !== null && lockedNumbers.has(selectedNumber)) {
    setSelectedNumber(null);
  }
}

function updateHeaderPlayersCount() {
  if (!headerTotalPlayers) return;
  headerTotalPlayers.textContent = `${currentPlayers.length} PLAYERS`;
}

function updateMyBetsUIFromPlayers() {
  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  const myNums = currentPlayers
    .filter(p => String(p.user_id) === String(USER_ID))
    .map(p => parseInt(p.number, 10))
    .filter(n => Number.isFinite(n))
    .sort((a,b)=>a-b);

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

function refreshControls(socketConnected) {
  if (placeBetBtn) {
    placeBetBtn.disabled =
      isSpinning ||
      !socketConnected ||
      selectedNumber === null ||
      lockedNumbers.has(selectedNumber);
  }

  if (spinBtn) {
    const myBetCount = currentPlayers.filter(p => String(p.user_id) === String(USER_ID)).length;
    spinBtn.disabled = isSpinning || myBetCount === 0;
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
      unlockAudioOnce(); // NEW (helps on mobile)
      if (isSpinning) return;

      if (lockedNumbers.has(n)) {
        setStatus("This number is already bet by another player.", "error");
        setSelectedNumber(null);
        refreshControls(socketConnected);
        return;
      }

      setSelectedNumber(n);
      setStatus("");
      refreshControls(socketConnected);
    });

    numbersGrid.appendChild(btn);
  }
}

// ------------------ Wheel wrapper ------------------
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

// ------------------ Rotation math ------------------
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

function spinToNumber(targetNumber) {
  const idx = WHEEL_ORDER.indexOf(targetNumber);
  if (idx === -1) throw new Error("Target not found in wheel order: " + targetNumber);

  const targetAngle = -(idx * DEG_PER_SLOT) - POINTER_OFFSET_DEG;
  const extra = EXTRA_FULL_SPINS * 360;

  const finalRotation = lastRotationDeg + extra + targetAngle;
  lastRotationDeg = finalRotation;

  wheelRotateEl.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.15, 0.8, 0.25, 1)`;
  wheelRotateEl.style.transform = `rotate(${finalRotation}deg)`;
}

// ------------------ Backend (HTTP) ------------------
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
    const exact = tables.find(t => t && t.round_code === preferredRoundCode);
    if (exact) return exact;
  }

  return (
    tables.find(t => t && t.is_started && !t.is_finished && !t.is_betting_closed) ||
    tables.find(t => t && t.is_started && !t.is_finished) ||
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

    currentRoundCode = t.round_code || currentRoundCode;
    currentTableNumber = t.table_number ?? currentTableNumber;

    if (gameIdTextEl) gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";

    currentPlayers = Array.isArray(t.bets) ? t.bets : [];
    lockedNumbers = new Set(
      currentPlayers.map(p => parseInt(p.number, 10)).filter(n => Number.isFinite(n))
    );

    updateHeaderPlayersCount();
    updateMyBetsUIFromPlayers();
    applyLockedStateToChips();

    if (timerTextEl) timerTextEl.textContent = formatMMSS(t.time_remaining);
    refreshControls(socketConnected);
  } catch (e) {
    console.error("[Roulette] fetchRouletteTableState failed:", e);
  }
}

// ------------------ Socket.IO (backend-aligned names) ------------------
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
    if (gameIdTextEl) gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";

    setStatus(data?.message || "Bet placed.", "ok");

    if (Array.isArray(data?.players)) {
      currentPlayers = data.players;
      lockedNumbers = new Set(
        currentPlayers.map(p => parseInt(p.number, 10)).filter(n => Number.isFinite(n))
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
    if (gameIdTextEl) gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";

    if (Array.isArray(payload.players)) {
      currentPlayers = payload.players;
      lockedNumbers = new Set(
        currentPlayers.map(p => parseInt(p.number, 10)).filter(n => Number.isFinite(n))
      );
      updateHeaderPlayersCount();
      updateMyBetsUIFromPlayers();
      applyLockedStateToChips();
    }

    if (typeof payload.time_remaining === "number" && timerTextEl) {
      timerTextEl.textContent = formatMMSS(payload.time_remaining);
    }

    refreshControls(socketConnected);
  });
}

// ------------------ Actions ------------------
function handlePlaceBet() {
  unlockAudioOnce(); // NEW
  if (isSpinning) return;

  if (!USER_ID) {
    setStatus("Login missing (user id is null). Logout + login again.", "error");
    return;
  }

  if (selectedNumber === null) {
    setStatus("Select a number first.", "error");
    return;
  }

  if (lockedNumbers.has(selectedNumber)) {
    setStatus("This number is already bet by another player.", "error");
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
    number: selectedNumber,
    round_code: currentRoundCode
  });

  setSelectedNumber(null);
  refreshControls(socketConnected);
}

function handleSpin() {
  unlockAudioOnce(); // NEW
  if (isSpinning) return;
  if (!wheelRotateEl) {
    setStatus("Wheel not ready.", "error");
    return;
  }

  const myBetCount = currentPlayers.filter(p => String(p.user_id) === String(USER_ID)).length;
  if (myBetCount === 0) {
    setStatus("Place at least one bet before spinning.", "error");
    return;
  }

  const targetNumber = WHEEL_ORDER[Math.floor(Math.random() * TOTAL_SLOTS)];

  isSpinning = true;
  setStatus("Spinning...", "ok");
  applyLockedStateToChips();
  refreshControls(socketConnected);

  // NEW: start roulette loop while spinning
  startSpinLoop();

  try {
    spinToNumber(targetNumber);
  } catch (e) {
    console.error(e);
    isSpinning = false;
    stopSpinLoop(); // NEW
    setStatus("Spin failed. Check console.", "error");
    applyLockedStateToChips();
    refreshControls(socketConnected);
    return;
  }

  window.setTimeout(() => {
    const finalDeg = getRotationDeg(wheelRotateEl);
    const shownNumber = numberAtPointer(finalDeg);

    // NEW: stop loop, play result sound, vibrate
    stopSpinLoop();
    playResultOnce();
    vibrateOnResult();

    if (lastResultEl) lastResultEl.textContent = `Result: ${shownNumber}`;

    isSpinning = false;
    setStatus("");
    applyLockedStateToChips();
    refreshControls(socketConnected);
  }, SPIN_DURATION_MS + 80);
}

// ------------------ Init ------------------
setupWheelWrapperAndLabels();
createNumberGrid();

setSelectedNumber(null);
setStatus("");

fetchBalance();
updateWalletUI();

fetchRouletteTableState();
setInterval(fetchRouletteTableState, 1500);
setInterval(fetchBalance, 5000);

initSocket();

if (placeBetBtn) placeBetBtn.addEventListener("click", handlePlaceBet);
if (spinBtn) spinBtn.addEventListener("click", handleSpin);
