const USER_ID = localStorage.getItem("user_id") || "user_" + Math.floor(Math.random()*999999);
localStorage.setItem("user_id", USER_ID);

const USERNAME = localStorage.getItem("username") || "Player" + Math.floor(Math.random()*9999);
localStorage.setItem("username", USERNAME);

document.getElementById("userName").textContent = USERNAME;

const socket = io();

let selectedNumber = null;
let walletBalance = 0;

/* ---------------------------
   UI Helpers
----------------------------*/

function selectNumber(n) {
    selectedNumber = n;
    document.querySelectorAll(".num-chip").forEach(btn => {
        btn.classList.toggle("selected", parseInt(btn.dataset.number) === n);
    });
}

document.querySelectorAll(".num-chip").forEach(btn => {
    btn.addEventListener("click", () => selectNumber(parseInt(btn.dataset.number)));
});

/* ---------------------------
   Betting Button
----------------------------*/

document.getElementById("placeBetBtn").onclick = () => {
    if (walletBalance < FIXED_BET_AMOUNT) {
        showStatus("Insufficient balance", true);
        return;
    }
    if (selectedNumber === null) {
        showStatus("Select a number first", true);
        return;
    }

    socket.emit("place_bet", {
        game_type: GAME_TYPE,
        user_id: USER_ID,
        username: USERNAME,
        number: selectedNumber
    });
};

function showStatus(msg, error=false) {
    const s = document.getElementById("statusMessage");
    s.textContent = msg;
    s.style.color = error ? "#fca5a5" : "#bbf7d0";
}

/* ---------------------------
   Paratrooper Animation
----------------------------*/

function landParatrooper(winningBoat) {
    const boat = document.getElementById("boat" + winningBoat);
    if (!boat) return;

    const rect = boat.getBoundingClientRect();

    const para = document.getElementById("paratrooper");
    para.style.top = (rect.top - 100) + "px";
    para.style.left = (rect.left + rect.width/2) + "px";
}

/* ---------------------------
   Socket Events
----------------------------*/

socket.on("connect", () => {
    socket.emit("join_game", {
        game_type: GAME_TYPE,
        user_id: USER_ID
    });
});

socket.on("round_data", data => {
    const rd = data.round_data;
    document.getElementById("roundCode").textContent = rd.round_code;
    document.getElementById("playerCount").textContent = rd.players;

    walletBalance = rd.balance || walletBalance;
    document.getElementById("walletBalance").textContent = walletBalance;

});

socket.on("bet_placed", data => {
    document.getElementById("playerCount").textContent = data.round_data.players;
});

socket.on("bet_success", data => {
    walletBalance = data.new_balance;
    document.getElementById("walletBalance").textContent = walletBalance;
    showStatus("Bet placed!", false);
});

socket.on("round_result", data => {
    const winning = data.result;
    showStatus("Winning boat: " + winning);
    landParatrooper(winning);
});

socket.on("timer_update", data => {
    document.getElementById("timerText").textContent = data.time_remaining;
});

/* REGISTER USER */
fetch("/register", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({user_id: USER_ID, username: USERNAME})
})
.then(r => r.json())
.then(d => {
    walletBalance = d.balance;
    document.getElementById("walletBalance").textContent = walletBalance;
});
