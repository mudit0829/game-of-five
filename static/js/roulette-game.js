// ================== Roulette Wheel (Angle-Verified Result + Global Locked Numbers) ==================

// Wheel order you provided (European single zero)
// Clockwise order starting from 0 at the pointer when rotation = 0
const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
];

const TOTAL_SLOTS = WHEEL_ORDER.length;      // 37
const DEG_PER_SLOT = 360 / TOTAL_SLOTS;

// Optional tiny correction if your pointer graphic is not exactly at 12 o'clock.
const POINTER_OFFSET_DEG = 0;

// Spin animation
const SPIN_DURATION_MS = 4200;
const EXTRA_FULL_SPINS = 5;

// Betting (demo)
const FIXED_BET_AMOUNT = 200;
const MAX_BETS_PER_USER = 20;

// ------------------ Multiplayer sync ------------------
// If you have backend endpoints, turn this ON and set correct URLs.
const API_ENABLED = false;

const API = {
  // Should return: { lockedNumbers: number[] }
  stateUrl: "/api/roulette/state",
  // POST body: { number: 17 }
  // Should return: { ok: true, lockedNumbers: number[], walletBalance?: number, userBets?: number[] }
  placeBetUrl: "/api/roulette/bet"
};

// Polling to catch bets from other players (use WebSocket later for real-time)
const STATE_POLL_MS = 1200;

// Demo fallback (no backend): sync between tabs
const LS_LOCKED_KEY = "roulette_locked_numbers_v1";

// ------------------ State ------------------
let walletBalance = 10000;
let userBets = [];
let selectedNumber = null;
let isSpinning = false;

let lastRotationDeg = 0; // keep increasing so wheel always spins forward

// Numbers already bet by ANY player in this round
let lockedNumbers = new Set();

// ------------------ DOM ------------------
const wheelImg = document.getElementById("rouletteWheel"); // <img id="rouletteWheel" ...>
const spinBtn = document.getElementById("spinBtn");
const placeBetBtn = document.getElementById("placeBetBtn");

const walletBalanceSpan = document.getElementById("walletBalance");
const userBetCountSpan = document.getElementById("userBetCount");
const numbersGrid = document.getElementById("numbersGrid");
const myBetsRow = document.getElementById("myBetsRow");
const statusEl = document.getElementById("statusMessage");
const lastResultEl = document.getElementById("lastResult");

// Rotating wrapper we create around the image (no HTML change needed)
let wheelRotateEl = null;

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
  if (walletBalanceSpan) walletBalanceSpan.textContent = walletBalance.toFixed(0);
}

function updateUserBetsUI() {
  if (userBetCountSpan) userBetCountSpan.textContent = userBets.length;

  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  if (userBets.length === 0) {
    const span = document.createElement("span");
    span.className = "none-label";
    span.textContent = "none";
    myBetsRow.appendChild(span);
    return;
  }

  userBets.slice().sort((a,b)=>a-b).forEach((n) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = n;
    myBetsRow.appendChild(chip);
  });
}

// ---- Locked chips UI ----
// Using classList is the clean way to apply UI state (locked/red). [web:79]
function getChipEl(n) {
  return document.querySelector(`.num-chip[data-number="${n}"]`);
}

function setChipLockedUI(n, locked) {
  const el = getChipEl(n);
  if (!el) return;

  el.classList.toggle("bet-locked", !!locked); // [web:79]
  if (locked) {
    el.disabled = true; // actually blocks betting [web:98]
  }
}

function syncAllChipsLockedUI() {
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const n = parseInt(chip.dataset.number, 10);
    const isLocked = lockedNumbers.has(n);
    chip.classList.toggle("bet-locked", isLocked); // [web:79]
    if (isLocked) chip.disabled = true; // [web:98]
  });
}

function setSelectedNumber(n) {
  selectedNumber = n;

  document.querySelectorAll(".num-chip").forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n); // [web:79]
  });
}

