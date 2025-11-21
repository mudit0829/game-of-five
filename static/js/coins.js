const coinsAvailableEl = document.getElementById("coinsAvailable");
const coinsRedeemableEl = document.getElementById("coinsRedeemable");
const redeemForm = document.getElementById("redeemForm");
const redeemInput = document.getElementById("redeemAmount");
const redeemStatus = document.getElementById("redeemStatus");

let currentBalance = typeof INITIAL_BALANCE === "number"
  ? INITIAL_BALANCE
  : parseInt(INITIAL_BALANCE || 0, 10) || 0;

function updateBalanceUI() {
  if (coinsAvailableEl) coinsAvailableEl.textContent = currentBalance;
  if (coinsRedeemableEl) coinsRedeemableEl.textContent = currentBalance;
}

function setStatus(msg, type) {
  if (!redeemStatus) return;
  redeemStatus.textContent = msg || "";
  redeemStatus.className = "redeem-status";
  if (type) redeemStatus.classList.add(type);
}

updateBalanceUI();

if (redeemForm) {
  redeemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("");

    const raw = redeemInput.value.trim();
    const amount = parseInt(raw, 10);

    if (!raw || isNaN(amount) || amount <= 0) {
      setStatus("Please enter a valid integer amount.", "error");
      return;
    }

    if (amount > currentBalance) {
      setStatus("You don't have that many coins.", "error");
      return;
    }

    try {
      const res = await fetch("/api/coins/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const data = await res.json();

      if (!data.success) {
        setStatus(data.message || "Redeem failed.", "error");
        return;
      }

      currentBalance = data.new_balance;
      updateBalanceUI();
      redeemInput.value = "";
      setStatus(data.message || "Coins redeemed successfully.", "ok");
    } catch (err) {
      console.error("redeem error", err);
      setStatus("Something went wrong. Please try again.", "error");
    }
  });
}
