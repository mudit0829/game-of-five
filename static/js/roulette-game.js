// ================== Roulette Wheel (Angle-Verified Result + SOCKET Multiplayer Locks) ==================

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
const USERNAME = window.__USERNAME__ || "demo";
const GAMETYPE = window.__GAMETYPE__ || "roulette";

// --- Debug helpers (so console is not empty) ---
console.log("[Roulette] JS loaded", { USER_ID, USERNAME, GAMETYPE });

window.addEventListener("error", (e) => {
  console.error("[Roulette] window.error:", e.message, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[Roulette] unhandledrejection:", e.reason);
});

if (headerUsername) headerUsername.textContent = USERNAME || "demo";

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
    .filter(p => String(p.userid) === String(USER_ID))
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
    const myBetCount = currentPlayers.filter(p => String(p.userid) === String(USER_ID)).length;
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
      if (isSpinning) return;

      if (lockedNumbers.has(n)) {
        setStatus("This number is already bet by another player.", "error");
        setSelectedNumber(null);
        return;
      }

      setSelectedNumber(n);
      setStatus("");
    });

    numbersGrid.appendChild(btn);
  }
}

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

function mod(n, m) {
  return ((n % m) + m) % m;
}

function getRotationDeg(el) {
  const st = window.getComputedStyle(el);
  const tr = st.transform || "none";
  if (tr === "none") return 0;

  // FIXED: this must match "matrix(...)" (no double backslashes)
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

// ---- HTTP state fetch (your backend has /api/tables/<gametype>) ----
async function fetchRouletteTableState() {
  try {
    const res = await fetch(`/api/tables/${encodeURIComponent(GAMETYPE)}`);
    if (!res.ok) {
      console.warn("[Roulette] /api/tables not ok:", res.status);
      return;
    }

    const data = await res.json();
    const tables = Array.isArray(data.tables) ? data.tables : [];
    const t =
      tables.find(x => x && x.isstarted && !x.isfinished && !x.isbettingclosed) ||
      tables.find(x => x && x.isstarted && !x.isfinished) ||
      tables[0];

    if (!t) return;

    currentRoundCode = t.roundcode || currentRoundCode;
    currentTableNumber = t.tablenumber ?? currentTableNumber;

    // SHOW GAME ID
    if (gameIdTextEl) gameIdTextEl.textContent = currentRoundCode ? String(currentRoundCode) : "--";

    currentPlayers = Array.isArray(t.bets) ? t.bets : [];
    lockedNumbers = new Set(
      currentPlayers
        .map(p => parseInt(p.number, 10))
        .filter(n => Number.isFinite(n))
    );

    updateHeaderPlayersCount();
    updateMyBetsUIFromPlayers();
    applyLockedStateToChips();

    if (timerTextEl) timerTextEl.textContent = formatMMSS(t.timeremaining);
  } catch (e) {
    console.error("[Roulette] fetchRouletteTableState failed:", e);
  }
}

// ---- Socket.IO ----
let socket = null;
let socketConnected = false;

function initSocket() {
  if (typeof io !== "function") {
    setStatus("Socket client not loaded (CDN failed).", "error");
    return;
  }

  // Force polling + no upgrade (more reliable on many deployments) [web:127]
  socket = io(window.location.origin, {
    transports: ["polling"],
    upgrade: false
  });

  socket.on("connect", () => {
    socketConnected = true;
    console.log("[Roulette] socket connected:", socket.id);
    setStatus("", "");

    socket.emit("joinGame", { gametype: GAMETYPE, userid: USER_ID });
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

  socket.on("betError", (data) => {
    setStatus(data?.message || "Bet rejected.", "error");
    fetchRouletteTableState();
  });

  socket.on("betSuccess", (data) => {
    if (typeof data?.newbalance === "number") {
      walletBalance = data.newbalance;
      updateWalletUI();
    }
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
  });

  socket.on("updateTable", (payload) => {
    if (!payload || payload.gametype !== GAMETYPE) return;

    if (payload.roundcode) currentRoundCode = payload.roundcode;
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

    if (typeof payload.timeremaining === "number" && timerTextEl) {
      timerTextEl.textContent = formatMMSS(payload.timeremaining);
    }
  });
}

function handlePlaceBet() {
  if (isSpinning) return;

  if (!USER_ID) {
    setStatus("You are not logged in (missing user id). Login again.", "error");
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

  socket.emit("placeBet", {
    gametype: GAMETYPE,
    userid: USER_ID,
    username: USERNAME,
    number: selectedNumber,
    roundcode: currentRoundCode
  });

  setSelectedNumber(null);
  refreshControls(socketConnected);
}

function handleSpin() {
  if (isSpinning) return;
  if (!wheelRotateEl) {
    setStatus("Wheel not ready.", "error");
    return;
  }

  const myBetCount = currentPlayers.filter(p => String(p.userid) === String(USER_ID)).length;
  if (myBetCount === 0) {
    setStatus("Place at least one bet before spinning.", "error");
    return;
  }

  const targetNumber = WHEEL_ORDER[Math.floor(Math.random() * TOTAL_SLOTS)];

  isSpinning = true;
  setStatus("Spinning...", "ok");
  applyLockedStateToChips();
  refreshControls(socketConnected);

  spinToNumber(targetNumber);

  window.setTimeout(() => {
    const finalDeg = getRotationDeg(wheelRotateEl);
    const shownNumber = numberAtPointer(finalDeg);

    if (lastResultEl) lastResultEl.textContent = `Result: ${shownNumber}`;

    isSpinning = false;
    setStatus("", "");
    applyLockedStateToChips();
    refreshControls(socketConnected);
  }, SPIN_DURATION_MS + 80);
}

// ------------------ Init ------------------
setupWheelWrapperAndLabels();
createNumberGrid();
updateWalletUI();
setSelectedNumber(null);
setStatus("");

// Pull initial table state (roundcode, timer, locked numbers) from backend [file:104]
fetchRouletteTableState();
setInterval(fetchRouletteTableState, 1500);

initSocket();

if (placeBetBtn) placeBetBtn.addEventListener("click", handlePlaceBet);
if (spinBtn) spinBtn.addEventListener("click", handleSpin);
