// Roulette (Hourly) - Frontend demo
// 36 numbers, max 20 unique numbers per user per round
// Bet unit = 200, payout = 10x (200 -> 2000)

const BET_UNIT = 200;
const PAYOUT_MULTIPLIER = 10; // 200 -> 2000
const MAX_UNIQUE = 20;

// European roulette wheel order without 0 (to match 1-36 only)
const WHEEL_ORDER_36 = [
  32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
];

// Color mapping (standard roulette red numbers)
const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const isRed = (n) => RED_SET.has(n);
const colorClass = (n) => (isRed(n) ? "red" : "black");

// DOM
const walletBalanceSpan = document.getElementById("walletBalance");
const timerText = document.getElementById("timerText");
const statusEl = document.getElementById("statusMessage");
const roundInfo = document.getElementById("roundInfo");
const lastResultEl = document.getElementById("lastResult");

const numberGrid = document.getElementById("numberGrid");
const placeBetBtn = document.getElementById("placeBetBtn");
const clearBtn = document.getElementById("clearBtn");
const betsList = document.getElementById("betsList");

const myUniqueCountEl = document.getElementById("myUniqueCount");
const totalBetEl = document.getElementById("totalBet");
const payableNowEl = document.getElementById("payableNow");
const betUnitEl = document.getElementById("betUnit");
const roundStatusEl = document.getElementById("roundStatus");
const slipHint = document.getElementById("slipHint");

const wheelCanvas = document.getElementById("wheelCanvas");
const ctx = wheelCanvas.getContext("2d");

if (betUnitEl) betUnitEl.textContent = String(BET_UNIT);

// --------- Local state ----------
const LS_KEY = "roulette_hourly_demo_v1";

let wallet = 10000;
let lastResult = null;

// bets: Map<number, {units:number, amount:number}>
// units = how many BET_UNIT on that number
let bets = new Map();

let round = {
  id: "",
  startMs: 0,
  endMs: 0,
  status: "OPEN", // OPEN | CLOSED | SPINNING | FINISHED
  result: null
};

let wheel = {
  angle: 0,        // current rotation (radians)
  spinning: false,
  targetAngle: 0,
  startAngle: 0,
  startTime: 0,
  duration: 0
};

// --------- Helpers ----------
function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function saveState() {
  const obj = {
    wallet,
    lastResult,
    round: { ...round },
    bets: Array.from(bets.entries()) // [ [num, {units,amount}], ... ]
  };
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.wallet === "number") wallet = obj.wallet;
    if (obj.lastResult != null) lastResult = obj.lastResult;
  } catch {}
}

function updateWalletUI() {
  if (walletBalanceSpan) walletBalanceSpan.textContent = String(Math.floor(wallet));
}

