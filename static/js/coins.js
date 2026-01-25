const coinsAvailableEl = document.getElementById("coinsAvailable");
const coinsRedeemableEl = document.getElementById("coinsRedeemable");
const redeemForm = document.getElementById("redeemForm");
const redeemInput = document.getElementById("redeemAmount");
const redeemStatus = document.getElementById("redeemStatus");

// ================== STATE ==================

let currentBalance = 0;

// ================== INITIALIZE BALANCE ==================

function initializeBalance() {
  // Try to get balance from window variable (passed from Flask template)
  if (typeof INITIAL_BALANCE !== "undefined" && INITIAL_BALANCE !== null) {
    currentBalance = typeof INITIAL_BALANCE === "number"
      ? INITIAL_BALANCE
      : parseInt(INITIAL_BALANCE || 0, 10);
  } else {
    // Fallback: fetch from API if not in template
    fetchBalance();
    return;
  }

  if (isNaN(currentBalance)) currentBalance = 0;
  updateBalanceUI();
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
    }
  } catch (err) {
    console.error("[fetchBalance] Error:", err);
    setStatus("Could not load balance. Please refresh.", "error");
  }
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

    // Clear any previous status
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
