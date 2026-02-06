// ================= BASIC SETUP =================
// ✅ CRITICAL: Use window.* variables

const GAME = window.GAME_TYPE || "diamond";
const FIXED_BET_AMOUNT = window.FIXED_BET_AMOUNT || 100;

const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

const USER_ID = window.GAME_USER_ID;
const USERNAME = window.GAME_USERNAME || "Player";
const HOME_URL = "/home";

// ================= DOM REFERENCES =================

const rangeEl = document.querySelector(".range");
const arrowImg = document.getElementById("arrowSprite");
const archerImg = document.getElementById("archerSprite");
const archerLayerEl = document.querySelector(".archer-layer");
const targets = Array.from(document.querySelectorAll(".target.pad"));

const numChips = Array.from(document.querySelectorAll(".num-chip"));
const placeBetBtn = document.getElementById("placeBetBtn");

const roundIdSpan = document.getElementById("roundId");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const timerPill = document.querySelector(".timer-pill");
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

if (userNameLabel) userNameLabel.textContent = USERNAME;

let walletBalance = 0;
let selectedNumber = 0;
let currentTable = null;
let lastResultShown = null;
let gameFinished = false;
let tablePollInterval = null;
let localTimerInterval = null;
let displayRemainingSeconds = 0;
let userHasBet = false;

// ================= UI HELPERS =================

function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = balance;
  if (walletBalanceSpan) walletBalanceSpan.textContent = walletBalance.toFixed(0);

  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds || 0, 10));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function renderTimer() {
  if (!timerText) return;
  timerText.textContent = formatTime(displayRemainingSeconds);
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function disableBettingUI() {
  if (placeBetBtn) placeBetBtn.disabled = true;
  numChips.forEach((chip) => (chip.disabled = true));
}

// ✅ FIXED: Update my bets display
function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => {
    const betUserId = String(b.user_id || b.userId || "");
    return betUserId === String(USER_ID);
  });

  if (myBets.length > 0) userHasBet = true;

  if (userBetCountLabel) userBetCountLabel.textContent = myBets.length;

  if (!myBetsRow) return;

  if (myBets.length === 0) {
    myBetsRow.innerHTML = '<span style="color:#6b7280;font-size:11px;">none</span>';
  } else {
    const numbers = myBets.map((b) => b.number).sort((a, b) => a - b);
    myBetsRow.innerHTML = numbers.map((n) => `<span class="my-bet-chip">${n}</span>`).join(", ");
  }
}