function getHourRoundId(d = new Date()) {
  // Round id like 2026-02-07 11:00
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:00`;
}

function getRoundTimes(d = new Date()) {
  const start = new Date(d);
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function ensureRound() {
  const now = new Date();
  const id = getHourRoundId(now);
  const { startMs, endMs } = getRoundTimes(now);

  // If round changed, reset
  if (round.id !== id) {
    round = { id, startMs, endMs, status: "OPEN", result: null };
    bets = new Map();
    setStatus("New round started. Place your bets.", "ok");
    saveState();
  }

  // status based on time
  const nowMs = Date.now();
  const secLeft = Math.max(0, (round.endMs - nowMs) / 1000);

  // last 20 seconds close betting (optional)
  if (secLeft <= 20 && secLeft > 0 && round.status === "OPEN") {
    round.status = "CLOSED";
    setStatus("Betting closed. Waiting for result…", "warn");
  }

  if (secLeft <= 0 && (round.status === "OPEN" || round.status === "CLOSED")) {
    // finish & spin automatically
    startSpin();
  }
}

function computeTotals() {
  let total = 0;
  for (const [, v] of bets.entries()) total += v.amount;
  return total;
}

function uniqueCount() {
  return bets.size;
}

// --------- Grid UI ----------
function buildGrid() {
  if (!numberGrid) return;
  numberGrid.innerHTML = "";

  // Standard table feel: numbers appear 1..36
  for (let n = 1; n <= 36; n++) {
    const el = document.createElement("div");
    el.className = `num ${colorClass(n)}`;
    el.dataset.n = String(n);

    const left = document.createElement("div");
    left.className = "n";
    left.textContent = String(n);

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = "Bet";

    el.appendChild(left);
    el.appendChild(tag);

    el.addEventListener("click", () => onToggleNumber(n));
    numberGrid.appendChild(el);
  }
}

function syncGridSelection() {
  if (!numberGrid) return;
  const children = Array.from(numberGrid.children);
  for (const el of children) {
    const n = parseInt(el.dataset.n, 10);
    el.classList.toggle("selected", bets.has(n));
    const tag = el.querySelector(".tag");
    if (tag) {
      if (bets.has(n)) {
        const v = bets.get(n);
        tag.textContent = `×${v.units}`;
      } else {
        tag.textContent = "Bet";
      }
    }
  }
}

function onToggleNumber(n) {
  ensureRound();
  if (round.status !== "OPEN") {
    setStatus("Betting is closed for this round.", "error");
    return;
  }

  if (!bets.has(n)) {
    if (uniqueCount() >= MAX_UNIQUE) {
      setStatus("You can bet on maximum 20 unique numbers.", "error");
      return;
    }
    bets.set(n, { units: 1, amount: BET_UNIT });
  } else {
    // toggle remove
    bets.delete(n);
  }
  syncUI();
  saveState();
}

// --------- Bet slip UI ----------
function renderSlip() {
  if (!betsList) return;
  betsList.innerHTML = "";

  const entries = Array.from(bets.entries()).sort((a, b) => a[0] - b[0]);

  if (entries.length === 0) {
    if (slipHint) slipHint.textContent = "No bets yet.";
    return;
  }
  if (slipHint) slipHint.textContent = "Adjust units with +/− (each unit = ₹200).";

  for (const [n, v] of entries) {
    const row = document.createElement("div");
    row.className = "betrow";

    const left = document.createElement("div");
    left.className = "betrow-left";

    const badge = document.createElement("div");
    badge.className = `badge ${colorClass(n)}`;
    badge.textContent = String(n);

    const meta = document.createElement("div");
    meta.className = "betmeta";
    const line1 = document.createElement("div");
    line1.className = "line1";
    line1.textContent = `Number ${n}`;
    const line2 = document.createElement("div");
    line2.className = "line2";
    line2.textContent = `Units: ${v.units} • Amount: ₹${v.amount}`;

    meta.appendChild(line1);
    meta.appendChild(line2);

    left.appendChild(badge);
    left.appendChild(meta);

    const stepper = document.createElement("div");
    stepper.className = "stepper";

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.disabled = (round.status !== "OPEN");
    minus.addEventListener("click", (e) => {
      e.stopPropagation();
      changeUnits(n, -1);
    });

    const amt = document.createElement("div");
    amt.className = "amt";
    amt.textContent = `₹${v.amount}`;

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.disabled = (round.status !== "OPEN");
    plus.addEventListener("click", (e) => {
      e.stopPropagation();
      changeUnits(n, +1);
    });

    stepper.appendChild(minus);
    stepper.appendChild(amt);
    stepper.appendChild(plus);

    row.appendChild(left);
    row.appendChild(stepper);
    betsList.appendChild(row);
  }
}

function changeUnits(n, delta) {
  ensureRound();
  if (round.status !== "OPEN") return;

  const v = bets.get(n);
  if (!v) return;

  const next = v.units + delta;
  if (next <= 0) {
    bets.delete(n);
  } else {
    v.units = next;
    v.amount = next * BET_UNIT;
    bets.set(n, v);
  }
  syncUI();
  saveState();
}

// --------- Round actions ----------
function clearBets() {
  ensureRound();
  if (round.status !== "OPEN") {
    setStatus("You cannot clear bets after betting is closed.", "error");
    return;
  }
  bets = new Map();
  syncUI();
  saveState();
}

function placeBets() {
  ensureRound();
  if (round.status !== "OPEN") {
    setStatus("Betting is closed for this round.", "error");
    return;
  }
  const total = computeTotals();
  if (total <= 0) {
    setStatus("Select at least one number.", "error");
    return;
  }
  if (wallet < total) {
    setStatus("Insufficient wallet balance.", "error");
    return;
  }

  // In real money game, wallet debit must be server-side + atomic.
  wallet -= total;
  setStatus(`Bets placed: ₹${total}. Good luck!`, "ok");
  syncUI();
  saveState();
}

function pickRandomResult() {
  // 1..36 uniform for demo
  return 1 + Math.floor(Math.random() * 36);
}

function settleRound() {
  const result = round.result;
  if (!result) return;

  let win = 0;
  const v = bets.get(result);
  if (v) {
    // payout = amount * multiplier
    win = v.amount * PAYOUT_MULTIPLIER;
    wallet += win;
  }

  lastResult = result;
  if (lastResultEl) lastResultEl.textContent = String(lastResult);

  if (win > 0) setStatus(`Result: ${result}. You WON ₹${win}.`, "ok");
  else setStatus(`Result: ${result}. No win this time.`, "warn");

  // mark finish; next ensureRound() will roll over on next hour
  round.status = "FINISHED";

  syncUI();
  saveState();
}

// --------- Wheel drawing ----------
function drawWheel() {
  const w = wheelCanvas.width;
  const h = wheelCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.46;

  ctx.clearRect(0, 0, w, h);

  // background ring
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, R + 22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15,23,42,0.65)";
  ctx.fill();
  ctx.restore();

  const N = WHEEL_ORDER_36.length;
  const slice = (Math.PI * 2) / N;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(wheel.angle);

  for (let i = 0; i < N; i++) {
    const num = WHEEL_ORDER_36[i];
    const a0 = i * slice;
    const a1 = a0 + slice;

    // segment
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();

    const col = isRed(num) ? "rgba(239,68,68,0.90)" : "rgba(17,24,39,0.95)";
    ctx.fillStyle = col;
    ctx.fill();

    // border
    ctx.strokeStyle = "rgba(226,232,240,0.08)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // number text
    const mid = (a0 + a1) / 2;
    ctx.save();
    ctx.rotate(mid);
    ctx.translate(R * 0.75, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "rgba(226,232,240,0.95)";
    ctx.font = "900 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  // center cap
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.23, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(7,11,20,0.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(56,189,248,0.25)";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.restore();
}

function angleForResult(resultNumber) {
  const idx = WHEEL_ORDER_36.indexOf(resultNumber);
  const N = WHEEL_ORDER_36.length;
  const slice = (Math.PI * 2) / N;

  // Pointer is at top (12 o'clock). In canvas, 0 rad is to the right, so top is -PI/2.
  // We want the center of the result slice to land at -PI/2.
  const sliceCenter = (idx + 0.5) * slice;
  const desired = (-Math.PI / 2) - sliceCenter;
  return desired;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function startSpin() {
  if (wheel.spinning) return;

  round.status = "SPINNING";
  if (roundStatusEl) roundStatusEl.textContent = "SPINNING";
  placeBetBtn && (placeBetBtn.disabled = true);

  // pick result and compute target
  round.result = pickRandomResult();
  const base = angleForResult(round.result);

  // add extra rotations
  const extraTurns = 5 + Math.floor(Math.random() * 3); // 5..7
  const target = base + extraTurns * Math.PI * 2;

  wheel.spinning = true;
  wheel.startAngle = wheel.angle;
  wheel.targetAngle = target;
  wheel.startTime = performance.now();
  wheel.duration = 7500;

  setStatus("Spinning…", "warn");
  requestAnimationFrame(spinStep);
}

function spinStep(now) {
  const t = Math.min(1, (now - wheel.startTime) / wheel.duration);
  const e = easeOutCubic(t);

  // interpolate angle
  wheel.angle = wheel.startAngle + (wheel.targetAngle - wheel.startAngle) * e;
  drawWheel();

  if (t < 1) {
    requestAnimationFrame(spinStep);
    return;
  }

  wheel.spinning = false;
  round.status = "FINISHED";
  settleRound();
}

// --------- UI sync ----------
function syncUI() {
  updateWalletUI();

  // timer
  const nowMs = Date.now();
  const secLeft = Math.max(0, Math.floor((round.endMs - nowMs) / 1000));
  if (timerText) timerText.textContent = fmtTime(secLeft);

  // round info
  if (roundInfo) roundInfo.textContent = `Round: ${round.id}`;
  if (roundStatusEl) roundStatusEl.textContent = round.status;

  // selections
  if (myUniqueCountEl) myUniqueCountEl.textContent = String(uniqueCount());
  const total = computeTotals();
  if (totalBetEl) totalBetEl.textContent = String(total);
  if (payableNowEl) payableNowEl.textContent = String(total);

  syncGridSelection();
  renderSlip();

  // buttons
  const canBet = (round.status === "OPEN");
  if (placeBetBtn) placeBetBtn.disabled = !canBet || wheel.spinning;
  if (clearBtn) clearBtn.disabled = !canBet || wheel.spinning;

  // last result
  if (lastResultEl) lastResultEl.textContent = (lastResult == null ? "-" : String(lastResult));
}

function tick() {
  ensureRound();
  syncUI();

  // keep drawing wheel even if not spinning
  if (!wheel.spinning) drawWheel();

  setTimeout(tick, 250);
}

// --------- Events ----------
if (clearBtn) clearBtn.addEventListener("click", clearBets);
if (placeBetBtn) placeBetBtn.addEventListener("click", placeBets);

// --------- Init ----------
loadState();
updateWalletUI();
buildGrid();

ensureRound();
syncUI();
drawWheel();
tick();
