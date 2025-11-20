// For same-domain backend:
const socket = io();

// Helper: format seconds as MM:SS
function formatTime(sec) {
  const s = Math.max(0, parseInt(sec, 10) || 0);
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0")
  );
}

function getCard(gameCode, roundNumber) {
  return document.querySelector(
    `.game-card[data-game-code="${gameCode}"][data-round-number="${roundNumber}"]`
  );
}

function updateTimerForGame(gameCode, roundNumber, remainingSeconds) {
  const card = getCard(gameCode, roundNumber);
  if (!card) return;
  if (card.dataset.status !== "pending") return; // ignore finished games

  const timerEl = card.querySelector(".timer-value");
  if (!timerEl) return;

  timerEl.textContent = formatTime(remainingSeconds);
}

function moveCardToHistory(gameCode, roundNumber, result, userOutcome) {
  const card = getCard(gameCode, roundNumber);
  if (!card) return;

  // Update UI inside card
  card.dataset.status = "completed";
  const statusPill = card.querySelector(".status-pill");
  if (statusPill) {
    statusPill.textContent = "Completed";
    statusPill.classList.remove("status-pending");
    statusPill.classList.add("status-completed");
  }

  const resultText = card.querySelector(".game-result-text");
  if (resultText) {
    if (userOutcome === "win") {
      resultText.textContent = `You won · Result: ${result}`;
    } else if (userOutcome === "lose") {
      resultText.textContent = `You lost · Result: ${result}`;
    } else {
      resultText.textContent = `Result: ${result}`;
    }
  }

  const timerRow = card.querySelector(".timer-row");
  if (timerRow) {
    timerRow.style.opacity = 0.6;
  }

  const btn = card.querySelector(".open-game-btn");
  if (btn) {
    btn.textContent = "View result";
    btn.disabled = true; // IMPORTANT: cannot open a new live game from history
  }

  // Remove from Current section and place into History section
  const historyContainer = document.getElementById("historyGames");
  card.parentNode.removeChild(card);
  historyContainer.appendChild(card);
}

// Tabs: switch visibility between current & past
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const currentSection = document.getElementById("currentGames");
  const historySection = document.getElementById("historyGames");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.tab;
      if (target === "current") {
        currentSection.classList.remove("hidden");
        historySection.classList.add("hidden");
      } else {
        currentSection.classList.add("hidden");
        historySection.classList.remove("hidden");
      }
    });
  });
}

// Current-game button clicks → open live game window for that game/round
function setupOpenButtons() {
  document.querySelectorAll(".game-card[data-status='pending']").forEach((card) => {
    const btn = card.querySelector(".open-game-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const gameCode = card.dataset.gameCode;
      // This opens the live window for that game.
      // If your live page is different, change the URL here:
      window.location.href = `/game/${gameCode}`;
    });
  });
}

socket.on("connect", () => {
  console.log("✅ Connected to server", socket.id);

  // Join room for each gameCode once (for timers)
  const uniqueGameCodes = new Set();
  document
    .querySelectorAll(".game-card[data-game-code]")
    .forEach((card) => {
      uniqueGameCodes.add(card.dataset.gameCode);
    });

  uniqueGameCodes.forEach((gameCode) => {
    socket.emit("join_game", { game_code: gameCode });
    socket.emit("request_state", { game_code: gameCode });
  });
});

// Full round state when requested / on join
socket.on("round_state", (data) => {
  if (!data || !data.game_code) return;
  const { game_code, round_number, remaining_seconds } = data;

  // Only update cards that belong to this exact round number
  updateTimerForGame(game_code, String(round_number), remaining_seconds);
});

// Per-second updates
socket.on("timer_update", (data) => {
  if (!data || !data.game_code) return;
  const { game_code, round_number, remaining_seconds } = data;
  updateTimerForGame(game_code, String(round_number), remaining_seconds);
});

// When round finishes
socket.on("round_result", (data) => {
  if (!data || !data.game_code) return;
  const { game_code, round_number, result, user_outcome } = data;

  moveCardToHistory(game_code, String(round_number), result, user_outcome);
});

// We ignore "new_round" here on purpose, because a card represents
// ONE specific game/round only and must not change to the next round.

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupOpenButtons();
});
