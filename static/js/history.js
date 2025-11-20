// static/js/history.js

// We expect this to be set in history.html:
// <script>window.CURRENT_USER_ID = {{ session.get('user_id', 0) }};</script>
const CURRENT_USER_ID = window.CURRENT_USER_ID || 0;

// Tab buttons & sections
const tabCurrentBtn = document.getElementById("tab-current");
const tabHistoryBtn = document.getElementById("tab-history");
const currentSection = document.getElementById("current-section");
const historySection = document.getElementById("history-section");

// Lists
const currentList = document.getElementById("currentList");
const historyList = document.getElementById("historyList");

// Empty states
const currentEmpty = document.getElementById("current-empty");
const historyEmpty = document.getElementById("history-empty");

// -------- TAB SWITCHING --------
function setActiveTab(which) {
  if (which === "current") {
    tabCurrentBtn.classList.add("active");
    tabHistoryBtn.classList.remove("active");
    currentSection.style.display = "block";
    historySection.style.display = "none";
  } else {
    tabCurrentBtn.classList.remove("active");
    tabHistoryBtn.classList.add("active");
    currentSection.style.display = "none";
    historySection.style.display = "block";
  }
}

tabCurrentBtn.addEventListener("click", () => setActiveTab("current"));
tabHistoryBtn.addEventListener("click", () => setActiveTab("history"));

// -------- CARD RENDERING --------

/**
 * Create one card DOM element for a game item
 * @param {Object} game
 * @param {boolean} isCurrent - true for Current Games, false for Game History
 */
function createGameCard(game, isCurrent) {
  const card = document.createElement("div");
  card.className = "history-card";

  // status pill
  const status = game.status || "pending";
  const statusLabel = status === "win" ? "Won" : status === "lose" ? "Lost" : "Pending";

  const betsCount = Array.isArray(game.user_bets) ? game.user_bets.length : 0;
  const amountText =
    status === "pending"
      ? ""
      : (game.amount >= 0 ? `+₹${game.amount}` : `-₹${Math.abs(game.amount)}`);

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title-code">
        <div class="game-code">${game.round_code}</div>
        <div class="game-type">${game.game_type}</div>
      </div>
      <div class="status-pill status-${status}">
        ${statusLabel}
      </div>
    </div>

    <div class="card-body">
      <div class="card-row">
        <span class="label">Your bets:</span>
        <span class="value">${betsCount}</span>
      </div>
      ${
        status === "pending"
          ? `<div class="card-row subtle">Waiting for result…</div>`
          : `<div class="card-row">
               <span class="label">Winning number:</span>
               <span class="value">${game.winning_number ?? "-"}</span>
             </div>
             <div class="card-row">
               <span class="label">Result:</span>
               <span class="value amount ${game.amount >= 0 ? "amount-win" : "amount-lose"}">
                 ${amountText}
               </span>
             </div>`
      }
      ${
        game.date_time
          ? `<div class="card-row subtle small">${game.date_time}</div>`
          : ""
      }
    </div>
  `;

  // ------- Make CURRENT game cards clickable -------
  if (isCurrent) {
    card.classList.add("clickable");
    card.dataset.gameType = game.game_type;
    card.dataset.roundCode = game.round_code;

    card.addEventListener("click", () => {
      const gt = card.dataset.gameType;
      const rc = card.dataset.roundCode;
      if (!gt || !rc) return;

      // Send user to the correct game window with table code.
      // Example: /play/silver?table=S17636461502
      const url = `/play/${gt}?table=${encodeURIComponent(rc)}`;
      window.location.href = url;
    });
  }

  return card;
}

// -------- RENDER LISTS --------

function renderCurrentGames(list) {
  currentList.innerHTML = "";

  if (!list || list.length === 0) {
    currentEmpty.style.display = "block";
    return;
  }
  currentEmpty.style.display = "none";

  list.forEach((game) => {
    const card = createGameCard(game, true);
    currentList.appendChild(card);
  });
}

function renderGameHistory(list) {
  historyList.innerHTML = "";

  if (!list || list.length === 0) {
    historyEmpty.style.display = "block";
    return;
  }
  historyEmpty.style.display = "none";

  list.forEach((game) => {
    const card = createGameCard(game, false);
    historyList.appendChild(card);
  });
}

// -------- LOAD DATA --------

async function loadHistory() {
  if (!CURRENT_USER_ID) {
    console.warn("No CURRENT_USER_ID set; history will be empty.");
    return;
  }

  try {
    const res = await fetch(`/api/user-games?user_id=${CURRENT_USER_ID}`);
    if (!res.ok) throw new Error("Failed to fetch history");
    const data = await res.json();

    renderCurrentGames(data.current_games || []);
    renderGameHistory(data.game_history || []);
  } catch (err) {
    console.error("History fetch error:", err);
    currentEmpty.style.display = "block";
    historyEmpty.style.display = "block";
  }
}

// -------- INIT --------
document.addEventListener("DOMContentLoaded", () => {
  setActiveTab("current");
  loadHistory();
});
