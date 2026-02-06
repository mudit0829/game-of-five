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

// ================= ARROW + DOTTED PATH (PRO) =================

let _shotToken = 0;
let _stuckArrows = [];
let _shotSvg = null;

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

    @keyframes diamondPathIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes diamondPathOut { to { opacity: 0; } }
    @keyframes diamondDash { to { stroke-dashoffset: -26; } }
  `;
  document.head.appendChild(style);
}

function clearStuckArrows() {
  _stuckArrows.forEach((el) => el.remove());
  _stuckArrows = [];
}

function ensureShotSvg() {
  if (!rangeEl) return null;
  if (_shotSvg && _shotSvg.isConnected) return _shotSvg;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";

  // Keep it visible over background/targets. (Arrow clones use much higher z-index.) [file:102]
  svg.style.zIndex = "2";

  rangeEl.appendChild(svg);
  _shotSvg = svg;
  return svg;
}

function clearShotPath() {
  if (_shotSvg) _shotSvg.innerHTML = "";
}

function drawShotPath(rangeRect, startX, startY, ctrlX, ctrlY, endX, endY) {
  const svg = ensureShotSvg();
  if (!svg) return;

  svg.setAttribute("viewBox", `0 0 ${rangeRect.width} ${rangeRect.height}`);
  svg.innerHTML = "";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "rgba(226,232,240,0.70)");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-dasharray", "2 10");
  path.style.filter = "drop-shadow(0 8px 12px rgba(0,0,0,0.55))";

  // Fade in quickly, animate dash while arrow is flying, then fade out
  path.style.animation =
    "diamondPathIn 140ms ease-out, diamondDash 520ms linear infinite, diamondPathOut 520ms ease-in 280ms forwards";

  svg.appendChild(path);
}

function resetArrowToBow() {
  if (!arrowImg) return;
  arrowImg.style.opacity = "1";
  arrowImg.style.transform = "";
  arrowImg.style.left = "";
  arrowImg.style.top = "";
  arrowImg.style.position = "";
  arrowImg.style.zIndex = "";

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

  // cancel previous shot
  const token = ++_shotToken;

  clearStuckArrows();
  clearShotPath();
  resetArrowToBow();

  const rangeRect = rangeEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const arrowRect = arrowImg.getBoundingClientRect();

  // Start near the arrow tip (right side)
  const startX = (arrowRect.left + arrowRect.width * 0.88) - rangeRect.left;
  const startY = (arrowRect.top + arrowRect.height * 0.55) - rangeRect.top;

  // End near center of target
  const endX = (targetRect.left + targetRect.width * 0.52) - rangeRect.left;
  const endY = (targetRect.top + targetRect.height * 0.52) - rangeRect.top;

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);

  // ✅ Gentle arc (prevents that "jump up" look)
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const lift = Math.min(80, Math.max(28, dist * 0.14));
  const ctrlX = midX;
  const ctrlY = midY - lift;

  // Dotted guide path (like gold game)
  drawShotPath(rangeRect, startX, startY, ctrlX, ctrlY, endX, endY);

  // Clone arrow for flight; keep original hidden
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
  flying.style.filter = "drop-shadow(0 10px 14px rgba(0,0,0,0.70))";
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

  const aimAngle = Math.atan2(dy, dx) * (180 / Math.PI);

  function step(now) {
    if (token !== _shotToken) {
      flying.remove();
      arrowImg.style.opacity = "1";
      clearShotPath();
      return;
    }

    const raw = (now - startTime) / duration;
    const tr = Math.min(Math.max(raw, 0), 1);
    const t = easeOutCubic(tr);

    const x = bezier(t, startX, ctrlX, endX);
    const y = bezier(t, startY, ctrlY, endY);

    // Tangent angle along the curve
    const vx = bezierDeriv(t, startX, ctrlX, endX);
    const vy = bezierDeriv(t, startY, ctrlY, endY);
    const tangentAngle = Math.atan2(vy, vx) * (180 / Math.PI);

    // ✅ Smooth rotation blending: avoids instant “flip up”
    const mix = Math.min(1, t * 1.15);
    const angle = aimAngle + (tangentAngle - aimAngle) * mix;

    // Subtle scale for depth (optional but looks premium)
    const scale = 1 - t * 0.08;

    flying.style.left = x + "px";
    flying.style.top = y + "px";
    flying.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;

    if (tr < 1) {
      requestAnimationFrame(step);
      return;
    }

    // Impact
    clearShotPath();
    target.classList.add("win");
    flashTarget(target);

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
    stuck.style.zIndex = "3";
    stuck.style.transformOrigin = "92% 50%";
    stuck.style.filter = "drop-shadow(0 10px 14px rgba(0,0,0,0.75))";
    stuck.style.transition = "transform 160ms ease-out";

    const finalAngle = angle + (-6 + Math.random() * 12);
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
    clearStuckArrows();
    clearShotPath();
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
