// ========== Fetch and Display History Data ==========

// EXAMPLE DUMMY API ENDPOINTS
// Replace with real endpoints in backend
const HISTORY_API = "/api/user-games";

const USER_ID = window.USER_ID;

// Fetch games for this user, split by current and full history
async function fetchUserHistory() {
  let res = await fetch(`${HISTORY_API}?user_id=${encodeURIComponent(USER_ID)}`);
  let data = await res.json();
  return data;
}

function renderBetChips(numbers) {
  return numbers.map(n => `<span class="bet-chip">${n}</span>`).join(' ');
}

// status can be "pending", "win", "lose"
function renderAmount(amount, status) {
  if (status === "win") return `<span class="win">+₹${amount}</span>`;
  if (status === "lose") return `<span class="lose">-₹${Math.abs(amount)}</span>`;
  return `<span class="pending">Pending</span>`;
}

function renderCurrentGames(current) {
  const root = document.getElementById("current-games-list");
  if (!current || !current.length) {
    root.innerHTML = '<div class="no-record">No current games in progress.</div>';
    document.getElementById('current-count').textContent = "(0)";
    return;
  }
  document.getElementById('current-count').textContent = "(" + current.length + ")";
  root.innerHTML = current.map((g, i) => `
    <div class="game-card${i === current.length-1 ? ' last-card' : ''}">
      <div class="card-head">
        <span>${g.game_type?.toUpperCase() || "--"} #${g.round_code || '--'}</span>
        <span>${g.date_time}</span>
      </div>
      <div class="card-main">
        <div>Bets: ${renderBetChips(g.user_bets || [])}</div>
        <div>Bet Amount: ₹${g.bet_amount || "--"}</div>
        <div>Status: <span class="pending">Pending Result</span></div>
      </div>
      <div class="card-foot">
        Waiting for result...
      </div>
    </div>
  `).join("");
}

function renderGameHistory(history) {
  const root = document.getElementById("history-games-list");
  if (!history || !history.length) {
    root.innerHTML = '<div class="no-record">No game history.</div>';
    document.getElementById('history-count').textContent = "(0)";
    return;
  }
  document.getElementById('history-count').textContent = "(" + history.length + ")";
  root.innerHTML = history.map((g,i) => `
    <div class="game-card${i === history.length-1 ? ' last-card' : ''}">
      <div class="card-head">
        <span>${g.game_type?.toUpperCase() || "--"} #${g.round_code || '--'}</span>
        <span>${g.date_time}</span>
      </div>
      <div class="card-main">
        <div>
          Your Bets: ${renderBetChips(g.user_bets || [])}
        </div>
        <div>
          Result: 
          <span class="result-chip">${g.winning_number ?? '--'}</span>
        </div>
        <div>
          Win/Lose: ${renderAmount(g.amount, g.status)}
        </div>
        <div>
          Bet Amount: ₹${g.bet_amount || "--"}
        </div>
      </div>
      <div class="card-foot">
        Game ID: ${g.round_code}
      </div>
    </div>
  `).join("");
}

async function main() {
  try {
    let { current_games, game_history } = await fetchUserHistory();

    renderCurrentGames(current_games);
    renderGameHistory(game_history);
  } catch (e) {
    document.getElementById("current-games-list").innerHTML = '<div class="no-record">Could not load.</div>';
    document.getElementById("history-games-list").innerHTML = '<div class="no-record">Could not load.</div>';
    console.error(e);
  }
}
// Auto-load on page load
main();

