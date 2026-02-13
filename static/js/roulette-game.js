// ================== CONFIG ==================

// European roulette wheel order (single zero)
// Clockwise, starting from 0 at the top (under pointer)
const EURO_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36,
  11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9,
  22, 18, 29, 7, 28, 12, 35, 3, 26
]; // 37 slots

const TOTAL_SLOTS = EURO_WHEEL_ORDER.length; // 37
const DEGREES_PER_SLOT = 360 / TOTAL_SLOTS;

// IMPORTANT: image alignment tweak.
// Start with -68; if pointer is slightly off, adjust by small steps (e.g. -64, -72).
let BASE_OFFSET_DEG = -68;

const FIXED_BET_AMOUNT = 200;
const MAX_BETS_PER_USER = 20;
const MAX_PLAYERS = 37; // to be enforced by backend later

// Simulated state (front-end demo, no server yet)
let walletBalance = 10000;
let userBets = [];         // array of chosen numbers (0–36)
let selectedNumber = null;
let isSpinning = false;
let currentRoundSeconds = 60 * 60; // 60 minutes in seconds

// keep wheel spinning forward
let lastRotation = 0;

// DOM
const walletBalanceSpan = document.getElementById("walletBalance");
const userBetCountSpan = document.getElementById("userBetCount");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const statusEl = document.getElementById("statusMessage");
const numbersGrid = document.getElementById("numbersGrid");
const myBetsRow = document.getElementById("myBetsRow");
const placeBetBtn = document.getElementById("placeBetBtn");
const spinBtn = document.getElementById("spinBtn");
const lastResultEl = document.getElementById("lastResult");
const wheelImg = document.getElementById("rouletteWheel");

// ================== UTILS ==================
function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function formatTime(sec) {
  const s = Math.max(0, parseInt(sec || 0, 10));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function updateTimer() {
  if (!timerText) return;
  timerText.textContent = formatTime(currentRoundSeconds);
}

function updateWalletUI() {
  if (!walletBalanceSpan) return;
  walletBalanceSpan.textContent = walletBalance.toFixed(0);
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

  userBets
    .slice()
    .sort((a, b) => a - b)
    .forEach((n) => {
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

function setNumberChipsDisabled(disabled) {
  const d = !!disabled;
  document.querySelectorAll(".num-chip").forEach((chip) => {
    try { chip.disabled = d; } catch (e) {}
    chip.dataset.locked = d ? "1" : "0";
    chip.classList.toggle("locked", d);
    if (d) chip.classList.remove("selected");
  });
}

function refreshBetControlsState() {
  const atLimit = userBets.length >= MAX_BETS_PER_USER;

  if (atLimit) {
    setStatus(`Bet limit reached (${MAX_BETS_PER_USER}/${MAX_BETS_PER_USER}).`, "ok");
  }

  if (placeBetBtn) {
    placeBetBtn.disabled =
      atLimit || walletBalance < FIXED_BET_AMOUNT || isSpinning;
  }

  setNumberChipsDisabled(atLimit || isSpinning);
}

// ================== INIT NUMBER GRID ==================
function createNumberGrid() {
  if (!numbersGrid) return;
  for (let n = 0; n <= 36; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "num-chip";
    btn.textContent = n;
    btn.dataset.number = String(n);

    btn.addEventListener("click", () => {
      if (isSpinning) return;
      if (btn.disabled || btn.dataset.locked === "1") return;
      setSelectedNumber(n);
      setStatus("", "");
    });

    numbersGrid.appendChild(btn);
  }
}

// ================== BET LOGIC (DEMO) ==================
function handlePlaceBet() {
  if (isSpinning) {
    setStatus("Wheel is spinning, please wait...", "error");
    return;
  }

  if (currentRoundSeconds <= 0) {
    setStatus("This round has ended.", "error");
    return;
  }

  if (walletBalance < FIXED_BET_AMOUNT) {
    setStatus("Insufficient balance.", "error");
    return;
  }

  if (selectedNumber === null || selectedNumber === undefined) {
    setStatus("Select a number first.", "error");
    return;
  }

  if (userBets.includes(selectedNumber)) {
    setStatus("You already bet on this number.", "error");
    return;
  }

  if (userBets.length >= MAX_BETS_PER_USER) {
    setStatus(
      `You can place only ${MAX_BETS_PER_USER} bets in this round.`,
      "error"
    );
    return;
  }

  walletBalance -= FIXED_BET_AMOUNT;
  userBets.push(selectedNumber);

  updateWalletUI();
  updateUserBetsUI();
  refreshBetControlsState();

  setStatus(`Bet placed on ${selectedNumber}.`, "ok");
}

// ================== WHEEL SPIN (EURO ORDER) ==================
function spinWheelToNumber(targetNumber) {
  if (!wheelImg) return;

  const slotIndex = EURO_WHEEL_ORDER.indexOf(targetNumber);
  if (slotIndex === -1) {
    console.warn("Number not found on wheel order:", targetNumber);
    return;
  }

  const targetAngle = BASE_OFFSET_DEG + slotIndex * DEGREES_PER_SLOT;

  const extraSpins = 4;
  const targetRotation = extraSpins * 360 + targetAngle;

  const finalRotation = lastRotation + targetRotation;
  lastRotation = finalRotation % 360000;

  const durationMs = 4000;

  wheelImg.style.transition = `transform ${durationMs}ms cubic-bezier(0.15, 0.8, 0.25, 1)`;
  wheelImg.style.transform = `rotate(${finalRotation}deg)`;
}

function handleSpin() {
  if (isSpinning) return;

  if (currentRoundSeconds <= 0) {
    setStatus("This round is over. Waiting for next round.", "error");
    return;
  }

  if (userBets.length === 0) {
    setStatus("Place at least one bet before spinning.", "error");
    return;
  }

  // In real app, targetNumber comes from backend.
  const targetIndex = Math.floor(Math.random() * TOTAL_SLOTS);
  const targetNumber = EURO_WHEEL_ORDER[targetIndex];

  isSpinning = true;
  setStatus("Spinning...", "ok");
  refreshBetControlsState();
  if (spinBtn) spinBtn.disabled = true;

  spinWheelToNumber(targetNumber);

  setTimeout(() => {
    isSpinning = false;
    if (spinBtn) spinBtn.disabled = false;

    if (lastResultEl) lastResultEl.textContent = `Result: ${targetNumber}`;

    const totalBetAmount = userBets.length * FIXED_BET_AMOUNT;
    if (userBets.includes(targetNumber)) {
      const winAmount = totalBetAmount * 20;
      walletBalance += winAmount;
      updateWalletUI();
      setStatus(
        `You WON! Number ${targetNumber}. Payout: ${winAmount} coins.`,
        "ok"
      );
    } else {
      setStatus(`You lost this spin. Result was ${targetNumber}.`, "error");
    }

    refreshBetControlsState();
  }, 4100);
}

// ================== TIMER (DEMO 60-MIN ROUND) ==================
function startRoundTimer() {
  updateTimer();
  setInterval(() => {
    if (currentRoundSeconds > 0) {
      currentRoundSeconds -= 1;
      updateTimer();
    }
  }, 1000);
}

// ================== INIT ==================
createNumberGrid();
updateWalletUI();
updateUserBetsUI();
refreshBetControlsState();
startRoundTimer();

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", handlePlaceBet);
}

if (spinBtn) {
  spinBtn.addEventListener("click", handleSpin);
}

setSelectedNumber(null);
setStatus("");
