const coinsAvailableEl = document.getElementById("coinsAvailable");
const coinsRedeemableEl = document.getElementById("coinsRedeemable");
const redeemForm = document.getElementById("redeemForm");
const redeemInput = document.getElementById("redeemAmount");
const redeemStatus = document.getElementById("redeemStatus");
const txnList = document.getElementById("txnList");

// ================== STATE ==================

let currentBalance = 0;
let transactionHistory = [];

// ================== INITIALIZE BALANCE ==================

function initializeBalance() {
  if (typeof INITIAL_BALANCE !== "undefined" && INITIAL_BALANCE !== null) {
    currentBalance = typeof INITIAL_BALANCE === "number"
      ? INITIAL_BALANCE
      : parseInt(INITIAL_BALANCE || 0, 10);
  } else {
    fetchBalance();
    return;
  }

  if (isNaN(currentBalance)) currentBalance = 0;
  updateBalanceUI();
  loadTransactionHistory();
}

async function fetchBalance() {
  try {
    const res = await fetch("/api/balance");
    if (!res.ok) {
      setStatus("Failed to load balance", "error");
      return;
    }

    const data = await res.json();
    if (data.balance !== undefined) {
      currentBalance = parseInt(data.balance, 10) || 0;
      updateBalanceUI();
      loadTransactionHistory();
    }
  } catch (err) {
    console.error("[fetchBalance] Error:", err);
    setStatus("Could not load balance. Please refresh.", "error");
  }
}

// ================== TRANSACTION HISTORY ==================

async function loadTransactionHistory() {
  try {
    // For now, fetch from user game history
    const res = await fetch("/api/user-games");
    if (!res.ok) return;

    const data = await res.json();
    const allGames = [...(data.current_games || []), ...(data.game_history || [])];
    
    transactionHistory = [];

    // Convert games to transactions
    allGames.forEach(game => {
      if (game.status === "win") {
        transactionHistory.push({
          date: game.date_time || new Date().toLocaleDateString(),
          type: "win",
          details: `${game.game_type.charAt(0).toUpperCase() + game.game_type.slice(1)} Won`,
          amount: game.amount,
          amountType: "win"
        });
      } else if (game.status === "lose") {
        transactionHistory.push({
          date: game.date_time || new Date().toLocaleDateString(),
          type: "loss",
          details: `${game.game_type.charAt(0).toUpperCase() + game.game_type.slice(1)} Lost`,
          amount: -game.amount,
          amountType: "removed"
        });
      }
    });

    // Sort by most recent
    transactionHistory.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });

    renderTransactionHistory();
  } catch (err) {
    console.error("[loadTransactionHistory] Error:", err);
  }
}

function renderTransactionHistory() {
  if (transactionHistory.length === 0) {
    txnList.innerHTML = '<div class="empty-state">No transactions yet</div>';
    return;
  }

  txnList.innerHTML = transactionHistory
    .slice(0, 50) // Limit to 50 most recent
    .map(txn => `
      <div class="txn-row">
        <div class="txn-date">${txn.date}</div>
        <div class="txn-type ${txn.type}">${txn.type === 'win' ? '✓ Win' : '✗ Loss'}</div>
        <div class="txn-game">${txn.details}</div>
        <div class="txn-amount ${txn.amountType}">
          ${txn.amountType === 'removed' ? '−' : '+'}${Math.abs(txn.amount)}
        </div>
      </div>
    `)
    .join("");
}

// ================== UI HELPERS ==================

function updateBalanceUI() {
  if (coinsAvailableEl) {
    coinsAvailableEl.textContent = currentBalance.toLocaleString();
  }
  if (coinsRedeemableEl) {
    coinsRedeemableEl.textContent = currentBalance.toLocaleString();
  }
}

function setStatus(msg, type = "") {
  if (!redeemStatus) return;
  redeemStatus.textContent = msg || "";
  redeemStatus.className = "redeem-status";
  if (type) {
    redeemStatus.classList.add(type);
  }
}

// ================== REDEEM HANDLER ==================

if (redeemForm) {
  redeemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("");

    const raw = redeemInput.value.trim();
    const amount = parseInt(raw, 10);

    // Validation
    if (!raw || isNaN(amount) || amount <= 0) {
      setStatus("Please enter a valid integer amount.", "error");
      return;
    }

    if (amount > currentBalance) {
      setStatus(`You only have ${currentBalance.toLocaleString()} coins available.`, "error");
      return;
    }

    // Disable button during request
    const submitBtn = redeemForm.querySelector("button[type='submit']");
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing...";

    try {
      const res = await fetch("/api/coins/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setStatus(data.message || "Redeem failed. Please try again.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }

      // Update balance from response
      if (data.new_balance !== undefined) {
        currentBalance = parseInt(data.new_balance, 10);
      } else {
        currentBalance -= amount;
      }

      updateBalanceUI();
      redeemInput.value = "";
      setStatus(data.message || `Successfully redeemed ${amount.toLocaleString()} coins!`, "ok");

      // Add to transaction history
      transactionHistory.unshift({
        date: new Date().toLocaleDateString(),
        type: "redeem",
        details: "Coins Redeemed",
        amount: amount,
        amountType: "removed"
      });
      renderTransactionHistory();

      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;

      // Clear status after 3 seconds
      setTimeout(() => {
        setStatus("");
      }, 3000);
    } catch (err) {
      console.error("[redeem] Error:", err);
      setStatus("Network error. Please check your connection and try again.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// ================== INIT ==================

document.addEventListener("DOMContentLoaded", () => {
  console.log("[coins.js] Initializing...");
  initializeBalance();
});
