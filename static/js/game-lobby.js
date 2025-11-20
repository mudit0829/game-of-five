// === GAME LOBBY - Fetch Real Backend Tables ===

const USER_ID = localStorage.getItem('user_id') || 'guest';
const USERNAME = localStorage.getItem('username') || 'Player';

let availableTables = [];

// --- Fetch tables from backend ---
async function fetchTables() {
  try {
    const response = await fetch(`/api/tables/${GAME_TYPE}`);
    const data = await response.json();
    
    if (data.tables) {
      availableTables = data.tables;
      renderTables();
    }
  } catch (error) {
    console.error('Error fetching tables:', error);
  }
}

// --- Render all tables ---
function renderTables() {
  const tablesGrid = document.getElementById('tablesGrid');
  
  if (!tablesGrid) {
    console.error('tablesGrid element not found!');
    return;
  }
  
  tablesGrid.innerHTML = '';
  
  if (availableTables.length === 0) {
    tablesGrid.innerHTML = '<p style="text-align:center;color:#9ca3af;">Loading tables...</p>';
    return;
  }
  
  availableTables.forEach((table, index) => {
    const isFull = table.slots_available === 0;
    const isStarted = table.is_started;
    
    const card = document.createElement('div');
    card.className = `table-card ${isFull ? 'full' : ''}`;
    
    if (!isFull && isStarted) {
      card.onclick = () => joinTable(table.round_code);
    }
    
    card.innerHTML = `
      <div class="table-header">
        <div class="table-number">Game #${table.table_number}</div>
        <div class="table-timer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>${formatTime(table.time_remaining)}</span>
        </div>
      </div>
      <div class="table-info">
        <div class="players-count">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>${table.players}/${table.max_players} Players • ${table.slots_available} slots</span>
        </div>
        <div class="slots-indicator">
          ${renderSlots(table.players, table.max_players)}
        </div>
      </div>
    `;
    
    tablesGrid.appendChild(card);
  });
}

// --- Render slot indicators ---
function renderSlots(players, maxPlayers) {
  let html = '';
  for (let i = 0; i < maxPlayers; i++) {
    const slotClass = i < players ? 'filled' : 'empty';
    html += `<div class="slot ${slotClass}"></div>`;
  }
  return html;
}

// --- Format time ---
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Join table ---
function joinTable(roundCode) {
  const gameType = typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver';
  window.location.href = `/play/${gameType}?table=${encodeURIComponent(roundCode)}`;
}

// --- Quick play ---
function setupQuickPlay() {
  const quickPlayBtn = document.getElementById('quickPlayBtn');
  
  if (quickPlayBtn) {
    quickPlayBtn.addEventListener('click', () => {
      const availableTable = availableTables.find(t => t.slots_available > 0 && t.is_started);
      
      if (availableTable) {
        joinTable(availableTable.round_code);
      } else {
        alert('All tables are full! Please wait.');
      }
    });
  }
}

// --- Initialize ---
console.log('Game Lobby JS Loaded!');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('Initializing lobby...');
  fetchTables();
  setupQuickPlay();
  
  // Refresh every 2 seconds
  setInterval(fetchTables, 2000);
}
