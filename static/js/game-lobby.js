// === GAME LOBBY - Working Tables with Timers & Slots ===

const USER_ID = localStorage.getItem('user_id') || 'guest';
const USERNAME = localStorage.getItem('username') || 'Player';
const GAME_DURATION = 5 * 60; // 5 minutes in seconds
const TABLE_COUNT = 6;

let availableTables = [];
let tableBaseId = Date.now();

// --- Initialize 6 tables with staggered timers ---
function initializeTables() {
  availableTables = [];
  
  for (let i = 0; i < TABLE_COUNT; i++) {
    // Each table starts 1 minute (60 seconds) apart
    const timeOffset = i * 60;
    const timeRemaining = GAME_DURATION - timeOffset;
    
    availableTables.push({
      id: `GAME${tableBaseId + i}`,
      tableNumber: i + 1,
      roundCode: `F${tableBaseId + i}`,
      players: Math.floor(Math.random() * 4) + 1, // 1-4 players initially
      maxPlayers: 6,
      timeRemaining: timeRemaining > 0 ? timeRemaining : 60, // Minimum 60 seconds
      isFull: false
    });
  }
  
  console.log('Tables initialized:', availableTables);
  renderTables();
}

// --- Render all tables to DOM ---
function renderTables() {
  const tablesGrid = document.getElementById('tablesGrid');
  
  if (!tablesGrid) {
    console.error('tablesGrid element not found!');
    return;
  }
  
  tablesGrid.innerHTML = '';
  
  availableTables.forEach((table, index) => {
    const isFull = table.players >= table.maxPlayers;
    
    const card = document.createElement('div');
    card.className = `table-card ${isFull ? 'full' : ''}`;
    
    if (!isFull) {
      card.onclick = () => joinTable(index);
    }
    
    card.innerHTML = `
      <div class="table-header">
        <div class="table-number">Game #${table.tableNumber}</div>
        <div class="table-timer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>${formatTime(table.timeRemaining)}</span>
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
          <span>${table.players}/${table.maxPlayers} Players</span>
        </div>
        <div class="slots-indicator">
          ${renderSlots(table.players, table.maxPlayers)}
        </div>
      </div>
    `;
    
    tablesGrid.appendChild(card);
  });
}

// --- Render slot indicators (green/gray dots) ---
function renderSlots(players, maxPlayers) {
  let html = '';
  for (let i = 0; i < maxPlayers; i++) {
    const slotClass = i < players ? 'filled' : 'empty';
    html += `<div class="slot ${slotClass}"></div>`;
  }
  return html;
}

// --- Format seconds to MM:SS ---
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Join specific table ---
function joinTable(index) {
  const table = availableTables[index];
  
  if (!table || table.isFull) {
    alert('This table is full! Please choose another table.');
    return;
  }
  
  console.log('Joining table:', table.tableNumber);
  
  const gameType = typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver';
  window.location.href = `/play/${gameType}?table=${encodeURIComponent(table.roundCode)}`;
}

// --- Quick play button - join first available table ---
function setupQuickPlay() {
  const quickPlayBtn = document.getElementById('quickPlayBtn');
  
  if (quickPlayBtn) {
    quickPlayBtn.addEventListener('click', () => {
      const availableTable = availableTables.find(t => !t.isFull && t.players < t.maxPlayers);
      
      if (availableTable) {
        const gameType = typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver';
        window.location.href = `/play/${gameType}?table=${encodeURIComponent(availableTable.roundCode)}`;
      } else {
        alert('All tables are full! Please wait for a new table.');
      }
    });
  }
}

// --- Update tables every second ---
function updateTables() {
  let needsFullRender = false;
  
  availableTables.forEach((table, index) => {
    // Decrease timer
    table.timeRemaining--;
    
    // Reset table if time runs out
    if (table.timeRemaining <= 0) {
      table.players = Math.floor(Math.random() * 3) + 1;
      table.timeRemaining = GAME_DURATION - (index * 60); // Stagger again
      table.id = `GAME${Date.now()}${index}`;
      table.roundCode = `F${Date.now()}${index}`;
      needsFullRender = true;
    }
    
    // Randomly add players (10% chance per second)
    if (Math.random() < 0.1 && table.players < table.maxPlayers) {
      table.players++;
      needsFullRender = true;
    }
    
    // Mark table as full
    if (table.players >= table.maxPlayers) {
      table.isFull = true;
      needsFullRender = true;
    } else {
      table.isFull = false;
    }
  });
  
  // Full re-render if any changes
  if (needsFullRender) {
    renderTables();
  } else {
    // Just update timer text without full re-render (performance optimization)
    document.querySelectorAll('.table-timer span').forEach((span, index) => {
      if (availableTables[index]) {
        span.textContent = formatTime(availableTables[index].timeRemaining);
      }
    });
  }
}

// --- Initialize on page load ---
console.log('Game Lobby JS Loaded!');

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('Initializing lobby...');
  initializeTables();
  setupQuickPlay();
  
  // Update every second
  setInterval(updateTables, 1000);
}