// ✅ FIXED: Update targets from bets
function updateTargetsFromBets(bets) {
  const list = (bets || []).slice(0, 6);

  targets.forEach((target, i) => {
    const numSpan = target.querySelector(".pad-number");
    const userSpan = target.querySelector(".pad-user");
    target.classList.remove("win");

    if (i < list.length) {
      const b = list[i];
      target.dataset.number = String(b.number);
      if (numSpan) numSpan.textContent = b.number;
      if (userSpan) userSpan.textContent = b.username;
    } else {
      target.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

function ensureTargetForWinningNumber(winningNumber) {
  if (winningNumber === null || winningNumber === undefined) return;

  const existing = targets.find((t) => t.dataset.number === String(winningNumber));
  if (existing) return;

  const target = targets[0];
  if (!target) return;

  const numSpan = target.querySelector(".pad-number");
  const userSpan = target.querySelector(".pad-user");

  target.dataset.number = String(winningNumber);
  if (numSpan) numSpan.textContent = winningNumber;
  if (userSpan) userSpan.textContent = "";
}

function determineUserOutcome(table) {
  const result = table.result;
  const myBets = (table.bets || []).filter((b) => String(b.user_id) === String(USER_ID));
  if (!myBets.length) return { outcome: "none", result };

  const won = myBets.some((b) => String(b.number) === String(result));
  return { outcome: won ? "win" : "lose", result };
}

function showEndPopup(outcomeInfo) {
  if (!popupEl) return;

  const { outcome } = outcomeInfo;

  let title = "Game Finished";
  let message = "This game has ended. Please keep playing to keep your winning chances high.";

  if (outcome === "win") {
    title = "Congratulations!";
    message = "You have won the game. Please keep playing to keep your winning chances high.";
  } else if (outcome === "lose") {
    title = "Hard Luck!";
    message = "You have lost the game. Please keep playing to keep your winning chances high.";
  }

  if (popupTitleEl) popupTitleEl.textContent = title;
  if (popupMsgEl) popupMsgEl.textContent = message;

  popupEl.style.display = "flex";
}

function showSlotsFullPopup() {
  if (!popupEl) return;

  if (popupTitleEl) popupTitleEl.textContent = "All slots are full";
  if (popupMsgEl) popupMsgEl.textContent =
    "This game is already full. You will be redirected to lobby to join another table.";

  popupEl.style.display = "flex";
  setTimeout(() => window.history.back(), 2000);
}

function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  try {
    const url = new URL(window.location.href);
    const currentParam = url.searchParams.get("table");
    if (currentParam === roundCode) return;
    url.searchParams.set("table", roundCode);
    window.history.replaceState({}, "", url.toString());
    tableCodeFromUrl = roundCode;
  } catch (err) {
    console.warn("Unable to sync URL with table code", err);
  }
}

// ================= PROFESSIONAL ARROW SHOT =================
// Key improvements vs your current version:
// - Never moves the real #arrowSprite into the target (avoids "pasted" + broken next shot).
// - Uses a clone for flight and a second clone for the stuck arrow.
// - Rotates to follow the curve tangent (natural).
// - Anchors stick by arrow tip (transform-origin + translate).
// - Cancels previous shots cleanly.

let _shotToken = 0;
let _stuckArrows = [];

function ensureAnimStyles() {
  if (document.getElementById("diamond-shot-styles")) return;
  const style = document.createElement("style");
  style.id = "diamond-shot-styles";
  style.textContent = `
    @keyframes targetFlashRing {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
      35% { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.35); }
    }
  `;
  document.head.appendChild(style);
}

function clearStuckArrows() {
  _stuckArrows.forEach((el) => el.remove());
  _stuckArrows = [];
}

function resetArrowToBow() {
  if (!arrowImg) return;
  arrowImg.style.opacity = "1";
  arrowImg.style.transform = ""; // let CSS control idle state
  arrowImg.style.left = "";
  arrowImg.style.top = "";
  arrowImg.style.position = "";
  arrowImg.style.zIndex = "";

  // If old code ever moved it, put it back
  if (archerLayerEl && arrowImg.parentElement !== archerLayerEl) {
    archerLayerEl.appendChild(arrowImg);
  }
}

function flashTarget(target) {
  const ring = document.createElement("div");
  ring.style.position = "absolute";
  ring.style.left = "50%";
  ring.style.top = "50%";
  ring.style.width = "92%";
  ring.style.height = "92%";
  ring.style.borderRadius = "50%";
  ring.style.border = "2px solid rgba(56,189,248,0.9)";
  ring.style.boxShadow = "0 0 18px rgba(56,189,248,0.7)";
  ring.style.pointerEvents = "none";
  ring.style.animation = "targetFlashRing 420ms ease-out";
  ring.style.zIndex = "6";
  target.appendChild(ring);
  setTimeout(() => ring.remove(), 450);
}

function shootArrowToWinningNumber(winningNumber) {
  if (!rangeEl || !arrowImg || !archerImg) return;

  const target = targets.find((t) => t.dataset.number === String(winningNumber));
  if (!target) return;

  ensureAnimStyles();

  // cancel previous shots + remove prior stuck arrows (optional but cleaner)
  const token = ++_shotToken;
  clearStuckArrows();

  resetArrowToBow();

  const rangeRect = rangeEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const arrowRect = arrowImg.getBoundingClientRect();

  // Start near the arrow tip (right side of your arrow svg)
  const startX = (arrowRect.left + arrowRect.width * 0.88) - rangeRect.left;
  const startY = (arrowRect.top + arrowRect.height * 0.55) - rangeRect.top;

  // End near center of target
  const endX = (targetRect.left + targetRect.width * 0.52) - rangeRect.left;
  const endY = (targetRect.top + targetRect.height * 0.52) - rangeRect.top;

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);

  // Quadratic bezier control point (nice arc)
  const midX = (startX + endX) / 2;
  const lift = Math.min(170, Math.max(95, dist * 0.35));
  const ctrlX = midX;
  const ctrlY = Math.min(startY, endY) - lift;

  // Clone arrow for flight; keep original hidden so user sees 1 arrow only
  const flying = arrowImg.cloneNode(true);
  flying.removeAttribute("id");
  flying.style.position = "absolute";
  flying.style.left = "0px";
  flying.style.top = "0px";
  flying.style.width = (arrowRect.width || 52) + "px";
  flying.style.height = "auto";
  flying.style.pointerEvents = "none";
  flying.style.zIndex = "60";
  flying.style.willChange = "transform,left,top,filter";
  flying.style.filter = "drop-shadow(0 10px 14px rgba(0,0,0,0.7))";
  rangeEl.appendChild(flying);

  arrowImg.style.opacity = "0";

  // Archer pose
  archerImg.classList.add("shoot");
  setTimeout(() => archerImg.classList.remove("shoot"), 350);

  const duration = 720;
  const startTime = performance.now();

  const bezier = (t, p0, p1, p2) => {
    const u = 1 - t;
    return u * u * p0 + 2 * u * t * p1 + t * t * p2;
  };
  const bezierDeriv = (t, p0, p1, p2) => 2 * (1 - t) * (p1 - p0) + 2 * t * (p2 - p1);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function step(now) {
    if (token !== _shotToken) {
      flying.remove();
      arrowImg.style.opacity = "1";
      return;
    }

    const raw = (now - startTime) / duration;
    const tr = Math.min(Math.max(raw, 0), 1);
    const t = easeOutCubic(tr);

    const x = bezier(t, startX, ctrlX, endX);
    const y = bezier(t, startY, ctrlY, endY);

    // Rotate to match curve tangent (professional feel)
    const vx = bezierDeriv(t, startX, ctrlX, endX);
    const vy = bezierDeriv(t, startY, ctrlY, endY);
    const angle = Math.atan2(vy, vx) * (180 / Math.PI);

    // slight stability: a touch of wobble early only
    const wobble = (1 - t) * 1.7 * Math.sin(t * 10);

    flying.style.left = x + "px";
    flying.style.top = y + "px";
    flying.style.transform = `translate(-50%, -50%) rotate(${angle + wobble}deg)`;

    if (tr < 1) {
      requestAnimationFrame(step);
      return;
    }

    // Impact
    target.classList.add("win");
    flashTarget(target);

    // Remove flying arrow
    flying.remove();

    // Stick arrow inside target with tip anchoring
    const stickLeft = (rangeRect.left + endX) - targetRect.left;
    const stickTop = (rangeRect.top + endY) - targetRect.top;

    const stuck = arrowImg.cloneNode(true);
    stuck.removeAttribute("id");
    stuck.style.position = "absolute";
    stuck.style.left = stickLeft + "px";
    stuck.style.top = stickTop + "px";
    stuck.style.width = (arrowRect.width || 52) + "px";
    stuck.style.height = "auto";
    stuck.style.pointerEvents = "none";

    // IMPORTANT: keep it above target image but below pad text; your CSS originally uses z-index
    // (arrow had z-index: 4, targets z-index: 1) [file:102]
    stuck.style.zIndex = "3";

    // Tip anchor: arrow points to the right in your sprite, so tip is near 90–95% X.
    stuck.style.transformOrigin = "92% 50%";
    stuck.style.filter = "drop-shadow(0 10px 14px rgba(0,0,0,0.75))";
    stuck.style.transition = "transform 160ms ease-out";

    const finalAngle = angle + (-6 + Math.random() * 12);
    // translate(-92%, -50%) puts the TIP on the hit point, then translateX simulates penetration
    stuck.style.transform = `translate(-92%, -50%) rotate(${finalAngle}deg) translateX(10px)`;

    target.appendChild(stuck);
    _stuckArrows.push(stuck);

    requestAnimationFrame(() => {
      stuck.style.transform = `translate(-92%, -50%) rotate(${finalAngle}deg) translateX(0px)`;
    });

    // Restore idle arrow at bow
    arrowImg.style.opacity = "1";
  }

  requestAnimationFrame(step);
}

// ================= TIMER =================

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (gameFinished) return;
    if (displayRemainingSeconds > 0) {
      displayRemainingSeconds -= 1;
      renderTimer();
    }
  }, 1000);
}

