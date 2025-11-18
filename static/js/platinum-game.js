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

function showStatus(msg, error=false) {
    const s = document.getElementById("statusMessage");
    s.textContent = msg;
    s.className = "status";
    if (error) {
        s.classList.add("error");
    } else {
        s.classList.add("ok");
    }
}

function updateWallet(balance) {
    walletBalance = balance;
    document.getElementById("walletBalance").textContent = walletBalance;
    document.querySelector(".coins").classList.add("coin-bounce");
    setTimeout(() => {
        document.querySelector(".coins").classList.remove("coin-bounce");
    }, 500);
}

/* ---------------------------
   Update Boats from Bets
----------------------------*/

function updateBoatsFromBets(bets) {
    const uniqueBets = [];
    (bets || []).forEach((b) => {
        if (!uniqueBets.find((x) => x.number === b.number)) {
            uniqueBets.push(b);
        }
    });

    const boats = document.querySelectorAll(".boat");
    boats.forEach((boat, i) => {
        const numSpan = boat.querySelector(".boat-number");
        const userSpan = boat.querySelector(".boat-user");
        boat.classList.remove("win");

        const bet = uniqueBets[i];

        if (!bet) {
            boat.dataset.number = "";
            numSpan.textContent = "";
            userSpan.textContent = "";
        } else {
            boat.dataset.number = String(bet.number);
            numSpan.textContent = bet.number;
            userSpan.textContent = bet.username;
        }
    });
}

/* ---------------------------
   Update My Bets Display
----------------------------*/

function updateMyBets(bets) {
    const myBets = (bets || []).filter((b) => b.user_id === USER_ID);
    const container = document.getElementById("myBetsContainer");
    
    // Update bet count
    document.getElementById("userBets").textContent = myBets.length;
    
    container.innerHTML = "";
    
    if (myBets.length === 0) {
        container.innerHTML = '<span style="color: #6b7280; font-size: 11px;">none</span>';
        return;
    }

    myBets.forEach((b) => {
        const chip = document.createElement("span");
        chip.className = "my-bet-chip";
        chip.textContent = b.number;
        container.appendChild(chip);
    });
}

/* ---------------------------
   Number Chip Click Events
----------------------------*/

document.querySelectorAll(".num-chip").forEach(btn => {
    btn.addEventListener("click", () => {
        selectNumber(parseInt(btn.dataset.number));
    });
});

/* ---------------------------
   Place Bet Button
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

/* ---------------------------
   Paratrooper Animation (SMOOTH)
----------------------------*/

function landParatrooper(winningNumber) {
    const boats = document.querySelectorAll(".boat");
    let targetBoat = null;

    // Find boat with winning number
    boats.forEach(boat => {
        if (boat.dataset.number === String(winningNumber)) {
            targetBoat = boat;
        }
    });

    if (!targetBoat) {
        console.log("Winning number not on any boat:", winningNumber);
        return;
    }

    const rect = targetBoat.getBoundingClientRect();
    const para = document.getElementById("paratrooper");

    // Calculate landing position (on top of boat)
    const landingTop = rect.top - 80;
    const landingLeft = rect.left + rect.width / 2;

    // Reset paratrooper to top
    para.style.transition = "none";
    para.style.top = "-260px";
    para.style.left = "50%";
    para.style.transform = "translateX(-50%)";

    // Force reflow
    void para.offsetWidth;

    // Animate smooth landing
    setTimeout(() => {
        para.style.transition = "top 2.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), left 2.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 2.2s ease-out";
        para.style.top = landingTop + "px";
        para.style.left = landingLeft + "px";
        para.style.transform = "translateX(-50%)";

        // Mark winning boat with glow
        setTimeout(() => {
            targetBoat.classList.add("win");
        }, 2000);

        // Create landing splash effect
        setTimeout(() => {
            const splash = document.createElement("div");
            splash.style.position = "fixed";
            splash.style.top = (rect.top + rect.height / 2) + "px";
            splash.style.left = (rect.left + rect.width / 2) + "px";
            splash.style.transform = "translate(-50%, -50%)";
            splash.style.width = "200px";
            splash.style.height = "200px";
            splash.style.background = "radial-gradient(circle, rgba(34,197,94,0.6) 0%, rgba(34,197,94,0.3) 40%, transparent 70%)";
            splash.style.borderRadius = "50%";
            splash.style.pointerEvents = "none";
            splash.style.animation = "splashEffect 0.8s ease-out";
            splash.style.zIndex = "100";
            document.body.appendChild(splash);

            setTimeout(() => splash.remove(), 800);
        }, 2100);
    }, 50);
}

// Splash animation CSS
if (!document.getElementById("splash-animation")) {
    const style = document.createElement("style");
    style.id = "splash-animation";
    style.textContent = `
        @keyframes splashEffect {
            0% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.3);
            }
            50% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }
            100% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(1.5);
            }
        }
    `;
    document.head.appendChild(style);
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
    
    document.getElementById("roundCode").textContent = rd.round_code || rd.round_number || "--";
    document.getElementById("playerCount").textContent = rd.players || 0;

    walletBalance = rd.balance || walletBalance;
    document.getElementById("walletBalance").textContent = walletBalance;

    updateBoatsFromBets(rd.bets || []);
    updateMyBets(rd.bets || []);
});

socket.on("new_round", data => {
    const rd = data.round_data;
    
    document.getElementById("roundCode").textContent = data.round_code || rd.round_number || "--";
    document.getElementById("playerCount").textContent = rd.players || 0;

    updateBoatsFromBets(rd.bets || []);
    updateMyBets(rd.bets || []);
    showStatus("New round started", false);

    // Reset paratrooper to top
    const para = document.getElementById("paratrooper");
    para.style.transition = "none";
    para.style.top = "-260px";
    para.style.left = "50%";
    para.style.transform = "translateX(-50%)";

    // Remove urgent timer styling
    document.querySelector(".timer-pill").classList.remove("urgent");
});

socket.on("bet_placed", data => {
    const rd = data.round_data;
    document.getElementById("playerCount").textContent = rd.players || 0;
    updateBoatsFromBets(rd.bets || []);
    updateMyBets(rd.bets || []);
});

socket.on("bet_success", data => {
    updateWallet(data.new_balance);
    showStatus("Bet placed successfully!", false);
});

socket.on("bet_error", data => {
    showStatus(data.message || "Bet error", true);
});

socket.on("round_result", data => {
    const winning = data.result;
    showStatus("Winning: " + winning + "! 🎉", false);
    
    // Small delay before paratrooper animation
    setTimeout(() => {
        landParatrooper(winning);
    }, 150);
});

socket.on("timer_update", data => {
    const timeRemaining = data.time_remaining || 0;
    document.getElementById("timerText").textContent = timeRemaining.toString().padStart(2, "0");
    document.getElementById("playerCount").textContent = data.players || 0;
    
    // Add urgent styling at 10 seconds
    const pill = document.querySelector(".timer-pill");
    if (timeRemaining <= 10) {
        pill.classList.add("urgent");
    } else {
        pill.classList.remove("urgent");
    }
});

socket.on("betting_closed", data => {
    if (data.game_type !== GAME_TYPE) return;
    showStatus("Betting closed for this round", true);
});

/* ---------------------------
   Register User
----------------------------*/

fetch("/register", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({user_id: USER_ID, username: USERNAME})
})
.then(r => r.json())
.then(d => {
    if (d && d.success) {
        updateWallet(d.balance || 0);
    }
})
.catch(err => {
    console.error("Registration error:", err);
});

/* ---------------------------
   Initialize
----------------------------*/

selectNumber(0);
showStatus("");
