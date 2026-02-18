// ================== BASIC SETUP ==================

const GAME = GAME_TYPE || "platinum";

// --- multi-table: read table code from URL, keep it in a mutable variable ---
const urlParams = new URLSearchParams(window.location.search);
let tableCodeFromUrl = urlParams.get("table") || null;

// real logged-in user from Flask session
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// ✅ SAME AS GOLD/SILVER
const MAX_BETS_PER_ROUND = 3;

// ================= AUDIO + VIBRATION (NEW) =================
// Autoplay with sound is usually blocked until the user interacts once. [web:392]
const BG_AUDIO_SRC = "/static/audio/platinum.mp3";
const RESULT_AUDIO_SRC = "/static/audio/result.mp3";

const bgAudio = new Audio(BG_AUDIO_SRC);
bgAudio.loop = true;
bgAudio.preload = "auto";
bgAudio.volume = 0.7;

const resultAudio = new Audio(RESULT_AUDIO_SRC);
resultAudio.loop = false;
resultAudio.preload = "auto";
resultAudio.volume = 1.0;

let audioUnlocked = false;
let bgRoundCodePlaying = null;
let resultTriggeredForRound = null;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // Prime both audio elements (best effort)
  try {
    bgAudio.play().then(() => {
      bgAudio.pause();
      bgAudio.currentTime = 0;
    }).catch(() => {});
  } catch (e) {}

  try {
    resultAudio.play().then(() => {
      resultAudio.pause();
      resultAudio.currentTime = 0;
    }).catch(() => {});
  } catch (e) {}
}

["pointerdown", "touchstart", "mousedown", "keydown"].forEach((evt) => {
  window.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
});

function stopPlatinumLoop() {
  try {
    if (!bgAudio.paused) bgAudio.pause();
    bgAudio.currentTime = 0;
  } catch (e) {}
}

function startPlatinumLoopIfAllowed(roundCode, hasResultOrFinished) {
  if (!audioUnlocked) return;
  if (!roundCode) return;
  if (hasResultOrFinished) return;

  if (bgRoundCodePlaying !== roundCode) {
    bgRoundCodePlaying = roundCode;
    resultTriggeredForRound = null; // allow result sfx again for new round
    stopPlatinumLoop();
  }

  if (bgAudio.paused) {
    bgAudio.currentTime = 0;
    bgAudio.play().catch(() => {});
  }
}

function playResultSoundOnce(roundCode) {
  if (!audioUnlocked) return;
  if (!roundCode) return;
  if (resultTriggeredForRound === roundCode) return;

  resultTriggeredForRound = roundCode;

  stopPlatinumLoop();
  try {
    resultAudio.currentTime = 0;
    resultAudio.play().catch(() => {});
  } catch (e) {}
}

// Vibrate requires supported device/browser and user activation. [web:384]
function vibrateOnResult() {
  try {
    if ("vibrate" in navigator) navigator.vibrate([120, 60, 120]);
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlatinumLoop();
});

// ================== DOM REFERENCES ==================

const roundCodeSpan = document.getElementById("roundCode");
const playerCountSpan = document.getElementById("playerCount");
const userNameLabel = document.getElementById("userName");
const userBetsLabel = document.getElementById("userBets");
const timerText = document.getElementById("timerText");
const timerPill = document.querySelector(".timer-pill");
const walletBalanceSpan = document.getElementById("walletBalance");
const coinsWrapper = document.querySelector(".coins");

const boats = Array.from(document.querySelectorAll(".boat"));
const myBetsContainer = document.getElementById("myBetsContainer");
const placeBetBtn = document.getElementById("placeBetBtn");
const statusEl = document.getElementById("statusMessage");

// Paratrooper image element
const paratrooper = document.getElementById("paratrooperSprite");

// Make sure paratrooper starts hidden & off-screen
if (paratrooper) {
  paratrooper.style.opacity = "0";
  paratrooper.style.top = "-260px";
  paratrooper.style.left = "50%";
  paratrooper.style.transform = "translate(-50%, -50%)";
  paratrooper.style.transition = "none";
}

