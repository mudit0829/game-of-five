// === GAME LOBBY - Table Management (Simplified & Working) ===

console.log('Game Lobby JS Loaded!'); // Debug message

const USER_ID = localStorage.getItem('user_id') || 'guest';
const USERNAME = localStorage.getItem('username') || 'Player';

// Store available tables
let availableTables = [];

// Initialize 6 tables on page load
function initializeTables() {
  console.log('Initializing tables...'); // Debug
  
  availableTables = [];
  
  for (let i = 1; i <= 6; i++) {
    availableTables.push({
      tableNumber: i,
      roundCode: `GAME${Date.now()}-${i}`,
      players: Math.floor(Math.random() * 4) + 1, // 1-4 players
      maxPlayers: 6,
      timeRemaining: Math.floor(Math.random() * 250) + 50, // 50-300 seconds
      isFull: false
    });
  }
  
  console.log('Tables created:', availableTables); // Debug
  renderTables();
}

// Render all tables to the page
function renderTables() {
  const tablesGrid = document.getElementById('tablesGrid');
  
  if (!tablesGrid) {
    console.error('tablesGrid element not found!');
    return;
  }
  
  tablesGrid.innerHTML = ''; // Clear existing cards
  
  availableTables.forEach((table, index) => {
    const isFull = table.players >= table.maxPlayers;
    
    // Create card element
    const card = document.createElement('div');
    card.className = `table-card ${isFull ? 'full' : ''}`;
    
    if (!isFull) {
      card.onclick = () => joinTable(index);
    }
    
    // Build card HTML
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
          ${generateSlots(table.players, table.maxPlayers)}
        </div>
      </div>
    `;
    
    tablesGrid.appendChild(card);
  });
  
  console.log('Tables rendered successfully');
}

// Generate slot indicator dots
function generateSlots(filled, total) {
  let html = '';
  for (let i = 0; i < total; i++) {
    const slotClass = i < filled ? 'filled' : 'empty';
    html += `<div class="slot ${slotClass}"></div>`;
  }
  return html;
}

// Format seconds to MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Join a specific table
function joinTable(index) {
  const table = availableTables[index];
  
  if (table.isFull || table.players >= table.maxPlayers) {
    alert('This table is full! Please choose another table.');
    return;
  }
  
  console.log('Joining table:', table.tableNumber);
  
  // Get game type from page (set in HTML template)
  const gameType = typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver';
  
  // Redirect to actual game
  window.location.href = `/play/${gameType}`;
}

// Quick play button - join first available table
function setupQuickPlay() {
  const quickPlayBtn = document.getElementById('quickPlayBtn');
  
  if (quickPlayBtn) {
    quickPlayBtn.addEventListener('click', () => {
      const availableTable = availableTables.find(t => !t.isFull && t.players < t.maxPlayers);
      
      if (availableTable) {
        const gameType = typeof GAME_TYPE !== 'undefined' ? GAME_TYPE : 'silver';
        window.location.href = `/play/${gameType}`;
      } else {
        alert('All tables are full! Please wait for a new table.');
      }
    });
  }
}

// Update table timers and simulate player activity
function updateTables() {
  let needsUpdate = false;
  
  availableTables.forEach((table) => {
    // Decrease timer
    table.timeRemaining--;
    
    // Reset table if time runs out
    if (table.timeRemaining <= 0) {
      table.players = Math.floor(Math.random() * 3) + 1;
      table.timeRemaining = 300; // 5 minutes
      needsUpdate = true;
    }
    
    // Randomly add players (10% chance per second)
    if (Math.random() < 0.1 && table.players < table.maxPlayers) {
      table.players++;
      needsUpdate = true;
    }
    
    // Mark table as full
    table.isFull = table.players >= table.maxPlayers;
    
    // Remove full table and create new one (keep 6 tables always)
    if (table.isFull && Math.random() < 0.05) {
      needsUpdate = true;
    }
  });
  
  if (needsUpdate) {
    renderTables();
  } else {
    // Just update timers without full re-render
    document.querySelectorAll('.table-timer span').forEach((span, index) => {
      if (availableTables[index]) {
        span.textContent = formatTime(availableTables[index].timeRemaining);
      }
    });
  }
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded');
  
  // Initialize tables
  initializeTables();
  
  // Setup quick play button
  setupQuickPlay();
  
  // Update every second
  setInterval(updateTables, 1000);
});

// Also try initializing if DOMContentLoaded already fired
if (document.readyState === 'loading') {
  // Still loading, wait for DOMContentLoaded
  console.log('Waiting for DOM...');
} else {
  // DOM already loaded
  console.log('DOM already ready, initializing now...');
  initializeTables();
  setupQuickPlay();
  setInterval(updateTables, 1000);
}
