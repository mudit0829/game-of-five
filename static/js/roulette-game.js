// ================== CONFIG ==================
const FIXED_BET_AMOUNT = 200;
const MAX_BETS_PER_USER = 20;
const MAX_PLAYERS = 36; // not enforced here yet (server will do)

// Simulated state (replace later with real server data)
let walletBalance = 10000;
let userBets = [];        // array of numbers (0–35)
let selectedNumber = null;
let isSpinning = false;
let currentRoundSeconds = 60 * 60; // 60 minutes in seconds

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

  // Disable PLACE BET if limit or no wallet or spinning
  if (placeBetBtn) {
    placeBetBtn.disabled =
      atLimit || walletBalance < FIXED_BET_AMOUNT || isSpinning;
  }

  // Disable numbers if limit reached
  setNumberChipsDisabled(atLimit || isSpinning);
}

// ================== INIT NUMBER GRID ==================
function createNumberGrid() {
  if (!numbersGrid) return;
  for (let n = 0; n <= 35; n++) {
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

// ================== BET LOGIC (FRONTEND DEMO) ==================
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
    setStatus(`You can place only ${MAX_BETS_PER_USER} bets in this round.`, "error");
    return;
  }

  // Deduct and add bet (front-end demo only)
  walletBalance -= FIXED_BET_AMOUNT;
  userBets.push(selectedNumber);

  updateWalletUI();
  updateUserBetsUI();
  refreshBetControlsState();

  setStatus(`Bet placed on ${selectedNumber}.`, "ok");
}

// ================== WHEEL SPIN LOGIC ==================

let lastRotation = 0; // to keep wheel spinning forward

function spinWheelToNumber(targetNumber) {
  if (!wheelImg) return;

  const totalSlots = 36;
  const degreesPerSlot = 360 / totalSlots; // 10°
  const baseOffset = 0; // adjust if pointer is not at 0° in your image

  const slotIndex = targetNumber; // 0–35
  const targetAngle = baseOffset + slotIndex * degreesPerSlot;

  // Add extra spins (for nice animation)
  const extraSpins = 4; // full 360° rotations
  const targetRotation = extraSpins * 360 + targetAngle;

  // Make sure wheel keeps spinning forward
  const finalRotation = lastRotation + targetRotation;
  lastRotation = finalRotation % 360000; // avoid huge numbers

  const durationMs = 4000; // 4 seconds

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

  // In real app: you will receive targetNumber from backend.
  const targetNumber = Math.floor(Math.random() * 36); // 0–35

  isSpinning = true;
  setStatus("Spinning...", "ok");
  refreshBetControlsState();
  if (spinBtn) spinBtn.disabled = true;

  spinWheelToNumber(targetNumber);

  // After animation duration, resolve result
  setTimeout(() => {
    isSpinning = false;
    if (spinBtn) spinBtn.disabled = false;

    if (lastResultEl) lastResultEl.textContent = `Result: ${targetNumber}`;

    // Check win
    const totalBetAmount = userBets.length * FIXED_BET_AMOUNT;
    if (userBets.includes(targetNumber)) {
      const winAmount = totalBetAmount * 20; // 20x total bet
      walletBalance += winAmount;
      updateWalletUI();
      setStatus(
        `You WON! Number ${targetNumber}. Payout: ${winAmount} coins.`,
        "ok"
      );
    } else {
      setStatus(`You lost this spin. Result was ${targetNumber}.`, "error");
    }

    // For demo: keep your bets for the full 60‑min round.
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
