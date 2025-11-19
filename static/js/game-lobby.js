// --- GAME LOBBY TABLES - 6 Cards, staggered timers, always showing ---

const USER_ID = localStorage.getItem('user_id') || 'guest';
const USERNAME = localStorage.getItem('username') || 'Player';
const GAME_DURATION = 5 * 60; // 5 minutes in seconds
const TABLE_COUNT = 6;
const TABLE_BASE_ID = Date.now();

let availableTables = [];

// --- Initialize 6 tables with staggered time left ---
function initializeTables() {
  availableTables = [];
  for (let i = 0; i < TABLE_COUNT; i++) {
    const offset = i * 60; // Each table starts 1 minute after previous
    availableTables.push({
      id: `FROG${TABLE_BASE_ID + i}`,
      index: i + 1,
      roundCode: `F${TABLE_BASE_ID + i}`,
      players: Math.floor(Math.random() * 5) + 1, // 1-5 players
      maxPlayers: 6,
      timeRemaining: GAME_DURATION - offset,
      isFull: false
    });
  }
  renderTables();
}

// --- Render all 6 cards ---
function renderTables() {
  const tablesGrid = document.getElementById('tablesGrid');
  tablesGrid.innerHTML = '';
  availableTables.forEach((table, idx) => {
    const isFull = table.players >= table.maxPlayers;
    const card = document.createElement('div');
    card.className = `table-card${isFull ? ' full' : ''}`;
    if (!isFull) card.onclick = () => joinTable(idx);

    card.innerHTML = `
      <div class="table-header">
        <div class="table-number">Game #${table.index}</div>
        <div class="table-timer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${formatTime(table.timeRemaining)}</span>
        </div>
      </div>
      <div class="table-info">
        <div class="players-count">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>${table.players}/${table.maxPlayers} Players</span>
        </div>
        <div class="slots-indicator">${renderSlots(table.players, table.maxPlayers)}</div>
      </div>
    `;
    tablesGrid.appendChild(card);
  });
}

// --- Create slot indicator (green/gray dots) ---
function renderSlots(players, max) {
  let html = '';
  for (let i = 0; i < max; i++) {
    html += `<div class="slot ${i < players ? 'filled' : 'empty'}"></div>`;
  }
  return html;
}

// --- MM:SS formatting ---
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Join table (Go to game page for now) ---
function joinTable(idx) {
  const table = availableTables[idx];
  if (!table || table.isFull) return;
  const gameType = typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver';
  window.location.href = `/play/${gameType}?table=${encodeURIComponent(table.roundCode)}`;
}

// --- Quick Play button joins the lowest players table ---
document.getElementById('quickPlayBtn').addEventListener('click', () => {
  const sorted = [...availableTables].filter(t => !t.isFull).sort((a, b) => a.players - b.players);
  if (sorted.length > 0) {
    window.location.href = `/play/${typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver'}?table=${encodeURIComponent(sorted[0].roundCode)}`;
  } else {
    alert('All tables are currently full! Please wait for a new table.');
  }
});

// --- Timer update/rotate system like casino tables ---
function updateTables() {
  for (let i = 0; i < availableTables.length; i++) {
    let t = availableTables[i];
    t.timeRemaining = Math.max(0, t.timeRemaining - 1);
    // Fill up tables dynamically
    if (!t.isFull && Math.random() < 0.05 && t.players < t.maxPlayers) {
      t.players++;
    }
    t.isFull = t.players >= t.maxPlayers || t.timeRemaining <= 0;
    // If table is full or time ends, rotate
    if (t.isFull || t.timeRemaining <= 0) {
      // Replace with a new table at the end
      let offset = (i + 1) * 60;
      availableTables[i] = {
        id: `FROG${Date.now()}${Math.floor(Math.random() * 1000)}`,
        index: availableTables[i].index, // keep index (Game #1, Game #2, etc)
        roundCode: `F${Date.now()}${Math.floor(Math.random() * 1000)}`,
        players: Math.floor(Math.random() * 3) + 1,
        maxPlayers: 6,
        timeRemaining: GAME_DURATION - offset,
        isFull: false
      };
    }
  }
  renderTables();
}

// --- Init on DOM ready ---
document.addEventListener('DOMContentLoaded', () => {
  initializeTables();
  setInterval(updateTables, 1000);
});
