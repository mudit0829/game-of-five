// ================== Roulette Wheel (Angle-Verified Result) ==================

// Wheel order you provided (European single zero)
// Clockwise order starting from 0 at the pointer when rotation = 0
const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
];

const TOTAL_SLOTS = WHEEL_ORDER.length;      // 37
const DEG_PER_SLOT = 360 / TOTAL_SLOTS;

// Optional tiny correction if your pointer graphic is not exactly at 12 o'clock.
// Keep 0 normally.
const POINTER_OFFSET_DEG = 0;

// Spin animation
const SPIN_DURATION_MS = 4200;
const EXTRA_FULL_SPINS = 5;

// Betting (demo)
const FIXED_BET_AMOUNT = 200;
const MAX_BETS_PER_USER = 20;

// ------------------ State ------------------
let walletBalance = 10000;
let userBets = [];
let selectedNumber = null;
let isSpinning = false;

let lastRotationDeg = 0; // keep increasing so wheel always spins forward

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

function setSelectedNumber(n) {
  selectedNumber = n;
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function refreshControls() {
  const atLimit = userBets.length >= MAX_BETS_PER_USER;

  if (placeBetBtn) {
    placeBetBtn.disabled = isSpinning || atLimit || walletBalance < FIXED_BET_AMOUNT;
  }
  if (spinBtn) {
    spinBtn.disabled = isSpinning || userBets.length === 0;
  }

  document.querySelectorAll(".num-chip").forEach((chip) => {
    chip.disabled = isSpinning || atLimit;
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
      setSelectedNumber(n);
      setStatus("");
    });

    numbersGrid.appendChild(btn);
  }
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
      opacity: 0;          /* fully hidden for users */
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

  // If wrapper already created, skip
  if (document.getElementById("wheelRotate")) {
    wheelRotateEl = document.getElementById("wheelRotate");
    return;
  }

  const parent = wheelImg.parentElement;
  if (!parent) return;

  // Create wrapper
  const wrap = document.createElement("div");
  wrap.id = "wheelRotate";

  // Keep same layout size as image: move image into wrapper
  parent.insertBefore(wrap, wheelImg);
  wrap.appendChild(wheelImg);

  // Labels overlay
  const labels = document.createElement("div");
  labels.id = "wheelLabels";
  wrap.appendChild(labels);

  // Build 37 hidden labels around a radius
  // Radius chosen relative to wrapper size at runtime
  // We will position using percentage-like translate with a computed px radius.
  // Use a reasonable default, then adjust on next animation frame after layout.
  function buildLabels() {
    labels.innerHTML = "";
    const rect = wrap.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.43; // tweak if needed

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const n = WHEEL_ORDER[i];
      const angle = i * DEG_PER_SLOT;

      const el = document.createElement("div");
      el.className = "wheel-label";
      el.setAttribute("aria-hidden", "true");
      el.dataset.number = String(n);

      // Place each label at its pocket center:
      // rotate(angle) -> move up by radius -> rotate back so text stays upright.
      el.style.transform = `rotate(${angle}deg) translate(0, ${-radius}px) rotate(${-angle}deg) translate(-50%, -50%)`;

      // Keep text present but invisible
      el.textContent = String(n);

      labels.appendChild(el);
    }
  }

  // Build now and rebuild on resize
  requestAnimationFrame(buildLabels);
  window.addEventListener("resize", () => requestAnimationFrame(buildLabels), { passive: true });

  wheelRotateEl = wrap;
}

// ------------------ Rotation math ------------------
// Read current rotation angle from element transform (deg)
function getRotationDeg(el) {
  const st = window.getComputedStyle(el);
  const tr = st.transform || "none";
  if (tr === "none") return 0;

  // matrix(a, b, c, d, tx, ty)
  const m = tr.match(/^matrix\((.+)\)$/);
  if (!m) return 0;

  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  const [a, b] = parts;
  let angle = Math.atan2(b, a) * (180 / Math.PI); // -180..180
  if (angle < 0) angle += 360;
  return angle;
}

// Convert final wheel rotation to the number under the pointer (top)
function numberAtPointer(rotationDeg) {
  // If wheel rotates clockwise by +rotationDeg,
  // the pointer shows the slot at index = round((-rotationDeg + offset)/degPerSlot)
  const corrected = rotationDeg + POINTER_OFFSET_DEG;
  const idx = mod(Math.round((-corrected) / DEG_PER_SLOT), TOTAL_SLOTS);
  return WHEEL_ORDER[idx];
}

// Spin the wheel so that the pointer lands on targetNumber
function spinToNumber(targetNumber) {
  const idx = WHEEL_ORDER.indexOf(targetNumber);
  if (idx === -1) throw new Error("Target not found in wheel order: " + targetNumber);

  // To bring slot idx to the top, rotation must be -idx*DEG_PER_SLOT (plus pointer offset)
  const targetAngle = -(idx * DEG_PER_SLOT) - POINTER_OFFSET_DEG;

  // Keep forward spin: add extra full spins and continue from lastRotationDeg
  const extra = EXTRA_FULL_SPINS * 360;

  const finalRotation = lastRotationDeg + extra + targetAngle;
  lastRotationDeg = finalRotation;

  wheelRotateEl.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.15, 0.8, 0.25, 1)`;
  wheelRotateEl.style.transform = `rotate(${finalRotation}deg)`;
}

// ------------------ Betting handlers (demo) ------------------
function handlePlaceBet() {
  if (isSpinning) return;

  if (selectedNumber === null || selectedNumber === undefined) {
    setStatus("Select a number first.", "error");
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

  walletBalance -= FIXED_BET_AMOUNT;
  userBets.push(selectedNumber);

  updateWalletUI();
  updateUserBetsUI();
  refreshControls();
  setStatus(`Bet placed on ${selectedNumber}.`, "ok");
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

  // In production: get result from backend.
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

  // After animation, compute the result from the ACTUAL final angle (guarantees match)
  window.setTimeout(() => {
    const finalDeg = getRotationDeg(wheelRotateEl);
    const shownNumber = numberAtPointer(finalDeg);

    if (lastResultEl) lastResultEl.textContent = `Result: ${shownNumber}`;

    // Simple payout demo: if any bet matches, pay totalBet*20
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

createNumberGrid();
updateWalletUI();
updateUserBetsUI();
refreshControls();

if (placeBetBtn) placeBetBtn.addEventListener("click", handlePlaceBet);
if (spinBtn) spinBtn.addEventListener("click", handleSpin);

setSelectedNumber(null);
setStatus("");