// ================= POLLING =================

async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/diamond");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let table = null;

    if (tableCodeFromUrl) {
      table = data.tables.find((t) => t.round_code === tableCodeFromUrl) || null;

      if (!table) {
        gameFinished = true;
        disableBettingUI();
        if (tablePollInterval) clearInterval(tablePollInterval);
        if (localTimerInterval) clearInterval(localTimerInterval);

        setStatus("This game has finished. You'll be taken back to lobby to join a new one.", "error");
        setTimeout(() => window.history.back(), 2000);
        return;
      }
    } else {
      table = data.tables[0];
      syncUrlWithTable(table.round_code);
    }

    currentTable = table;
    updateGameUI(table);
  } catch (err) {
    console.error("fetchTableData error", err);
  }
}

function updateGameUI(table) {
  if (!table) return;

  if (roundIdSpan) roundIdSpan.textContent = table.round_code || "-";

  displayRemainingSeconds = table.time_remaining || 0;
  renderTimer();

  if (table.bets && Array.isArray(table.bets)) {
    updateTargetsFromBets(table.bets);
    updateMyBets(table.bets);
    if (playerCountSpan) playerCountSpan.textContent = table.bets.length;
  }

  if (placeBetBtn && !gameFinished) {
    const maxPlayers = typeof table.max_players === "number" ? table.max_players : null;
    const slotsFull = !!table.is_full || (maxPlayers !== null && table.players >= maxPlayers);
    placeBetBtn.disabled = !!table.is_betting_closed || !!table.is_finished || slotsFull;
  }

  if (displayRemainingSeconds <= 10) timerPill && timerPill.classList.add("urgent");
  else timerPill && timerPill.classList.remove("urgent");

  const maxPlayers = typeof table.max_players === "number" ? table.max_players : null;
  const isFull = table.is_full === true || (maxPlayers !== null && table.players >= maxPlayers);

  if (!gameFinished && !userHasBet && isFull) {
    gameFinished = true;
    disableBettingUI();
    if (tablePollInterval) clearInterval(tablePollInterval);
    if (localTimerInterval) clearInterval(localTimerInterval);
    showSlotsFullPopup();
    return;
  }

  const hasResult = table.result !== null && table.result !== undefined && table.result !== "";

  if (hasResult && table.result !== lastResultShown) {
    lastResultShown = table.result;

    setStatus(`Winning number: ${table.result}`, "ok");
    ensureTargetForWinningNumber(table.result);
    shootArrowToWinningNumber(table.result);

    if (!gameFinished) {
      gameFinished = true;
      disableBettingUI();
      if (tablePollInterval) clearInterval(tablePollInterval);
      if (localTimerInterval) clearInterval(localTimerInterval);

      const outcomeInfo = determineUserOutcome(table);
      setTimeout(() => showEndPopup(outcomeInfo), 1000);
    }
  } else if (!hasResult) {
    lastResultShown = null;
    // If you ever decide not to finish the game and keep polling,
    // this keeps visuals clean for a new round:
    clearStuckArrows();
    resetArrowToBow();
  }
}