if (userNameLabel) userNameLabel.textContent = USERNAME;

// ================== STATE ==================

let walletBalance = 0;
let selectedNumber = 0;

let currentTable = null;
let gameFinished = false;
let tablePollInterval = null;

let resultAnimationShownForRound = null;
let resultModalShownForRound = null;
let kickedForNoBet = false;

// Used to delay popup until paratrooper lands
let paratrooperLandingETA = 0;

// ---------- Stable boat slot order per round ----------
let boatOrderRoundCode = null;
let boatBetKeyOrder = [];
let boatBetKeyToBet = new Map();

function getBetKey(b) {
  return `${String(b?.userId)}|${String(b?.number)}`;
}

function resetBoatOrderForRound(roundCode) {
  boatOrderRoundCode = roundCode || "__no_round__";
  boatBetKeyOrder = [];
  boatBetKeyToBet = new Map();
}

// ================== SMALL UTILITIES ==================

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function toBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTable(table) {
  if (!table) return null;

  const t = { ...table };

  t.roundCode = pick(table, "round_code", "roundcode");
  t.timeRemaining = safeNum(pick(table, "time_remaining", "timeremaining"), 0);
  t.isFinished = toBool(pick(table, "is_finished", "isfinished"));
  t.isBettingClosed = toBool(pick(table, "is_betting_closed", "isbettingclosed"));

  t.slotsAvailable = pick(table, "slots_available", "slotsavailable");
  t.maxPlayers = pick(table, "max_players", "maxplayers");
  t.playersCount = safeNum(pick(table, "players"), 0);

  t.bets = Array.isArray(table.bets)
    ? table.bets.map((b) => ({
        ...b,
        userId: pick(b, "user_id", "userid"),
        username: pick(b, "username") || "Player",
        number: pick(b, "number"),
      }))
    : [];

  t.resultValue = pick(table, "result");
  t.isFull = toBool(pick(table, "is_full", "isfull"));

  return t;
}

function hashToIndex(str, mod) {
  const s = String(str ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod > 0 ? (h % mod) : 0;
}

// ================== UI HELPERS ==================

function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = safeNum(balance, 0);
  if (walletBalanceSpan) walletBalanceSpan.textContent = walletBalance.toFixed(0);

  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function setSelectedNumber(n) {
  selectedNumber = n;
  document.querySelectorAll(".num-chip").forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

// ✅ same “locked fallback” approach as gold
function setNumberChipsDisabled(disabled) {
  const d = !!disabled;
  document.querySelectorAll(".num-chip").forEach((chip) => {
    try { chip.disabled = d; } catch (e) {}
    chip.dataset.locked = d ? "1" : "0";
    chip.classList.toggle("locked", d);
    if (d) chip.classList.remove("selected");
  });
}

function disableBettingUI(disableNumbers = true) {
  if (placeBetBtn) placeBetBtn.disabled = true;
  if (disableNumbers) setNumberChipsDisabled(true);
}

function countMyBetsFromTable(table) {
  const list = (table?.bets || []).filter((b) => String(b.userId) === String(USER_ID));
  return list.length;
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => String(b.userId) === String(USER_ID));

  if (userBetsLabel) userBetsLabel.textContent = myBets.length;

  if (!myBetsContainer) return myBets;
  myBetsContainer.innerHTML = "";

  if (myBets.length === 0) {
    const span = document.createElement("span");
    span.style.color = "#6b7280";
    span.style.fontSize = "11px";
    span.textContent = "none";
    myBetsContainer.appendChild(span);
    return myBets;
  }

  myBets.forEach((b) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsContainer.appendChild(chip);
  });

  return myBets;
}

