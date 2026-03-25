function formatTime(sec) {
  const s = Math.max(0, parseInt(sec || 0, 10));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return "N/A";

  try {
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) return "N/A";

    const options = {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    };

    return date.toLocaleString("en-IN", options);
  } catch (e) {
    console.error("Date formatting error:", e);
    return "N/A";
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

  const gameType = game.game_type || game.gametype || "";
  const targetRoundCode = game.round_code || game.roundcode || "";
  const displayRoundCode = targetRoundCode || "-";
  const tableNumber = game.table_number ?? game.tablenumber ?? "";
  const userBets = game.user_bets || game.userbets || [];
  const status = game.status || (isCurrent ? "pending" : "completed");

  const winningNumber =
    typeof game.winning_number === "number"
      ? game.winning_number
      : typeof game.winningnumber === "number"
      ? game.winningnumber
      : null;

  const amount = Number(game.amount ?? 0);
  const betTime = game.datetime || game.bet_time || game.date_time || null;

  const isWin = status === "win";
  const isLose = status === "lose";

  if (!isCurrent) {
    if (isWin) card.classList.add("win");
    else if (isLose) card.classList.add("lose");
  }

  const statusClass = isCurrent ? "status-pending" : "status-completed";
  const statusLabel = isCurrent ? "Pending" : "Completed";

  const betNumbersDisplay = userBets.length > 0 ? userBets.join(", ") : "N/A";

  card.innerHTML = `
    <div class="game-card-header">
      <span class="game-id">${displayRoundCode}</span>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    </div>

    <div class="game-info">
      <div class="game-name">${gameType ? gameType.charAt(0).toUpperCase() + gameType.slice(1) : "Game"}</div>

      <div class="game-bets">
        <span>Your bet${userBets.length > 1 ? "s" : ""} on:</span>
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
        <span class="timer-label">${isCurrent ? "Time remaining:" : "Bet placed:"}</span>
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
      if (!gameType || !targetRoundCode) {
        console.error("Missing game_type or round_code", game);
        return;
      }

      const qs = new URLSearchParams();
      qs.set("roundcode", targetRoundCode);

      if (tableNumber !== "" && tableNumber !== null && tableNumber !== undefined) {
         qs.set("tablenumber", String(tableNumber));
      }


      window.location.href = `/play/${encodeURIComponent(gameType)}?${qs.toString()}`;
    });
  } else {
    const label = isWin ? "Total Win" : isLose ? "Total Loss" : "Total";
    btn.textContent = `View result • ${label}: ${amount.toLocaleString("en-IN")}`;
    btn.disabled = true;
  }

  card.appendChild(btn);
  return card;
}

async function loadHistory() {
  const currentWrap = document.getElementById("currentGames");
  const historyWrap = document.getElementById("historyGames");

  currentWrap.innerHTML = '<div class="empty-message">Loading your games…</div>';
  historyWrap.innerHTML = '<div class="empty-message">Loading your games…</div>';

  try {
    const res = await fetch("/api/user-games", {
      headers: {
        Accept: "application/json"
      }
    });

    const contentType = res.headers.get("content-type") || "";
    const rawText = await res.text();

    console.log("HTTP status:", res.status);
    console.log("Content-Type:", contentType);
    console.log("RAW response text:", rawText);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 300)}`);
    }

    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but got: ${contentType}. Response: ${rawText.slice(0, 300)}`);
    }

    const data = JSON.parse(rawText);

    console.log("RAW /api/user-games response:", data);

    const currentGames = data.current_games || data.currentgames || [];
    const historyGames = data.game_history || data.gamehistory || [];

    console.log("currentGames:", currentGames);
    console.log("historyGames:", historyGames);

    currentWrap.innerHTML = "";
    if (!currentGames.length) {
      currentWrap.innerHTML = '<div class="empty-message">No current games. Place a bet to start playing!</div>';
    } else {
      currentGames.forEach((g) => {
        currentWrap.appendChild(renderGameCard(g, true));
      });
    }

    historyWrap.innerHTML = "";
    if (!historyGames.length) {
      historyWrap.innerHTML = '<div class="empty-message">No completed games yet.</div>';
    } else {
      historyGames.forEach((g) => {
        historyWrap.appendChild(renderGameCard(g, false));
      });
    }
  } catch (err) {
    console.error("Error loading history:", err);
    currentWrap.innerHTML = '<div class="empty-message">Could not load history.</div>';
    historyWrap.innerHTML = '<div class="empty-message">Could not load history.</div>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadHistory();

  setInterval(() => {
    const currentTab = document.querySelector('.tab[data-tab="current"]');
    if (currentTab && currentTab.classList.contains("active")) {
      loadHistory();
    }
  }, 10000);
});
