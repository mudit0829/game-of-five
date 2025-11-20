// ===============================
// HISTORY PAGE CONTROLLER
// ===============================

document.addEventListener("DOMContentLoaded", () => {
    console.log("History page loaded");

    const currentListEl = document.querySelector("#currentGamesList");
    const historyListEl = document.querySelector("#historyGamesList");

    // These IDs exist in your HTML:
    // <div id="currentGamesList"></div>
    // <div id="historyGamesList"></div>

    // ------ SETTINGS ------
    const USER_ID = window.USER_ID || null;     // Set in history.html
    const FETCH_INTERVAL = 4000;                // 4 seconds = lightweight

    // If backend not ready → use mock mode
    let mockMode = false;

    // ===============================
    //  HELPER: Format Date
    // ===============================
    function formatDate(dateString) {
        const d = new Date(dateString);
        return d.toLocaleString("en-IN", {
            hour12: true,
            hour: "2-digit",
            minute: "2-digit",
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    // ===============================
    //  HELPER: Create Current Game Card
    // ===============================
    function makeCurrentGameCard(g) {
        return `
            <article class="item-card pending">
              <div class="item-main">
                <div class="item-icon">
                  <span class="emoji">${g.emoji || "🎮"}</span>
                </div>
                <div class="item-text">
                  <div class="item-title">
                    ${g.game_title}
                    <span class="badge badge-pill">${g.game_type}</span>
                  </div>

                  <div class="item-meta">
                    Game ID: <span class="mono">${g.game_id}</span>
                  </div>

                  <div class="item-meta">
                    Placed: ${formatDate(g.datetime)}
                  </div>

                  <div class="item-meta">
                    Your bets: <span class="mono">${g.your_bets.join(", ")}</span>
                  </div>
                </div>
              </div>

              <div class="item-side">
                <div class="status-pill status-pending">Pending</div>
                <div class="timer-line">⏳ <span class="mono">${g.timer}s</span></div>
                <div class="amount-line">Bet: ₹${g.total_bet_amount}</div>
              </div>
            </article>
        `;
    }

    // ===============================
    //  HELPER: Create Finished Game Card
    // ===============================
    function makeHistoryCard(h) {
        const profitClass = h.net_amount >= 0 ? "win" : "lose";
        const profitValue = h.net_amount >= 0 ? `+₹${h.net_amount}` : `-₹${Math.abs(h.net_amount)}`;

        return `
          <article class="item-card history">
            <div class="row-line row-top">

              <div class="game-info">
                <div class="game-name">
                  ${h.game_title}
                  <span class="badge badge-pill small">${h.game_type}</span>
                </div>
                <div class="game-id">ID: <span class="mono">${h.game_id}</span></div>
                <div class="game-date">${formatDate(h.datetime)}</div>
              </div>

              <div class="bet-info">
                <div class="label">Your Bets</div>
                <div class="mono">${h.your_bets.join(", ")}</div>
              </div>

              <div class="win-info">
                <div class="label">Winning</div>
                <div class="mono">${h.winning_number}</div>
              </div>

              <div class="amount-info">
                <div class="label">P/L</div>
                <div class="amount ${profitClass}">${profitValue}</div>
              </div>

            </div>
          </article>
        `;
    }

    // ===============================
    //  MOCK DATA (for testing if backend not ready)
    // ===============================
    function loadMockData() {
        return {
            current_games: [
                {
                    game_id: "F202511211234",
                    game_title: "Silver Game",
                    game_type: "Silver",
                    emoji: "🐸",
                    datetime: new Date().toISOString(),
                    your_bets: [2, 8],
                    timer: 41,
                    total_bet_amount: 20
                }
            ],
            history_games: [
                {
                    game_id: "F202511208010",
                    game_title: "Gold Game",
                    game_type: "Gold",
                    emoji: "⚽",
                    datetime: "2025-11-18T16:00:00",
                    winning_number: 4,
                    your_bets: [1, 4],
                    net_amount: 200
                },
                {
                    game_id: "F202511209876",
                    game_title: "Diamond Game",
                    game_type: "Diamond",
                    emoji: "🎯",
                    datetime: "2025-11-18T12:30:00",
                    winning_number: 7,
                    your_bets: [3],
                    net_amount: -100
                }
            ]
        };
    }

    // ===============================
    //  RENDER FUNCTION
    // ===============================
    function renderHistory(data) {
        const { current_games, history_games } = data;

        // ---- CURRENT GAMES ----
        if (current_games.length === 0) {
            currentListEl.innerHTML = `
                <div class="empty-state">No active games.</div>
            `;
        } else {
            currentListEl.innerHTML = current_games.map(makeCurrentGameCard).join("");
        }

        // ---- HISTORY ----
        if (history_games.length === 0) {
            historyListEl.innerHTML = `
                <div class="empty-state">No completed games yet.</div>
            `;
        } else {
            historyListEl.innerHTML = history_games.map(makeHistoryCard).join("");
        }
    }

    // ===============================
    //  FETCH LIVE DATA FROM BACKEND
    // ===============================
    async function fetchHistory() {
        try {
            const res = await fetch(`/history-data?user_id=${USER_ID}`);
            
            if (!res.ok) {
                console.warn("History endpoint missing → using mock mode");
                mockMode = true;
                renderHistory(loadMockData());
                return;
            }

            const data = await res.json();
            renderHistory(data);
        } catch (e) {
            console.error("History fetch failed:", e);
            mockMode = true;
            renderHistory(loadMockData());
        }
    }

    // Initial load
    fetchHistory();

    // Auto refresh every few seconds
    setInterval(fetchHistory, FETCH_INTERVAL);
});
