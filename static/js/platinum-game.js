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
   CSS Paratrooper Animation
----------------------------*/

function landCSSParatrooper(winningNumber) {
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
    const para = document.getElementById("cssParatrooper");

    // Calculate precise landing position
    const landingTop = rect.top - 70;
    const landingLeft = rect.left + rect.width / 2;

    // Reset to top
    para.style.transition = "none";
    para.style.top = "-300px";
    para.style.left = "50%";
    para.style.transform = "translateX(-50%)";
    para.classList.remove("falling");

    // Force reflow
    void para.offsetWidth;

    // Start falling with swing
    setTimeout(() => {
        para.classList.add("falling");
        para.style.transition = "top 2.8s cubic-bezier(0.22, 0.61, 0.36, 1), left 2.8s cubic-bezier(0.22, 0.61, 0.36, 1)";
        para.style.top = landingTop + "px";
        para.style.left = landingLeft + "px";

        // Landing effects
        setTimeout(() => {
            targetBoat.classList.add("win");
            createLandingSplash(rect);
            
            // Stop swinging
            setTimeout(() => {
                para.classList.remove("falling");
            }, 100);
        }, 2600);
    }, 50);
}

/* ---------------------------
   Landing Splash Effect
----------------------------*/

function createLandingSplash(boatRect) {
    const centerX = boatRect.left + boatRect.width / 2;
    const centerY = boatRect.top + boatRect.height / 2;

    // Main splash
    const splash = document.createElement("div");
    splash.style.position = "fixed";
    splash.style.top = centerY + "px";
    splash.style.left = centerX + "px";
    splash.style.transform = "translate(-50%, -50%)";
    splash.style.width = "250px";
    splash.style.height = "250px";
    splash.style.background = "radial-gradient(circle, rgba(34,197,94,0.7) 0%, rgba(34,197,94,0.4) 40%, transparent 70%)";
    splash.style.borderRadius = "50%";
    splash.style.pointerEvents = "none";
    splash.style.animation = "splashPulse 1s ease-out";
    splash.style.zIndex = "100";
    document.body.appendChild(splash);

    // Ripple waves
    for (let i = 0; i < 3; i++) {
        setTimeout(() => {
            const ripple = document.createElement("div");
            ripple.style.position = "fixed";
            ripple.style.top = centerY + "px";
            ripple.style.left = centerX + "px";
            ripple.style.transform = "translate(-50%, -50%)";
            ripple.style.width = "100px";
            ripple.style.height = "100px";
            ripple.style.border = "3px solid rgba(34, 197, 94, 0.6)";
            ripple.style.borderRadius = "50%";
            ripple.style.pointerEvents = "none";
            ripple.style.animation = "rippleExpand 1.2s ease-out";
            ripple.style.zIndex = "99";
            document.body.appendChild(ripple);

            setTimeout(() => ripple.remove(), 1200);
        }, i * 200);
    }

    setTimeout(() => splash.remove(), 1000);
}

// Splash animations
if (!document.getElementById("splash-animations")) {
    const style = document.createElement("style");
    style.id = "splash-animations";
    style.textContent = `
        @keyframes splashPulse {
            0% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.3);
            }
            40% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }
            100% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(1.8);
            }
        }
        
        @keyframes rippleExpand {
            0% {
                opacity: 0.8;
                transform: translate(-50%, -50%) scale(0.5);
            }
            100% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(2.5);
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

    // Reset paratrooper
    const para = document.getElementById("cssParatrooper");
    para.style.transition = "none";
    para.style.top = "-300px";
    para.style.left = "50%";
    para.style.transform = "translateX(-50%)";
    para.classList.remove("falling");

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
    
    setTimeout(() => {
        landCSSParatrooper(winning);
    }, 150);
});

socket.on("timer_update", data => {
    const timeRemaining = data.time_remaining || 0;
    document.getElementById("timerText").textContent = timeRemaining.toString().padStart(2, "0");
    document.getElementById("playerCount").textContent = data.players || 0;
    
    const pill = document.querySelector(".timer-pill");
    if (timeRemaining <= 10) {
        pill.classList.add("urgent");
    } else {
        pill.classList.remove("urgent");
    }
});

socket.on("betting_closed", data => {
    if (data.game_type !== GAME_TYPE) return;
    showStatus("Betting closed", true);
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
