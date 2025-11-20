// ================= BASIC SETUP (DB USER) =================

const GAME = GAME_TYPE || "silver";

// optional: support multi-table via ?table=ROUND_CODE
const urlParams = new URLSearchParams(window.location.search);
const TABLE_CODE = urlParams.get("table") || null;

// Real logged-in user from Flask session (passed in HTML)
const USER_ID = GAME_USER_ID;
const USERNAME = GAME_USERNAME || "Player";

// ================= DOM REFERENCES =================

const frogImg = document.getElementById("frogSprite");
const pondEl = frogImg ? frogImg.parentElement : document.body;
const pads = Array.from(document.querySelectorAll(".pad"));

const numChips = Array.from(document.querySelectorAll(".num-chip"));
const placeBetBtn = document.getElementById("placeBetBtn");

const roundIdSpan = document.getElementById("roundId");
const playerCountSpan = document.getElementById("playerCount");
const timerText = document.getElementById("timerText");
const walletBalanceSpan = document.getElementById("walletBalance");
const statusEl = document.getElementById("statusMessage");
const coinsWrapper = document.querySelector(".coins");
const userNameLabel = document.getElementById("userName");
const userBetCountLabel = document.getElementById("userBetCount");
const myBetsRow = document.getElementById("myBetsRow");

if (userNameLabel) {
  userNameLabel.textContent = USERNAME;
}

let walletBalance = 0;
let selectedNumber = 0;

let currentTable = null;
let lastResultShown = null;

// ================= UI HELPERS =================

function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

function updateWallet(balance) {
  walletBalance = balance;
  if (walletBalanceSpan) {
    walletBalanceSpan.textContent = walletBalance.toFixed(0);
  }
  if (coinsWrapper) {
    coinsWrapper.classList.add("coin-bounce");
    setTimeout(() => coinsWrapper.classList.remove("coin-bounce"), 500);
  }
}

function setSelectedNumber(n) {
  selectedNumber = n;
  numChips.forEach((chip) => {
    const v = parseInt(chip.dataset.number, 10);
    chip.classList.toggle("selected", v === n);
  });
}

function updateMyBets(bets) {
  const myBets = (bets || []).filter((b) => b.user_id === USER_ID);

  if (userBetCountLabel) {
    userBetCountLabel.textContent = myBets.length;
  }

  if (!myBetsRow) return;
  myBetsRow.innerHTML = "";

  if (myBets.length === 0) {
    const span = document.createElement("span");
    span.style.color = "#6b7280";
    span.style.fontSize = "11px";
    span.textContent = "none";
    myBetsRow.appendChild(span);
    return;
  }

  myBets.forEach((b, index) => {
    const chip = document.createElement("span");
    chip.className = "my-bet-chip";
    chip.textContent = b.number;
    myBetsRow.appendChild(chip);
    if (index < myBets.length - 1) {
      myBetsRow.appendChild(document.createTextNode(", "));
    }
  });
}

// use up to 6 unique numbers into pads
function updatePadsFromBets(bets) {
  const betsByNumber = {};
  (bets || []).forEach((b) => {
    if (!betsByNumber[b.number]) betsByNumber[b.number] = [];
    betsByNumber[b.number].push(b);
  });

  const uniqueNumbers = Object.keys(betsByNumber).slice(0, 6);

  pads.forEach((pad, i) => {
    const numSpan = pad.querySelector(".pad-number");
    const userSpan = pad.querySelector(".pad-user");
    pad.classList.remove("win");

    if (i < uniqueNumbers.length) {
      const number = uniqueNumbers[i];
      const betsOnNumber = betsByNumber[number];
      pad.dataset.number = number;
      if (numSpan) numSpan.textContent = number;
      if (userSpan) userSpan.textContent = betsOnNumber[0].username;
    } else {
      pad.dataset.number = "";
      if (numSpan) numSpan.textContent = "";
      if (userSpan) userSpan.textContent = "";
    }
  });
}

// ================= FROG ANIMATION =================

