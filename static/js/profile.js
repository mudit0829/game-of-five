// profile.js

document.addEventListener("DOMContentLoaded", () => {
  // ===== MAIN TABS (Profile / Coin Transactions) =====
  const tabs = document.querySelectorAll(".section-tabs .tab");
  const sections = {
    profile: document.getElementById("section-profile"),
    transactions: document.getElementById("section-transactions"),
  };

  function showSection(name) {
    // hide all sections
    Object.values(sections).forEach(sec => {
      if (!sec) return;
      sec.classList.remove("active-section");
    });

    // show requested section
    if (sections[name]) {
      sections[name].classList.add("active-section");
    }

    // update active tab styling
    tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.target === name);
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      showSection(tab.dataset.target);
    });
  });

  showSection("profile"); // default

  // ===== SAVE PROFILE (simple front-end message) =====
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const profileStatus = document.getElementById("profileStatus");

  if (saveProfileBtn && profileStatus) {
    saveProfileBtn.addEventListener("click", async () => {
      const payload = {
        displayName: document.getElementById("displayName").value || "",
        email: document.getElementById("email").value || "",
        country: document.getElementById("country").value || "",
        phone: document.getElementById("phone").value || "",
      };

      try {
        const res = await fetch("/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success) {
          profileStatus.textContent = "Profile saved successfully.";
        } else {
          profileStatus.textContent = data.message || "Unable to save profile.";
        }
      } catch (err) {
        console.error(err);
        profileStatus.textContent = "Network error while saving profile.";
      }
    });
  }

  // ===== COIN TRANSACTIONS =====
  const txnList = document.getElementById("txnList");
  const subTabs = document.querySelectorAll(".sub-tabs .sub-tab");

  const sumAddedEl = document.getElementById("sumAdded");
  const sumBetEl = document.getElementById("sumBet");
  const sumWinEl = document.getElementById("sumWin");
  const sumBalanceEl = document.getElementById("sumBalance");

  // ✅ SAFE: Handle undefined TRANSACTIONS
  const txns = Array.isArray(window.TRANSACTIONS) ? window.TRANSACTIONS : [];
  
  console.log("TRANSACTIONS loaded:", txns.length, "items");

  function formatDate(dateString) {
    if (!dateString) return "";
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return dateString;
      return d.toLocaleString("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch (e) {
      console.error("Date format error:", e);
      return dateString;
    }
  }

  function renderTransactions(filter = "all") {
    if (!txnList) return;

    // no transactions → show empty state & totals only
    if (!txns.length) {
      txnList.innerHTML = `
        <div class="empty-state">
          No transactions yet.<br>
          Your deposits, bets and winnings will appear here.
        </div>
      `;
      if (sumAddedEl) sumAddedEl.textContent = "₹0";
      if (sumBetEl) sumBetEl.textContent = "₹0";
      if (sumWinEl) sumWinEl.textContent = "₹0";
      if (sumBalanceEl && typeof WALLET_BALANCE !== "undefined") {
        sumBalanceEl.textContent = `₹${WALLET_BALANCE}`;
      }
      return;
    }

    // ✅ SAFE: compute totals with explicit type conversion
    let sumAdded = 0, sumBet = 0, sumWin = 0;
    txns.forEach(t => {
      try {
        const kind = String(t.kind || "").toLowerCase();
        const amt = Number(t.amount || 0);
        if (kind === "added") sumAdded += amt;
        else if (kind === "bet") sumBet += amt;
        else if (kind === "win") sumWin += amt;
      } catch (e) {
        console.error("Error processing transaction:", t, e);
      }
    });

    // ✅ SAFE: apply filter with type checking
    const filtered = txns.filter(t => {
      try {
        const kind = String(t.kind || "").toLowerCase();
        if (filter === "all") return true;
        if (filter === "balance") return true; // show all rows under Balance tab
        return kind === filter;
      } catch (e) {
        console.error("Error filtering transaction:", t, e);
        return false;
      }
    });

    // ✅ SAFE: build rows with comprehensive error handling
    const rows = filtered.map(t => {
      try {
        const kind = String(t.kind || "other").toLowerCase();
        let amountClass = "balance";
        if (kind === "added") amountClass = "added";
        else if (kind === "bet") amountClass = "bet";
        else if (kind === "win") amountClass = "win";

        const sign = (kind === "bet") ? "-" : "+";
        const amt = Number(t.amount || 0);
        const formattedAmt = `${sign}₹${amt}`;

        // ✅ SAFE: property access with fallbacks
        const label = String(t.label || t.kind || "Transaction");
        const gameInfo = String(t.game_title || t.note || "");
        const balanceAfter = Number(t.balance_after || 0);

        return `
          <div class="txn-row">
            <div class="txn-date">${formatDate(t.datetime)}</div>
            <div class="txn-type">${label}</div>
            <div class="txn-game">${gameInfo}</div>
            <div class="txn-amount ${amountClass}">${formattedAmt}</div>
            <div class="txn-after">₹${balanceAfter}</div>
          </div>
        `;
      } catch (e) {
        console.error("Error rendering transaction row:", t, e);
        return `
          <div class="txn-row">
            <div class="txn-date">Error</div>
            <div class="txn-type">-</div>
            <div class="txn-game">-</div>
            <div class="txn-amount">-</div>
            <div class="txn-after">-</div>
          </div>
        `;
      }
    });

    txnList.innerHTML = rows.join("");

    // ✅ SAFE: update summary cards
    if (sumAddedEl) sumAddedEl.textContent = `₹${sumAdded}`;
    if (sumBetEl) sumBetEl.textContent = `₹${sumBet}`;
    if (sumWinEl) sumWinEl.textContent = `₹${sumWin}`;
    if (sumBalanceEl && typeof WALLET_BALANCE !== "undefined") {
      sumBalanceEl.textContent = `₹${WALLET_BALANCE}`;
    }
  }

  subTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const filter = tab.dataset.filter || "all";

      subTabs.forEach(st => st.classList.remove("active"));
      tab.classList.add("active");

      renderTransactions(filter);
    });
  });

  // Initial render
  renderTransactions("all");
});
