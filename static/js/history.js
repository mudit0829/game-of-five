// ✅ FIXED History page logic

function formatTime(sec) {
  const s = Math.max(0, parseInt(sec || 0, 10));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// ✅ NEW: Format datetime for display
function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return 'N/A';
  
  try {
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) return 'N/A';
    
    // Format: "05 Feb 2026, 6:40 PM"
    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    };
    
    return date.toLocaleString('en-IN', options);
  } catch (e) {
    console.error('Date formatting error:', e);
    return 'N/A';
  }
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
  const card = document.createElement("div");
  card.className = "game-card";

  const gameType = game.game_type || "silver";
  const roundCode = game.round_code || "-";
  const userBets = game.user_bets || [];  // ✅ Array of numbers
  const status = game.status || (isCurrent ? "pending" : "completed");
  const winningNumber =
    typeof game.winning_number === "number" ? game.winning_number : null;
  const amount = game.amount || 0;
  const betTime = game.bet_time || game.date_time || null;  // ✅ Get datetime

  const isWin = status === "win" || amount > 0;
  const isLose = status === "lose" || amount < 0;

  if (!isCurrent) {
    if (isWin) card.classList.add("win");
    else if (isLose) card.classList.add("lose");
  }

  const statusClass = isCurrent ? "status-pending" : "status-completed";
  const statusLabel = isCurrent ? "Pending" : "Completed";

  // ✅ Format bet numbers as comma-separated list
  const betNumbersDisplay = userBets.length > 0 
    ? userBets.join(', ') 
    : 'N/A';

  card.innerHTML = `
    <div class="game-card-header">
      <span class="game-id">${roundCode}</span>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    </div>

    <div class="game-info">
      <div class="game-name">${gameType.charAt(0).toUpperCase() + gameType.slice(1)}</div>
      
      <div class="game-bets">
        <span>Your bet${userBets.length > 1 ? 's' : ''} on:</span>
        <span class="bet-numbers">${betNumbersDisplay}</span>
      </div>
      
      <div class="game-result-text">
        ${
          isCurrent
            ? "Waiting for result..."
            : isWin
            ? `✅ You won · Result: ${winningNumber}`
            : isLose
            ? `❌ You lost · Result: ${winningNumber}`
            : `Result: ${winningNumber ?? "--"}`
        }
      </div>
      
      <div class="timer-row">
        <span class="timer-label">${isCurrent ? 'Time remaining:' : 'Bet placed:'}</span>
        <span class="timer-value">${
          isCurrent
            ? (game.time_remaining != null ? formatTime(game.time_remaining) : "--:--")
            : formatDateTime(betTime)
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
      // ✅ FIX: Navigate to game lobby (not directly to table)
      // This avoids "all slots full" error
      window.location.href = `/game/${gameType}`;
    });
  } else {
    btn.textContent = "View result";
    btn.disabled = true;
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

    console.log('✅ Loaded games:', { currentGames, historyGames });  // Debug

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
  
  // ✅ Auto-refresh current games every 30 seconds
  setInterval(() => {
    const currentTab = document.querySelector('.tab[data-tab="current"]');
    if (currentTab && currentTab.classList.contains('active')) {
      loadHistory();
    }
  }, 30000);
});