function hopFrogToWinningNumber(winningNumber) {
  if (!frogImg || !pondEl) return;

  const targetPad = pads.find(
    (p) => p.dataset.number === String(winningNumber)
  );

  if (!targetPad) {
    console.log("No pad currently showing number", winningNumber);
    return;
  }

  const pondRect = pondEl.getBoundingClientRect();
  const frogRect = frogImg.getBoundingClientRect();
  const padRect = targetPad.getBoundingClientRect();

  const baseCenterX = frogRect.left + frogRect.width / 2 - pondRect.left;
  const baseCenterY = frogRect.top + frogRect.height / 2 - pondRect.top;

  const endX = padRect.left + padRect.width / 2 - pondRect.left;
  const endY = padRect.top + padRect.height * 0.25 - pondRect.top;

  const startX = baseCenterX;
  const startY = baseCenterY;
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  const duration = 750;
  const peak = -80;
  const startTime = performance.now();

  frogImg.style.transition = "none";
  frogImg.style.zIndex = "6";

  function step(now) {
    const tRaw = (now - startTime) / duration;
    const t = Math.min(Math.max(tRaw, 0), 1);

    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const x = startX + deltaX * ease;
    const yLinear = startY + deltaY * ease;
    const yArc = yLinear + peak * (4 * t * (1 - t));
    const scale = 1 + 0.08 * Math.sin(Math.PI * t);

    const relX = x - baseCenterX;
    const relY = yArc - baseCenterY;

    frogImg.style.transform = `translate(${relX}px, ${relY}px) scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      frogImg.style.transform = `translate(${endX - baseCenterX}px, ${
        endY - baseCenterY
      }px) scale(1)`;
      targetPad.classList.add("win");
    }
  }

  requestAnimationFrame(step);
}

function resetFrogPosition() {
  if (!frogImg) return;
  frogImg.style.transition = "transform 0.4s ease-out";
  frogImg.style.transform = "translate(0, 0) scale(1)";
  frogImg.style.zIndex = "5";
  setTimeout(() => {
    frogImg.style.transition = "none";
  }, 400);
}

// ================= BACKEND POLLING (TABLE DATA) =================

async function fetchTableData() {
  try {
    const res = await fetch("/api/tables/silver");
    const data = await res.json();

    if (!data.tables || !data.tables.length) {
      setStatus("No active tables", "error");
      return;
    }

    let table = null;

    // If we have TABLE_CODE in URL, try to use that table
    if (TABLE_CODE) {
      table = data.tables.find((t) => t.round_code === TABLE_CODE) || null;
    }

    // Otherwise use the first table as default
    if (!table) {
      table = data.tables[0];
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
  if (playerCountSpan) playerCountSpan.textContent = table.players || 0;

  if (timerText) {
    const mins = Math.floor((table.time_remaining || 0) / 60);
    const secs = (table.time_remaining || 0) % 60;
    timerText.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  updatePadsFromBets(table.bets || []);
  updateMyBets(table.bets || []);

  if (placeBetBtn) {
    placeBetBtn.disabled = !!table.is_betting_closed;
  }

  // detect new finished result to trigger frog jump
  if (
    table.is_finished &&
    table.result !== null &&
    table.result !== undefined &&
    table.result !== lastResultShown
  ) {
    lastResultShown = table.result;
    setStatus(`Winning number: ${table.result}`, "ok");
    hopFrogToWinningNumber(table.result);
  } else if (!table.is_finished) {
    lastResultShown = null;
  }
}

// poll every 2 seconds
setInterval(fetchTableData, 2000);

// ================= BALANCE / SOCKET =================

const socket = io();

async function fetchBalance() {
  try {
    const res = await fetch(`/balance/${USER_ID}`);
    const data = await res.json();
    if (typeof data.balance === "number") {
      updateWallet(data.balance);
    }
  } catch (err) {
    console.error("balance fetch error", err);
  }
}

function joinGameRoom() {
  socket.emit("join_game", {
    game_type: GAME,
    user_id: USER_ID,
  });
}

socket.on("connect", () => {
  joinGameRoom();
  fetchBalance();
  fetchTableData();
});

socket.on("bet_success", (payload) => {
  setStatus(payload.message || "Bet placed", "ok");
  if (typeof payload.new_balance === "number") {
    updateWallet(payload.new_balance);
  }
  // refresh table data to see new bets
  fetchTableData();
});

socket.on("bet_error", (payload) => {
  setStatus(payload.message || "Bet error", "error");
});

// ================= UI EVENTS =================

numChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const n = parseInt(chip.dataset.number, 10);
    setSelectedNumber(n);
  });
});

if (placeBetBtn) {
  placeBetBtn.addEventListener("click", () => {
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

// ================= INIT =================

fetchBalance();
fetchTableData();
setSelectedNumber(0);
setStatus("");