function refreshControls() {
  const atLimit = userBets.length >= MAX_BETS_PER_USER;

  if (placeBetBtn) {
    placeBetBtn.disabled =
      isSpinning ||
      atLimit ||
      walletBalance < FIXED_BET_AMOUNT ||
      selectedNumber === null ||
      lockedNumbers.has(selectedNumber);
  }

  if (spinBtn) {
    spinBtn.disabled = isSpinning || userBets.length === 0;
  }

  // Chips:
  // - Locked numbers: always disabled
  // - Otherwise: disabled only during spinning or when at limit
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const n = parseInt(chip.dataset.number, 10);
    if (lockedNumbers.has(n)) {
      chip.disabled = true; // [web:98]
      chip.classList.add("bet-locked"); // [web:79]
    } else {
      chip.disabled = isSpinning || atLimit; // [web:98]
      chip.classList.remove("bet-locked"); // [web:79]
    }
  });
}

// ------------------ Build number grid ------------------
function createNumberGrid() {
  if (!numbersGrid) return;

  numbersGrid.innerHTML = "";
  for (let n = 0; n <= 36; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "num-chip";
    btn.textContent = n;
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

  syncAllChipsLockedUI();
  refreshControls();
}

// ------------------ Wheel DOM wrapper + hidden labels ------------------
function injectWheelStylesOnce() {
  if (document.getElementById("wheelHiddenLabelStyles")) return;
  const style = document.createElement("style");
  style.id = "wheelHiddenLabelStyles";
  style.textContent = `
    #wheelRotate {
      position: relative;
      display: inline-block;
      will-change: transform;
      transform: rotate(0deg);
      transform-origin: 50% 50%;
    }
    #wheelRotate img {
      display: block;
      width: 100%;
      height: auto;
      transform: none !important;
    }
    #wheelLabels {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .wheel-label {
      position: absolute;
      left: 50%;
      top: 50%;
      transform-origin: 0 0;
      font-size: 10px;
      font-weight: 700;
      opacity: 0; /* fully hidden */
      user-select: none;
      white-space: nowrap;
    }
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

// ------------------ Locked numbers sync (API or localStorage demo) ------------------
function loadLockedFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_LOCKED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    lockedNumbers = new Set(arr.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)));
  } catch {
    lockedNumbers = new Set();
  }
}

function saveLockedToLocalStorage() {
  const arr = Array.from(lockedNumbers.values()).sort((a,b)=>a-b);
  localStorage.setItem(LS_LOCKED_KEY, JSON.stringify(arr));
}

async function fetchStateFromServer() {
  const res = await fetch(API.stateUrl, { method: "GET" });
  if (!res.ok) throw new Error("State fetch failed");
  const data = await res.json();
  const arr = Array.isArray(data.lockedNumbers) ? data.lockedNumbers : [];
  lockedNumbers = new Set(arr.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)));
}

async function placeBetOnServer(number) {
  const res = await fetch(API.placeBetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Bet rejected");
  }
  if (Array.isArray(data.lockedNumbers)) {
    lockedNumbers = new Set(data.lockedNumbers.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)));
  } else {
    lockedNumbers.add(number);
  }
  if (typeof data.walletBalance === "number") walletBalance = data.walletBalance;
  if (Array.isArray(data.userBets)) userBets = data.userBets;
}

function startStateSync() {
  if (API_ENABLED) {
    // Poll server
    setInterval(async () => {
      if (isSpinning) return;
      try {
        await fetchStateFromServer();
        syncAllChipsLockedUI();
        refreshControls();
      } catch {
        // silent
      }
    }, STATE_POLL_MS);
  } else {
    // Demo: keep tabs in sync
    loadLockedFromLocalStorage();
    window.addEventListener("storage", (e) => {
      if (e.key !== LS_LOCKED_KEY) return;
      loadLockedFromLocalStorage();
      syncAllChipsLockedUI();
      refreshControls();
    });
    // Optional: also refresh every second
    setInterval(() => {
      loadLockedFromLocalStorage();
      syncAllChipsLockedUI();
      refreshControls();
    }, STATE_POLL_MS);
  }
}

// ------------------ Betting handlers ------------------
async function handlePlaceBet() {
  if (isSpinning) return;

  if (selectedNumber === null || selectedNumber === undefined) {
    setStatus("Select a number first.", "error");
    return;
  }

  if (lockedNumbers.has(selectedNumber)) {
    setStatus("This number is already bet by another player.", "error");
    setChipLockedUI(selectedNumber, true);
    refreshControls();
    return;
  }

  if (walletBalance < FIXED_BET_AMOUNT) {
    setStatus("Insufficient balance.", "error");
    return;
  }

  if (userBets.includes(selectedNumber)) {
    setStatus("You already bet on this number.", "error");
    return;
  }

  if (userBets.length >= MAX_BETS_PER_USER) {
    setStatus(`Max ${MAX_BETS_PER_USER} bets allowed.`, "error");
    return;
  }

  try {
    if (API_ENABLED) {
      // Backend must validate: only one bet per number globally
      await placeBetOnServer(selectedNumber);
    } else {
      // Demo-only local lock
      lockedNumbers.add(selectedNumber);
      saveLockedToLocalStorage();
    }
  } catch (err) {
    setStatus(err?.message || "Bet rejected.", "error");
    // Refresh state after rejection (maybe someone else took it)
    if (API_ENABLED) {
      try { await fetchStateFromServer(); } catch {}
    } else {
      loadLockedFromLocalStorage();
    }
    syncAllChipsLockedUI();
    refreshControls();
    return;
  }

  // Local player state (still shown in your UI)
  walletBalance -= FIXED_BET_AMOUNT;
  userBets.push(selectedNumber);

  // Lock UI
  setChipLockedUI(selectedNumber, true);
  selectedNumber = null;
  setSelectedNumber(null);

  updateWalletUI();
  updateUserBetsUI();
  syncAllChipsLockedUI();
  refreshControls();
  setStatus("Bet placed.", "ok");
}

function handleSpin() {
  if (isSpinning) return;
  if (!wheelRotateEl) {
    setStatus("Wheel not ready (missing #rouletteWheel).", "error");
    return;
  }
  if (userBets.length === 0) {
    setStatus("Place at least one bet before spinning.", "error");
    return;
  }

  const targetNumber = WHEEL_ORDER[Math.floor(Math.random() * TOTAL_SLOTS)];

  isSpinning = true;
  setStatus("Spinning...", "ok");
  refreshControls();

  try {
    spinToNumber(targetNumber);
  } catch (e) {
    console.error(e);
    isSpinning = false;
    setStatus("Spin failed. Check console.", "error");
    refreshControls();
    return;
  }

  window.setTimeout(() => {
    const finalDeg = getRotationDeg(wheelRotateEl);
    const shownNumber = numberAtPointer(finalDeg);

    if (lastResultEl) lastResultEl.textContent = `Result: ${shownNumber}`;

    const totalBetAmount = userBets.length * FIXED_BET_AMOUNT;
    if (userBets.includes(shownNumber)) {
      const winAmount = totalBetAmount * 20;
      walletBalance += winAmount;
      updateWalletUI();
      setStatus(`You WON! Number ${shownNumber}. Payout: ${winAmount} coins.`, "ok");
    } else {
      setStatus(`You lost. Result was ${shownNumber}.`, "error");
    }

    isSpinning = false;
    refreshControls();
  }, SPIN_DURATION_MS + 60);
}

// ------------------ Init ------------------
setupWheelWrapperAndLabels();

if (!API_ENABLED) {
  loadLockedFromLocalStorage();
}

createNumberGrid();
updateWalletUI();
updateUserBetsUI();
syncAllChipsLockedUI();
refreshControls();
startStateSync();

if (placeBetBtn) placeBetBtn.addEventListener("click", handlePlaceBet);
if (spinBtn) spinBtn.addEventListener("click", handleSpin);

setSelectedNumber(null);
setStatus("");
