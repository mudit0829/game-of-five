// ================== Roulette Wheel (Angle-Verified Result + SOCKET Multiplayer Locks) ==================

const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
];

const TOTAL_SLOTS = WHEEL_ORDER.length;      // 37
const DEG_PER_SLOT = 360 / TOTAL_SLOTS;

const POINTER_OFFSET_DEG = 0;
const SPIN_DURATION_MS = 4200;
const EXTRA_FULL_SPINS = 5;

// UI-only (server enforces its own limits) [file:104]
const FIXED_BET_AMOUNT = 200;

// ------------------ State ------------------
let walletBalance = 10000;
let selectedNumber = null;
let isSpinning = false;
let lastRotationDeg = 0;

let wheelRotateEl = null;

// Current table/round from backend
let currentRoundCode = null;
let currentTableNumber = null;

// Taken numbers by any player in THIS table/round
let lockedNumbers = new Set();

// The latest players list from backend table
let currentPlayers = []; // [{userid, username, number}, ...]

// ------------------ DOM ------------------
const wheelImg = document.getElementById("rouletteWheel");
const spinBtn = document.getElementById("spinBtn");
const placeBetBtn = document.getElementById("placeBetBtn");

const walletBalanceSpan = document.getElementById("walletBalance");

// FIX: your header uses userBetsCountText (not userBetCount)
const headerUserBetsCount = document.getElementById("userBetsCountText");
const headerTotalPlayers = document.getElementById("totalPlayersText");
const headerUsername = document.getElementById("usernameText");

const numbersGrid = document.getElementById("numbersGrid");
const myBetsRow = document.getElementById("myBetsRow");
const statusEl = document.getElementById("statusMessage");
const lastResultEl = document.getElementById("lastResult");
const timerTextEl = document.getElementById("timerText");

// ------------------ User from Flask session ------------------
const USER_ID = window.__USER_ID__;
const USERNAME = window.__USERNAME__ || "demo";
const GAMETYPE = window.__GAMETYPE__ || "roulette";

if (headerUsername) headerUsername.textContent = USERNAME || "demo";

// ------------------ Helpers ------------------
function mod(n, m) {
  return ((n % m) + m) % m;
}

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
    chip.classList.toggle("selected", v === n); // [web:79]
  });
}

function getChipEl(n) {
  return document.querySelector(`.num-chip[data-number="${n}"]`);
}

function applyLockedStateToChips() {
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const n = parseInt(chip.dataset.number, 10);
    const isLocked = lockedNumbers.has(n);

    chip.classList.toggle("bet-locked", isLocked); // [web:79]
    chip.disabled = isLocked || isSpinning; // real lock when taken; also disable while spinning [file:104]
  });

  // If user selected a number that becomes locked, clear selection
  if (selectedNumber !== null && lockedNumbers.has(selectedNumber)) {
    setSelectedNumber(null);
  }
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

function updateHeaderPlayersCount() {
  if (!headerTotalPlayers) return;
  const count = currentPlayers.length;
  headerTotalPlayers.textContent = `${count} PLAYERS`;
}

function refreshControls() {
  if (placeBetBtn) {
    placeBetBtn.disabled =
      isSpinning ||
      selectedNumber === null ||
      lockedNumbers.has(selectedNumber);
  }

  if (spinBtn) {
    // For now, keep spin enabled only if user has at least 1 bet in this table
    const myBetCount = currentPlayers.filter(p => String(p.userid) === String(USER_ID)).length;
    spinBtn.disabled = isSpinning || myBetCount === 0;
  }
}

// ------------------ Build number grid ------------------
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
        refreshControls();
        return;
      }

      setSelectedNumber(n);
      setStatus("");
      refreshControls();
    });

    numbersGrid.appendChild(btn);
  }
}

// ------------------ Wheel wrapper + hidden labels ------------------
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

  function buildLabels() {
    labels.innerHTML = "";
    const rect = wrap.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.43;

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const n = WHEEL_ORDER[i];
      const angle = i * DEG_PER_SLOT;

      const el = document.createElement("div");
      el.className = "wheel-label";
      el.setAttribute("aria-hidden", "true");
      el.dataset.number = String(n);
      el.style.transform = `rotate(${angle}deg) translate(0, ${-radius}px) rotate(${-angle}deg) translate(-50%, -50%)`;
      el.textContent = String(n);
      labels.appendChild(el);
    }
  }

  requestAnimationFrame(buildLabels);
  window.addEventListener("resize", () => requestAnimationFrame(buildLabels), { passive: true });

  wheelRotateEl = wrap;
}

