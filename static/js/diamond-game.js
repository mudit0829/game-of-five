// ================= BASIC SETUP =================

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

// ================= SHOT CONFIG =================

// Adjust ONLY if you want tip-perfect hit.
// If your arrow PNG has a lot of transparent space, these ratios change the anchor.
const TIP_X_RATIO = 0.90;
const TIP_Y_RATIO = 0.52;

// 50% slower than old 720ms
const SHOT_DURATION_MS = 1080;

// Freeze target rendering while shot runs (prevents path/arrow mismatch after reflow)
let _shotInProgress = false;

// ================= TARGETS =================

function updateTargetsFromBets(bets) {
  // ✅ Do not move/replace pads while arrow is flying
  if (_shotInProgress) return;

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

// ================= ARROW + DOTTED PATH (LOCKED) =================

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

  // make sure .range is positioning context
  try {
    const pos = getComputedStyle(rangeEl).position;
    if (pos === "static") rangeEl.style.position = "relative";
  } catch {}

  if (_shotSvg && _shotSvg.isConnected) return _shotSvg;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "2";

  rangeEl.appendChild(svg);
  _shotSvg = svg;
  return svg;
}

function clearShotPath() {
  if (_shotSvg) _shotSvg.innerHTML = "";
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

function drawShotPath(rangeW, rangeH, startX, startY, ctrlX, ctrlY, endX, endY, flightMs) {
  const svg = ensureShotSvg();
  if (!svg) return null;

  svg.setAttribute("viewBox", `0 0 ${rangeW} ${rangeH}`);
  svg.innerHTML = "";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "rgba(226,232,240,0.70)");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-dasharray", "2 10");
  path.style.filter = "drop-shadow(0 8px 12px rgba(0,0,0,0.55))";

  const fadeIn = 160;
  const fadeOut = Math.max(320, Math.round(flightMs * 0.40));
  const fadeOutDelay = Math.max(0, flightMs - fadeOut);

  path.style.animation =
    `diamondPathIn ${fadeIn}ms ease-out, ` +
    `diamondDash ${flightMs}ms linear infinite, ` +
    `diamondPathOut ${fadeOut}ms ease-in ${fadeOutDelay}ms forwards`;

  svg.appendChild(path);
  return path;
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

function shootArrowToWinningNumber(winningNumber) {
  if (!rangeEl || !arrowImg || !archerImg) return;

  const target = targets.find((t) => t.dataset.number === String(winningNumber));
  if (!target) return;

  ensureAnimStyles();

  const token = ++_shotToken;

  _shotInProgress = true;

  clearStuckArrows();
  clearShotPath();
  resetArrowToBow();

  const rangeRect = rangeEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const arrowRect = arrowImg.getBoundingClientRect();

  const rangeW = Math.max(1, rangeEl.clientWidth || Math.round(rangeRect.width));
  const rangeH = Math.max(1, rangeEl.clientHeight || Math.round(rangeRect.height));

  const scaleX = (rangeRect.width / rangeW) || 1;
  const scaleY = (rangeRect.height / rangeH) || 1;

  const toLocal = (clientX, clientY) => ({
    x: (clientX - rangeRect.left) / scaleX,
    y: (clientY - rangeRect.top) / scaleY,
  });

  // Arrow layout size (stable)
  const arrowW = arrowImg.offsetWidth || Math.max(1, arrowRect.width / scaleX);
  const arrowH = arrowImg.offsetHeight || Math.max(14, arrowRect.height / scaleY);

  // Anchor inside arrow (tip)
  const ax = arrowW * TIP_X_RATIO;
  const ay = arrowH * TIP_Y_RATIO;

  // Start (tip) from current arrow location
  const startLocal = toLocal(
    arrowRect.left + arrowRect.width * TIP_X_RATIO,
    arrowRect.top + arrowRect.height * TIP_Y_RATIO
  );
  const startX = startLocal.x;
  const startY = startLocal.y;

  // End at target center
  const endLocal = toLocal(
    targetRect.left + targetRect.width * 0.5,
    targetRect.top + targetRect.height * 0.5
  );
  const endX = endLocal.x;
  const endY = endLocal.y;

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);

  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const lift = Math.min(90, Math.max(32, dist * 0.16));
  const ctrlX = midX;
  const ctrlY = midY - lift;

  const pathEl = drawShotPath(rangeW, rangeH, startX, startY, ctrlX, ctrlY, endX, endY, SHOT_DURATION_MS);
  if (!pathEl) {
    _shotInProgress = false;
    return;
  }

  // Flying arrow clone
  const flying = arrowImg.cloneNode(true);
  flying.removeAttribute("id");
  flying.style.position = "absolute";
  flying.style.left = "0px";
  flying.style.top = "0px";
  flying.style.width = arrowW + "px";
  flying.style.height = "auto";
  flying.style.pointerEvents = "none";
  flying.style.zIndex = "60";
  flying.style.willChange = "transform";
  flying.style.filter = "drop-shadow(0 10px 14px rgba(0,0,0,0.70))";
  flying.style.transformOrigin = `${ax}px ${ay}px`;

  rangeEl.appendChild(flying);
  arrowImg.style.opacity = "0";

  archerImg.classList.add("shoot");
  setTimeout(() => archerImg.classList.remove("shoot"), 350);

  const totalLen = pathEl.getTotalLength();
  const startTime = performance.now();

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function step(now) {
    if (token !== _shotToken) {
      flying.remove();
      arrowImg.style.opacity = "1";
      clearShotPath();
      _shotInProgress = false;
      return;
    }

    const tr = Math.min(Math.max((now - startTime) / SHOT_DURATION_MS, 0), 1);
    const t = easeOutCubic(tr);

    const L = t * totalLen;
    const p = pathEl.getPointAtLength(L); // same path, so always synced

    const eps = 0.9;
    const p2 = pathEl.getPointAtLength(Math.min(totalLen, L + eps));
    const angle = Math.atan2(p2.y - p.y, p2.x - p.x) * (180 / Math.PI);

    const scale = 1 - t * 0.08;

    flying.style.transform =
      `translate(${p.x - ax}px, ${p.y - ay}px) rotate(${angle}deg) scale(${scale})`;

    if (tr < 1) {
      requestAnimationFrame(step);
      return;
    }

    // Finish
    flying.remove();
    clearShotPath();

    // highlight correct target
    target.classList.add("win");
    flashTarget(target);

    // ✅ Stick arrow at EXACT endpoint in range (not inside target)
    const stuck = arrowImg.cloneNode(true);
    stuck.removeAttribute("id");
    stuck.style.position = "absolute";
    stuck.style.left = "0px";
    stuck.style.top = "0px";
    stuck.style.width = arrowW + "px";
    stuck.style.height = "auto";
    stuck.style.pointerEvents = "none";
    stuck.style.zIndex = "55";
    stuck.style.transformOrigin = `${ax}px ${ay}px`;
    stuck.style.filter = "drop-shadow(0 10px 14px rgba(0,0,0,0.75))";
    stuck.style.transition = "transform 160ms ease-out";

    const finalAngle = angle + (-6 + Math.random() * 12);
    stuck.style.transform = `translate(${endX - ax}px, ${endY - ay}px) rotate(${finalAngle}deg) translateX(10px)`;

    rangeEl.appendChild(stuck);
    _stuckArrows.push(stuck);

    requestAnimationFrame(() => {
      stuck.style.transform = `translate(${endX - ax}px, ${endY - ay}px) rotate(${finalAngle}deg) translateX(0px)`;
    });

    arrowImg.style.opacity = "1";
    _shotInProgress = false;
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

    // If a request returns after game is finished, ignore it
    if (gameFinished) return;

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

  // ✅ Freeze target updates while shot is running
  if (!_shotInProgress && table.bets && Array.isArray(table.bets)) {
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

    if (!_shotInProgress) {
      ensureTargetForWinningNumber(table.result);
      shootArrowToWinningNumber(table.result);
    }

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

socket.on("bet_success", (payload) => {
  if (gameFinished) return;

  userHasBet = true;
  setStatus(payload.message || "Bet placed ✓", "ok");

  if (typeof payload.new_balance === "number") updateWallet(payload.new_balance);

  if (!_shotInProgress && payload.players && Array.isArray(payload.players)) {
    updateTargetsFromBets(payload.players);
    updateMyBets(payload.players);
    if (playerCountSpan) playerCountSpan.textContent = payload.players.length;
  }
});

socket.on("update_table", (payload) => {
  if (gameFinished) return;

  if (!_shotInProgress && payload.players && Array.isArray(payload.players)) {
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
