const roomList = document.getElementById("roomList");

// Generate unique room numbers
function randomRoomCode() {
  return "F" + Math.floor(100000000 + Math.random() * 900000000);
}

function createRoom() {
  return {
    id: randomRoomCode(),
    slots: 10,
    players: Math.floor(Math.random() * 9),  // 0-9
    timer: Math.floor(Math.random() * 50) + 10 // 10-60 sec
  };
}

// Render one room card
function renderRoom(room) {
  return `
    <div class="room-card" id="${room.id}">
      <div class="room-info">
        <h4>Game #${room.id}</h4>
        <div>${room.players}/${room.slots} Players</div>
        <div>⏳ ${room.timer}s</div>
      </div>
      <button class="join-btn" onclick="enterRoom('${room.id}')">Join</button>
    </div>
  `;
}

function enterRoom(roomId) {
  window.location.href = "/silver-game"; // redirect to your game window
}

// Maintain 6 live rooms
let rooms = [];

function refreshRooms() {
  // update timers & players
  rooms.forEach(r => {
    r.timer--;
    if (r.timer <= 0) r.timer = Math.floor(Math.random() * 60) + 10;
    if (r.players < r.slots) r.players++;
  });

  // remove full rooms
  rooms = rooms.filter(r => r.players < r.slots);

  // keep 6 rooms at all times
  while (rooms.length < 6) {
    rooms.push(createRoom());
  }

  // re-render
  roomList.innerHTML = rooms.map(r => renderRoom(r)).join("");
}

// Run every 1 second
setInterval(refreshRooms, 1000);

// Initial render
refreshRooms();