function startPolling() {
  fetchTableData();
  if (tablePollInterval) clearInterval(tablePollInterval);
  tablePollInterval = setInterval(() => {
    if (!gameFinished) fetchTableData();
  }, 2000);
}

// ================= SOCKET =================

const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const data = await res.json();
    if (typeof data.balance === "number") updateWallet(data.balance);
  } catch (err) {
    console.error("balance fetch error", err);
  }
}

function joinGameRoom() {
  socket.emit("join_game", { game_type: GAME, user_id: USER_ID });
}

socket.on("connect", () => {
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

socket.on("connect_error", (error) => console.error("[socket] CONNECTION ERROR:", error));
socket.on("disconnect", () => {});

// ✅ LISTEN FOR OWN BET SUCCESS
socket.on("bet_success", (payload) => {
  if (gameFinished) return;

  userHasBet = true;
  setStatus(payload.message || "Bet placed ✓", "ok");

  if (typeof payload.new_balance === "number") updateWallet(payload.new_balance);

  if (payload.players && Array.isArray(payload.players)) {
    updateTargetsFromBets(payload.players);
    updateMyBets(payload.players);
    if (playerCountSpan) playerCountSpan.textContent = payload.players.length;
  }
});

// ✅ LISTEN FOR BROADCAST TABLE UPDATES
socket.on("update_table", (payload) => {
  if (gameFinished) return;

  if (payload.players && Array.isArray(payload.players)) {
    updateTargetsFromBets(payload.players);
    updateMyBets(payload.players);
    if (playerCountSpan) playerCountSpan.textContent = payload.players.length;
  }

  if (payload.time_remaining != null) {
    displayRemainingSeconds = payload.time_remaining;
    renderTimer();
  }

  if (payload.is_betting_closed) disableBettingUI();
});

// ✅ LISTEN FOR BET ERRORS
socket.on("bet_error", (payload) => {
  if (gameFinished) return;
  setStatus(payload.message || "Bet error", "error");
});

// ================= UI EVENTS =================

numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (gameFinished) return;
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    if (gameFinished) {
      setStatus("This game has already finished.", "error");
      return;
    }

    if (!currentTable) {
      setStatus("Game is not ready yet. Please wait...", "error");
      return;
    }

    const maxPlayers = typeof currentTable.max_players === "number" ? currentTable.max_players : null;
    const slotsFull = currentTable.is_full === true || (maxPlayers !== null && currentTable.players >= maxPlayers);

    if (slotsFull) {
      setStatus("All slots are full for this game.", "error");
      disableBettingUI();
      return;
    }

    if (walletBalance < FIXED_BET_AMOUNT) {
      setStatus("Insufficient balance", "error");
      return;
    }

    if (selectedNumber === null || selectedNumber === undefined) {
      setStatus("Select a number first", "error");
      return;
    }

    socket.emit("place_bet", {
      game_type: GAME,
      user_id: USER_ID,
      username: USERNAME,
      number: selectedNumber,
    });
  });
}

if (popupHomeBtn) popupHomeBtn.addEventListener("click", () => (window.location.href = HOME_URL));
if (popupLobbyBtn) popupLobbyBtn.addEventListener("click", () => window.history.back());

// ================= INIT =================

fetchBalance();
startPolling();
startLocalTimer();
setSelectedNumber(0);
setStatus("");
