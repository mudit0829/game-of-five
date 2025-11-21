// Simple History page logic: tabs + fetch from /api/user-games

function formatTime(sec) {
  const s = Math.max(0, parseInt(sec || 0, 10));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const currentSection = document.getElementById("currentSection");
  const historySection = document.getElementById("historySection");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const which = tab.dataset.tab;
      if (which === "current") {
        currentSection.classList.remove("hidden");
        historySection.classList.add("hidden");
      } else {
        currentSection.classList.add("hidden");
        historySection.classList.remove("hidden");
      }
    });
  });
}

function renderGameCard(game, isCurrent) {
  // game structure comes from /api/user-games in app.py
  const card = document.createElement("div");
  card.className = "game-card";

  const gameType = game.game_type || "silver";
  const roundCode = game.round_code || "-";
  const bets = game.user_bets || [];
  const betCount = bets.length;
  const status = game.status || (isCurrent ? "pending" : "completed");
  const winningNumber =
    typeof game.winning_number === "number" ? game.winning_number : null;
  const amount = game.amount || 0;

  const isWin = status === "win" || amount > 0;
  const isLose = status === "lose" || amount < 0;

  if (!isCurrent) {
    if (isWin) card.classList.add("win");
    else if (isLose) card.classList.add("lose");
  }

  const statusClass = isCurrent ? "status-pending" : "status-completed";
  const statusLabel = isCurrent ? "Pending" : "Completed";

  card.innerHTML = `
    <div class="game-card-header">
      <span class="game-id">${roundCode}</span>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    </div>

    <div class="game-info">
      <div class="game-name">${gameType}</div>
      <div class="game-bets">
        <span>Your bets:</span>
        <span class="bet-count">${betCount}</span>
      </div>
      <div class="game-result-text">
        ${
          isCurrent
            ? "Waiting for result..."
            : isWin
            ? `You won · Result: ${winningNumber}`
            : isLose
            ? `You lost · Result: ${winningNumber}`
            : `Result: ${winningNumber ?? "--"}`
        }
      </div>
      <div class="timer-row">
        <span class="timer-label">Time:</span>
        <span class="timer-value">${
          game.time_remaining != null
            ? formatTime(game.time_remaining)
            : "--:--"
        }</span>
      </div>
    </div>
  `;

  const btn = document.createElement("button");
  btn.className = "open-game-btn";

  if (isCurrent) {
    btn.textContent = "Go to game";
    btn.disabled = false;
    btn.addEventListener("click", () => {
      // open the correct game + table
      window.location.href = `/play/${gameType}?table=${encodeURIComponent(
        roundCode
      )}`;
    });
  } else {
    btn.textContent = "View result";
    btn.disabled = true; // just info, no new game
  }

  card.appendChild(btn);
  return card;
}

async function loadHistory() {
  const currentWrap = document.getElementById("currentGames");
  const historyWrap = document.getElementById("historyGames");

  currentWrap.innerHTML =
    '<div class="empty-message">Loading your games…</div>';
  historyWrap.innerHTML =
    '<div class="empty-message">Loading your games…</div>';

  try {
    const res = await fetch(`/api/user-games?user_id=${CURRENT_USER_ID}`);
    const data = await res.json();

    const currentGames = data.current_games || [];
    const historyGames = data.game_history || [];

    // CURRENT
    currentWrap.innerHTML = "";
    if (!currentGames.length) {
      currentWrap.innerHTML =
        '<div class="empty-message">No current games. Place a bet to start playing!</div>';
    } else {
      currentGames.forEach((g) => {
        currentWrap.appendChild(renderGameCard(g, true));
      });
    }

    // HISTORY
    historyWrap.innerHTML = "";
    if (!historyGames.length) {
      historyWrap.innerHTML =
        '<div class="empty-message">No completed games yet.</div>';
    } else {
      historyGames.forEach((g) => {
        historyWrap.appendChild(renderGameCard(g, false));
      });
    }
  } catch (err) {
    console.error("Error loading history:", err);
    currentWrap.innerHTML =
      '<div class="empty-message">Could not load history.</div>';
    historyWrap.innerHTML =
      '<div class="empty-message">Could not load history.</div>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadHistory();
});
