// ======== DOM ELEMENTS ========
const tabCurrent = document.getElementById("tabCurrent");
const tabHistory = document.getElementById("tabHistory");

const currentCard = document.getElementById("currentCard");
const historyCard = document.getElementById("historyCard");

const currentList = document.getElementById("currentList");
const historyList = document.getElementById("historyList");

// ======== TAB TOGGLE ========

function showCurrent() {
  tabCurrent.classList.add("active");
  tabHistory.classList.remove("active");
  currentCard.classList.remove("hidden");
  historyCard.classList.add("hidden");
}

function showHistory() {
  tabHistory.classList.add("active");
  tabCurrent.classList.remove("active");
  historyCard.classList.remove("hidden");
  currentCard.classList.add("hidden");
}

tabCurrent.addEventListener("click", showCurrent);
tabHistory.addEventListener("click", showHistory);

// ======== HELPERS ========

function formatAmount(amount) {
  const v = Number(amount || 0);
  if (v === 0) return "₹0";
  const prefix = v > 0 ? "+" : "−";
  return prefix + "₹" + Math.abs(v).toString();
}

function gameTitle(gameType) {
  if (!window.GAME_CONFIGS_JS) return gameType;
  const cfg = GAME_CONFIGS_JS[gameType];
  return cfg ? cfg.name : gameType;
}

// ======== RENDER FUNCTIONS ========

function renderEmptyCurrent() {
  currentList.innerHTML = `
    <div class="empty-state">
      <p>No active games right now.</p>
      <p class="hint">Place a bet to see it here.</p>
    </div>
  `;
}

function renderEmptyHistory() {
  historyList.innerHTML = `
    <div class="empty-state">
      <p>No games played yet.</p>
      <p class="hint">Your completed games will appear here.</p>
    </div>
  `;
}

function renderCurrentGames(games) {
  if (!games || games.length === 0) {
    renderEmptyCurrent();
    return;
  }

  currentList.innerHTML = "";
  games.forEach((g) => {
    const div = document.createElement("div");
    div.className = "game-row pending";

    const bets = (g.user_bets || []).join(", ") || "—";

    div.innerHTML = `
      <div class="row-main">
        <div class="row-top">
          <span class="game-id">${g.round_code}</span>
          <span class="status-pill pending">Pending</span>
        </div>
        <div class="row-sub">
          <span class="game-name">${gameTitle(g.game_type)}</span>
          <span class="date">${g.date_time || ""}</span>
        </div>
      </div>
      <div class="row-detail">
        <span class="label">Your bets:</span>
        <span class="value">${bets}</span>
      </div>
    `;
    currentList.appendChild(div);
  });
}

function renderHistoryGames(games) {
  if (!games || games.length === 0) {
    renderEmptyHistory();
    return;
  }

  historyList.innerHTML = "";
  games.forEach((g) => {
    const isWin = g.status === "win";
    const result = g.winning_number !== null && g.winning_number !== undefined
      ? g.winning_number
      : "—";
    const bets = (g.user_bets || []).join(", ") || "—";

    const div = document.createElement("div");
    div.className = "game-row " + (isWin ? "win" : "lose");

    div.innerHTML = `
      <div class="row-main">
        <div class="row-top">
          <span class="game-id">${g.round_code}</span>
          <span class="status-pill ${isWin ? "win" : "lose"}">
            ${isWin ? "Win" : "Lose"}
          </span>
        </div>
        <div class="row-sub">
          <span class="game-name">${gameTitle(g.game_type)}</span>
          <span class="date">${g.date_time || ""}</span>
        </div>
      </div>
      <div class="row-detail">
        <span class="label">Your bets:</span>
        <span class="value">${bets}</span>
      </div>
      <div class="row-detail">
        <span class="label">Winning number:</span>
        <span class="value">${result}</span>
      </div>
      <div class="row-detail">
        <span class="label">Net amount:</span>
        <span class="value amount ${isWin ? "amt-win" : "amt-lose"}">
          ${formatAmount(g.amount)}
        </span>
      </div>
    `;
    historyList.appendChild(div);
  });
}

// ======== LOAD DATA FROM BACKEND ========

async function fetchHistory() {
  if (!GAME_USER_ID) {
    renderEmptyCurrent();
    renderEmptyHistory();
    return;
  }

  try {
    const res = await fetch(`/api/user-games?user_id=${GAME_USER_ID}`);
    const data = await res.json();
    renderCurrentGames(data.current_games || []);
    renderHistoryGames(data.game_history || []);
  } catch (err) {
    console.error("history fetch error", err);
    renderEmptyCurrent();
    renderEmptyHistory();
  }
}

// ======== INIT ========
showCurrent();
fetchHistory();