// ---------- UPDATED: boats show bets in "first available boat" order ----------
function updateBoatsFromBets(bets, roundCode = "") {
  const rc = roundCode || "__no_round__";
  if (boatOrderRoundCode !== rc) resetBoatOrderForRound(rc);

  const currentMap = new Map();
  (bets || []).forEach((b) => {
    const key = getBetKey(b);
    currentMap.set(key, b);

    if (!boatBetKeyToBet.has(key) && !boatBetKeyOrder.includes(key)) {
      boatBetKeyOrder.push(key);
    }
  });

  boatBetKeyOrder = boatBetKeyOrder.filter((k) => currentMap.has(k));
  boatBetKeyToBet = currentMap;

  const keysToShow = boatBetKeyOrder.slice(0, 6);

  boats.forEach((boat, i) => {
    const numSpan = boat.querySelector(".boat-number");
    const userSpan = boat.querySelector(".boat-user");
    boat.classList.remove("win");
    boat.style.animation = "";

    if (i < keysToShow.length) {
      const bet = boatBetKeyToBet.get(keysToShow[i]);
      const number = bet?.number;

      boat.dataset.number = String(number ?? "");
      if (numSpan) numSpan.textContent = String(number ?? "");
      if (userSpan) userSpan.textContent = bet?.username || "";
    } else {
      boat.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

function ensureBoatForWinningNumber(winningNumber, roundCode = "") {
  if (winningNumber === null || winningNumber === undefined) return;
  if (!boats || boats.length === 0) return;

  const existing = boats.find((b) => String(b.dataset.number) === String(winningNumber));
  if (existing) return;

  let boat = boats.find((b) => !b.dataset.number || b.dataset.number === "");
  if (!boat) {
    const idx = hashToIndex(`${roundCode}|${winningNumber}`, boats.length);
    boat = boats[idx] || boats[0];
  }

  if (!boat) return;

  const numSpan = boat.querySelector(".boat-number");
  const userSpan = boat.querySelector(".boat-user");

  boat.dataset.number = String(winningNumber);
  if (numSpan) numSpan.textContent = String(winningNumber);
  if (userSpan) userSpan.textContent = "";
}

// ============== URL SYNC WITH TABLE CODE ==============

function syncUrlWithTable(roundCode) {
  if (!roundCode) return;
  const url = new URL(window.location.href);
  url.searchParams.set("table", roundCode);
  window.history.replaceState({}, "", url.toString());
  tableCodeFromUrl = roundCode;
}

// ============== POPUP MODALS ==============
// (unchanged)
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(15,23,42,0.85)";
  overlay.style.backdropFilter = "blur(6px)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";
  return overlay;
}

function showResultModal({ title, message, onHome, onLobby }) {
  const overlay = createOverlay();

  const card = document.createElement("div");
  card.style.width = "90%";
  card.style.maxWidth = "360px";
  card.style.background = "radial-gradient(circle at top, #020617, #020617 60%, #000 100%)";
  card.style.borderRadius = "20px";
  card.style.padding = "18px 16px 14px";
  card.style.boxShadow = "0 20px 50px rgba(0,0,0,0.9)";
  card.style.border = "1px solid rgba(148,163,184,0.4)";
  card.style.color = "#e5e7eb";
  card.style.textAlign = "center";

  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  titleEl.style.fontSize = "18px";
  titleEl.style.fontWeight = "800";
  titleEl.style.marginBottom = "6px";

  const msgEl = document.createElement("div");
  msgEl.textContent = message;
  msgEl.style.fontSize = "13px";
  msgEl.style.color = "#cbd5e1";
  msgEl.style.marginBottom = "14px";

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "10px";
  btnRow.style.justifyContent = "center";

  const homeBtn = document.createElement("button");
  homeBtn.textContent = "Home Page";
  homeBtn.style.flex = "1";
  homeBtn.style.padding = "10px 0";
  homeBtn.style.borderRadius = "999px";
  homeBtn.style.border = "none";
  homeBtn.style.fontWeight = "700";
  homeBtn.style.fontSize = "14px";
  homeBtn.style.cursor = "pointer";
  homeBtn.style.background = "linear-gradient(135deg, #22c55e, #16a34a, #15803d)";
  homeBtn.style.color = "#020617";
  homeBtn.onclick = () => {
    document.body.removeChild(overlay);
    if (typeof onHome === "function") onHome();
  };

  const lobbyBtn = document.createElement("button");
  lobbyBtn.textContent = "Platinum Lobby";
  lobbyBtn.style.flex = "1";
  lobbyBtn.style.padding = "10px 0";
  lobbyBtn.style.borderRadius = "999px";
  lobbyBtn.style.border = "1px solid rgba(148,163,184,0.6)";
  lobbyBtn.style.fontWeight = "700";
  lobbyBtn.style.fontSize = "14px";
  lobbyBtn.style.cursor = "pointer";
  lobbyBtn.style.background = "rgba(15,23,42,0.9)";
  lobbyBtn.style.color = "#e5e7eb";
  lobbyBtn.onclick = () => {
    document.body.removeChild(overlay);
    if (typeof onLobby === "function") onLobby();
  };

  btnRow.appendChild(homeBtn);
  btnRow.appendChild(lobbyBtn);

  card.appendChild(titleEl);
  card.appendChild(msgEl);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function showFullSlotAndGoBack(messageText) {
  if (kickedForNoBet) return;
  kickedForNoBet = true;

  const overlay = createOverlay();

  const card = document.createElement("div");
  card.style.width = "90%";
  card.style.maxWidth = "340px";
  card.style.background = "radial-gradient(circle at top, #020617, #020617 60%, #000 100%)";
  card.style.borderRadius = "20px";
  card.style.padding = "18px 16px 14px";
  card.style.boxShadow = "0 20px 50px rgba(0,0,0,0.9)";
  card.style.border = "1px solid rgba(248,113,113,0.5)";
  card.style.color = "#e5e7eb";
  card.style.textAlign = "center";

  const titleEl = document.createElement("div");
  titleEl.textContent = "All slots are full";
  titleEl.style.fontSize = "17px";
  titleEl.style.fontWeight = "800";
  titleEl.style.color = "#fca5a5";
  titleEl.style.marginBottom = "6px";

  const msgEl = document.createElement("div");
  msgEl.textContent =
    messageText ||
    "This game is full and you have no active bet. We'll take you back to lobby for an available table.";
  msgEl.style.fontSize = "13px";
  msgEl.style.color = "#e5e7eb";
  msgEl.style.marginBottom = "14px";

  const btn = document.createElement("button");
  btn.textContent = "Back to Platinum Lobby";
  btn.style.display = "block";
  btn.style.width = "100%";
  btn.style.padding = "10px 0";
  btn.style.borderRadius = "999px";
  btn.style.border = "none";
  btn.style.fontWeight = "700";
  btn.style.fontSize = "14px";
  btn.style.cursor = "pointer";
  btn.style.background = "linear-gradient(135deg, #f97316, #ea580c, #b91c1c)";
  btn.style.color = "#020617";
  btn.onclick = () => {
    document.body.removeChild(overlay);
    window.location.href = "/game/platinum";
  };

  card.appendChild(titleEl);
  card.appendChild(msgEl);
  card.appendChild(btn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============== PARATROOPER ANIMATION ==============
// (unchanged)
function ensureParatrooperAnimationStyles() {
  if (document.getElementById("paratrooper-anim-styles")) return;

  const style = document.createElement("style");
  style.id = "paratrooper-anim-styles";
  style.textContent = `
    @keyframes paratrooperLand {
      0% { transform: translate(-50%, -50%) scale(1) rotateZ(0deg); }
      85% { transform: translate(-50%, -50%) scale(1.05) rotateZ(2deg); }
      100% { transform: translate(-50%, -50%) scale(0.95) rotateZ(-1deg); }
    }
    @keyframes boatBounce {
      0% { transform: translateY(0); }
      25% { transform: translateY(-8px); }
      50% { transform: translateY(0); }
      75% { transform: translateY(-4px); }
      100% { transform: translateY(0); }
    }
    @keyframes boatGlow {
      0% { box-shadow: 0 0 0 rgba(34, 197, 94, 0); }
      50% { box-shadow: 0 0 30px 10px rgba(34, 197, 94, 0.6); }
      100% { box-shadow: 0 0 0 rgba(34, 197, 94, 0); }
    }
  `;
  document.head.appendChild(style);
}

function dropParatrooperToWinningNumber(winningNumber, durationMs = 2000) {
  if (!paratrooper) return;

  const targetBoat = boats.find((b) => String(b.dataset.number) === String(winningNumber));
  if (!targetBoat) {
    console.log("Winning number not on any boat:", winningNumber);
    return;
  }

  ensureParatrooperAnimationStyles();

  const boatRect = targetBoat.getBoundingClientRect();

  const targetX = boatRect.left + boatRect.width / 2;
  const targetY = boatRect.top + boatRect.height / 2;

  const startY = -220;
  const startX = window.innerWidth / 2;

  const duration = Math.max(900, Math.min(2600, Number(durationMs) || 2000));
  const startTime = performance.now();

  paratrooperLandingETA = Date.now() + duration;

  paratrooper.style.transition = "none";
  paratrooper.style.opacity = "1";
  paratrooper.style.top = `${startY}px`;
  paratrooper.style.left = `${startX}px`;
  paratrooper.style.transform = "translate(-50%, -50%) scale(1)";
  paratrooper.style.animation = "none";

  function step(now) {
    const elapsed = now - startTime;
    const tRaw = elapsed / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    const ease = 1 - Math.pow(1 - t, 3);

    const currentX = startX + (targetX - startX) * ease;
    const currentY = startY + (targetY - startY) * ease;

    const scale = 1 - t * 0.15;

    paratrooper.style.top = `${currentY}px`;
    paratrooper.style.left = `${currentX}px`;
    paratrooper.style.transform = `translate(-50%, -50%) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      paratrooper.style.animation = "paratrooperLand 0.5s ease-out forwards";
      targetBoat.classList.add("win");
      targetBoat.style.animation = "boatBounce 0.6s ease-in-out, boatGlow 0.8s ease-out";

      setTimeout(() => {
        paratrooper.style.transition = "opacity 0.5s ease-out, top 0.6s ease-out";
        paratrooper.style.opacity = "0";
        paratrooper.style.top = "-260px";

        setTimeout(() => {
          paratrooper.style.transition = "none";
          paratrooper.style.animation = "none";
        }, 650);
      }, 900);
    }
  }

  requestAnimationFrame(step);
}

// ================== BACKEND SYNC (TABLES) ==================

async function fetchTableData() {
  if (gameFinished) return;

  try {
    const res = await fetch("/api/tables/platinum");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let rawTable = null;

    if (tableCodeFromUrl) {
      rawTable =
        data.tables.find((t) => String(pick(t, "round_code", "roundcode")) === String(tableCodeFromUrl)) || null;

      if (!rawTable) {
        gameFinished = true;
        disableBettingUI(true);
        setStatus("This game has finished. You'll be taken back to lobby for a new one.", "error");

        stopPlatinumLoop(); // NEW

        if (tablePollInterval) {
          clearInterval(tablePollInterval);
          tablePollInterval = null;
        }

        setTimeout(() => {
          window.location.href = "/game/platinum";
        }, 2000);

        return;
      }
    } else {
      rawTable = data.tables[0];
      syncUrlWithTable(pick(rawTable, "round_code", "roundcode"));
    }

    currentTable = normalizeTable(rawTable);
    updateGameUI(currentTable);
  } catch (err) {
    console.error("fetchTableData error", err);
  }
}

function updateGameUI(table) {
  if (!table) return;

  if (boatOrderRoundCode !== (table.roundCode || "__no_round__")) {
    resetBoatOrderForRound(table.roundCode);

    // NEW: ensure audio tracking resets cleanly on round change
    bgRoundCodePlaying = null;
    resultTriggeredForRound = null;
  }

  if (roundCodeSpan) roundCodeSpan.textContent = table.roundCode || "--";
  if (playerCountSpan) playerCountSpan.textContent = table.playersCount || 0;

  const tr = table.timeRemaining || 0;
  const mins = Math.floor(tr / 60);
  const secs = tr % 60;
  if (timerText) timerText.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  if (timerPill) {
    if (tr <= 10 && !table.isFinished && !table.isBettingClosed) timerPill.classList.add("urgent");
    else timerPill.classList.remove("urgent");
  }

  updateBoatsFromBets(table.bets || [], table.roundCode || "");
  const myBets = updateMyBets(table.bets || []);
  const hasUserBet = myBets.length > 0;

  const slotsAvail = table.slotsAvailable;
  const maxPlayers = safeNum(table.maxPlayers, 0);

  const slotsFull =
    (typeof slotsAvail === "number" && slotsAvail <= 0) ||
    (maxPlayers > 0 && table.playersCount >= maxPlayers) ||
    table.isFull === true;

  // ✅ SAME AS GOLD: full => disable ALL number buttons
  if (slotsFull) {
    setNumberChipsDisabled(true);
  } else if (!gameFinished && myBets.length < MAX_BETS_PER_ROUND) {
    setNumberChipsDisabled(false);
  }

  // ✅ SAME AS GOLD: 3/3 => disable ALL numbers + bet button
  if (myBets.length >= MAX_BETS_PER_ROUND) {
    setNumberChipsDisabled(true);
    if (placeBetBtn) placeBetBtn.disabled = true;
    if (!gameFinished) setStatus(`Bet limit reached (${MAX_BETS_PER_ROUND}/${MAX_BETS_PER_ROUND}).`, "ok");
  }

  // Kick user if no bet and table is not joinable
  if (!hasUserBet && (slotsFull || table.isBettingClosed || table.isFinished) && !kickedForNoBet) {
    gameFinished = true;
    disableBettingUI(true);

    stopPlatinumLoop(); // NEW

    if (tablePollInterval) {
      clearInterval(tablePollInterval);
      tablePollInterval = null;
    }
    showFullSlotAndGoBack();
    return;
  }

  // Button state
  if (placeBetBtn && !gameFinished) {
    const lockBecauseLimit = myBets.length >= MAX_BETS_PER_ROUND;
    placeBetBtn.disabled = !!table.isBettingClosed || !!table.isFinished || slotsFull || lockBecauseLimit;
  }

  if (table.isBettingClosed || table.isFinished || slotsFull || myBets.length >= MAX_BETS_PER_ROUND) {
    disableBettingUI(true);
  } else {
    if (placeBetBtn) placeBetBtn.disabled = false;
    setNumberChipsDisabled(false);
  }

  // ================= AUDIO CONTROL (NEW) =================
  const hasResult = table.resultValue !== null && table.resultValue !== undefined && table.resultValue !== "";
  startPlatinumLoopIfAllowed(table.roundCode, hasResult || table.isFinished || slotsFull);

  // Result animation moment (your existing trigger)
  if (hasResult && table.timeRemaining <= 2) {
    const roundId = table.roundCode || "__no_round__";
    if (resultAnimationShownForRound !== roundId) {
      resultAnimationShownForRound = roundId;

      // stop loop + play result + vibrate (once per round)
      playResultSoundOnce(table.roundCode);
      vibrateOnResult();

      ensureBoatForWinningNumber(table.resultValue, table.roundCode || "");

      const dur = Math.max(1200, Math.min(2200, (table.timeRemaining + 0.2) * 1000));

      setStatus(`Winning number: ${table.resultValue}`, "ok");
      dropParatrooperToWinningNumber(table.resultValue, dur);
    }
  }

  if (table.isFinished && hasResult) {
    const roundId = table.roundCode || "__no_round__";

    if (resultModalShownForRound !== roundId && hasUserBet) {
      resultModalShownForRound = roundId;
      gameFinished = true;

      stopPlatinumLoop(); // NEW

      if (tablePollInterval) {
        clearInterval(tablePollInterval);
        tablePollInterval = null;
      }

      const userWon = myBets.some((b) => Number(b.number) === Number(table.resultValue));
      const title = userWon ? "Congratulations!" : "Hard Luck!";
      const msg = userWon
        ? `You have WON this game. Winning number: ${table.resultValue}`
        : `You LOST this game. Winning number: ${table.resultValue}`;

      const delay = Math.max(0, (paratrooperLandingETA || 0) - Date.now() + 250);

      setTimeout(() => {
        showResultModal({
          title,
          message: msg,
          onHome: () => (window.location.href = "/home"),
          onLobby: () => (window.location.href = "/game/platinum"),
        });
      }, delay);
    }
  }
}

// ================== SOCKET.IO + BALANCE ==================

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
  socket.emit("joingame", { game_type: GAME, user_id: USER_ID });
}

socket.on("connect", () => {
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

function handleBetSuccess(payload) {
  setStatus(payload?.message || "Bet placed", "ok");
  const newBal = payload?.new_balance ?? payload?.newbalance;
  if (typeof newBal === "number") updateWallet(newBal);
  fetchTableData();
}

function handleBetError(payload) {
  setStatus(payload?.message || "Bet error", "error");
}

socket.on("bet_success", handleBetSuccess);
socket.on("betsuccess", handleBetSuccess);

socket.on("bet_error", handleBetError);
socket.on("beterror", handleBetError);

socket.on("update_table", () => fetchTableData());
socket.on("updatetable", () => fetchTableData());

// ================== UI EVENTS ==================

document.querySelectorAll(".num-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    unlockAudioOnce(); // NEW
    if (gameFinished) return;
    if (chip.disabled || chip.dataset.locked === "1") return; // ✅ hard guard
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
    unlockAudioOnce(); // NEW

    if (gameFinished) return setStatus("Game finished", "error");
    if (!currentTable) return setStatus("Game not ready yet", "error");

    // ✅ 3-bet limit
    const myCountNow = countMyBetsFromTable(currentTable);
    if (myCountNow >= MAX_BETS_PER_ROUND) {
      setStatus(`You can place only ${MAX_BETS_PER_ROUND} bets in this game.`, "error");
      setNumberChipsDisabled(true);
      placeBetBtn.disabled = true;
      return;
    }

    const slotsAvail = currentTable.slotsAvailable;
    const maxPlayers = safeNum(currentTable.maxPlayers, 0);

    const slotsFull =
      (typeof slotsAvail === "number" && slotsAvail <= 0) ||
      (maxPlayers > 0 && currentTable.playersCount >= maxPlayers) ||
      currentTable.isFull === true;

    if (slotsFull) {
      setStatus("All slots are full for this game.", "error");
      disableBettingUI(true);
      stopPlatinumLoop(); // NEW
      return;
    }

    if (walletBalance < FIXED_BET_AMOUNT) return setStatus("Insufficient balance", "error");
    if (selectedNumber === null || selectedNumber === undefined) return setStatus("Select a number first", "error");

    const myBets = (currentTable.bets || []).filter((b) => String(b.userId) === String(USER_ID)) || [];
    const alreadyOnThisNumber = myBets.some((b) => Number(b.number) === Number(selectedNumber));
    if (alreadyOnThisNumber) return setStatus("You already placed a bet on this number", "error");

    const payload = { game_type: GAME, user_id: USER_ID, username: USERNAME, number: selectedNumber };
    socket.emit("place_bet", payload);
    socket.emit("placebet", payload);
  });
}

// ===== Controls height sync for your CSS variable =====
function syncControlsHeight() {
  const controls = document.querySelector(".controls");
  if (!controls) return;
  const h = Math.ceil(controls.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--controls-h", `${h}px`);
}

window.addEventListener("load", syncControlsHeight);
window.addEventListener("resize", syncControlsHeight);

if (window.ResizeObserver) {
  const el = document.querySelector(".controls");
  if (el) new ResizeObserver(syncControlsHeight).observe(el);
}

// ================== INIT ==================

console.log(`[INIT] Platinum Game - User: ${USERNAME}, ID: ${USER_ID}`);

fetchBalance();
fetchTableData();
setSelectedNumber(0);
setStatus("");

if (!tablePollInterval) {
  tablePollInterval = setInterval(fetchTableData, 1000);
}