// ------------------ Rotation math ------------------
function getRotationDeg(el) {
  const st = window.getComputedStyle(el);
  const tr = st.transform || "none";
  if (tr === "none") return 0;

  // FIX: correct regex (your pasted one had extra escaping)
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

// ------------------ Backend state (HTTP) ------------------
// Your app has: GET /api/tables/<gametype> returning tables with bets[] [file:104]
async function fetchRouletteTableState() {
  const res = await fetch(`/api/tables/${encodeURIComponent(GAMETYPE)}`);
  if (!res.ok) return;

  const data = await res.json();
  const tables = Array.isArray(data.tables) ? data.tables : [];

  // pick an active started table (closest match to what server uses) [file:104]
  const t =
    tables.find(x => x && x.isstarted && !x.isfinished && !x.isbettingclosed) ||
    tables.find(x => x && x.isstarted && !x.isfinished) ||
    tables[0];

  if (!t) return;

  currentRoundCode = t.roundcode || currentRoundCode;
  currentTableNumber = t.tablenumber ?? currentTableNumber;

  currentPlayers = Array.isArray(t.bets) ? t.bets : [];
  lockedNumbers = new Set(currentPlayers.map(p => parseInt(p.number, 10)).filter(n => Number.isFinite(n)));

  updateHeaderPlayersCount();
  updateMyBetsUIFromPlayers();
  applyLockedStateToChips();
  refreshControls();

  if (timerTextEl) timerTextEl.textContent = formatMMSS(t.timeremaining);
}

// ------------------ Socket.IO ------------------
// Server supports joinGame/placeBet and broadcasts updateTable/betSuccess/betError [file:104]
let socket = null;

function initSocket() {
  if (typeof io !== "function") {
    setStatus("Socket client not loaded. Check /socket.io/socket.io.js", "error");
    return;
  }

  socket = io();

  socket.on("connect", () => {
    socket.emit("joinGame", { gametype: GAMETYPE, userid: USER_ID }); // [file:104]
    setStatus("", "");
  });

  socket.on("betError", (data) => {
    setStatus(data?.message || "Bet rejected.", "error"); // [file:104]
    // refresh state so locked numbers sync
    fetchRouletteTableState();
  });

  socket.on("betSuccess", (data) => {
    if (typeof data?.newbalance === "number") {
      walletBalance = data.newbalance;
      updateWalletUI();
    }
    setStatus(data?.message || "Bet placed.", "ok"); // [file:104]

    // Server may include players list [file:104]
    if (Array.isArray(data?.players)) {
      currentPlayers = data.players;
      lockedNumbers = new Set(currentPlayers.map(p => parseInt(p.number, 10)).filter(n => Number.isFinite(n)));
      updateHeaderPlayersCount();
      updateMyBetsUIFromPlayers();
      applyLockedStateToChips();
      refreshControls();
    } else {
      fetchRouletteTableState();
    }
  });

  socket.on("updateTable", (payload) => {
    if (!payload || payload.gametype !== GAMETYPE) return;

    if (payload.roundcode) currentRoundCode = payload.roundcode;
    if (typeof payload.tablenumber !== "undefined") currentTableNumber = payload.tablenumber;

    if (Array.isArray(payload.players)) {
      currentPlayers = payload.players; // [file:104]
      lockedNumbers = new Set(currentPlayers.map(p => parseInt(p.number, 10)).filter(n => Number.isFinite(n)));
      updateHeaderPlayersCount();
      updateMyBetsUIFromPlayers();
      applyLockedStateToChips();
      refreshControls();
    }

    if (typeof payload.timeremaining === "number" && timerTextEl) {
      timerTextEl.textContent = formatMMSS(payload.timeremaining);
    }
  });
}

// ------------------ Actions ------------------
function handlePlaceBet() {
  if (isSpinning) return;

  if (selectedNumber === null) {
    setStatus("Select a number first.", "error");
    return;
  }

  if (lockedNumbers.has(selectedNumber)) {
    setStatus("This number is already bet by another player.", "error");
    return;
  }

  if (!socket || !socket.connected) {
    setStatus("Socket not connected. Refresh page.", "error");
    return;
  }

  socket.emit("placeBet", {
    gametype: GAMETYPE,
    userid: USER_ID,
    username: USERNAME,
    number: selectedNumber,
    roundcode: currentRoundCode // keep same round if available [file:104]
  });

  setSelectedNumber(null);
  refreshControls();
}

function handleSpin() {
  if (isSpinning) return;
  if (!wheelRotateEl) {
    setStatus("Wheel not ready (missing #rouletteWheel).", "error");
    return;
  }

  // DEMO: spin target is random locally; backend result logic is separate in app.py [file:104]
  const targetNumber = WHEEL_ORDER[Math.floor(Math.random() * TOTAL_SLOTS)];

  isSpinning = true;
  setStatus("Spinning...", "ok");
  applyLockedStateToChips();
  refreshControls();

  try {
    spinToNumber(targetNumber);
  } catch (e) {
    console.error(e);
    isSpinning = false;
    setStatus("Spin failed. Check console.", "error");
    applyLockedStateToChips();
    refreshControls();
    return;
  }

  window.setTimeout(() => {
    const finalDeg = getRotationDeg(wheelRotateEl);
    const shownNumber = numberAtPointer(finalDeg);

    if (lastResultEl) lastResultEl.textContent = `Result: ${shownNumber}`;

    isSpinning = false;
    setStatus("", "");
    applyLockedStateToChips();
    refreshControls();
  }, SPIN_DURATION_MS + 80);
}

// ------------------ Init ------------------
setupWheelWrapperAndLabels();
createNumberGrid();
updateWalletUI();

fetchRouletteTableState();
setInterval(fetchRouletteTableState, 1500);

initSocket();

if (placeBetBtn) placeBetBtn.addEventListener("click", handlePlaceBet);
if (spinBtn) spinBtn.addEventListener("click", handleSpin);

setSelectedNumber(null);
setStatus("");
