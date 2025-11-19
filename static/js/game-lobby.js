// === GAME LOBBY - Table Management ===

const USER_ID = localStorage.getItem('user_id') || 'guest';
const USERNAME = localStorage.getItem('username') || 'Player';

// Mock data for tables (replace with real Socket.IO data)
let availableTables = [];

// Initialize 6 tables
function initializeTables() {
  availableTables = [];
  for (let i = 1; i <= 6; i++) {
    availableTables.push({
      tableNumber: `Table ${i}`,
      roundCode: `T${Date.now()}-${i}`,
      players: Math.floor(Math.random() * 5) + 1, // 1-5 players
      maxPlayers: 6,
      timeRemaining: Math.floor(Math.random() * 280) + 20, // 20-300 seconds
      isFull: false
    });
  }
  renderTables();
}

// Render tables
function renderTables() {
  const tablesGrid = document.getElementById('tablesGrid');
  tablesGrid.innerHTML = '';

  availableTables.forEach((table, index) => {
    const isFull = table.players >= table.maxPlayers;
    
    const card = document.createElement('div');
    card.className = `table-card ${isFull ? 'full' : ''}`;
    card.onclick = () => joinTable(table, index);

    card.innerHTML = `
      <div class="table-header">
        <div class="table-number">${table.tableNumber}</div>
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

// Render slot indicators
function renderSlots(players, maxPlayers) {
  let slotsHTML = '';
  for (let i = 0; i < maxPlayers; i++) {
    const slotClass = i < players ? 'filled' : 'empty';
    slotsHTML += `<div class="slot ${slotClass}"></div>`;
  }
  return slotsHTML;
}

// Format time (seconds to MM:SS)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Join table
function joinTable(table, index) {
  if (table.isFull || table.players >= table.maxPlayers) {
    alert('This table is full! Please choose another table.');
    return;
  }

  // Redirect to actual game
  window.location.href = `/play/${GAME_TYPE}`;
}

// Quick play (join first available table)
document.getElementById('quickPlayBtn').addEventListener('click', () => {
  const availableTable = availableTables.find(t => t.players < t.maxPlayers);
  
  if (availableTable) {
    window.location.href = `/play/${GAME_TYPE}`;
  } else {
    alert('All tables are full! Please wait for a new table.');
  }
});

// Update timers every second
function updateTimers() {
  availableTables.forEach((table, index) => {
    table.timeRemaining--;
    
    if (table.timeRemaining <= 0) {
      // Table round ended, reset or remove
      table.players = Math.floor(Math.random() * 3) + 1;
      table.timeRemaining = 300; // 5 minutes
    }

    // Simulate random player joins
    if (Math.random() < 0.1 && table.players < table.maxPlayers) {
      table.players++;
    }

    // Mark as full
    table.isFull = table.players >= table.maxPlayers;
  });

  renderTables();
}

// Initialize
initializeTables();
setInterval(updateTimers, 1000);
