document.addEventListener("DOMContentLoaded", () => {
  // ===== MAIN TABS =====
  const tabs = document.querySelectorAll(".section-tabs .tab");
  const sections = {
    profile: document.getElementById("section-profile"),
    transactions: document.getElementById("section-transactions"),
  };

  function showSection(name) {
    Object.values(sections).forEach((sec) => {
      if (!sec) return;
      sec.classList.remove("active-section");
    });

    if (sections[name]) {
      sections[name].classList.add("active-section");
    }

    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.target === name);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      showSection(tab.dataset.target);
    });
  });

  showSection("profile");

  // ===== SAVE PROFILE =====
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const profileStatus = document.getElementById("profileStatus");

  if (saveProfileBtn && profileStatus) {
    saveProfileBtn.addEventListener("click", async () => {
      const payload = {
        displayName: document.getElementById("displayName")?.value || "",
        email: document.getElementById("email")?.value || "",
        country: document.getElementById("country")?.value || "",
        phone: document.getElementById("phone")?.value || "",
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

  // ===== TRANSACTIONS =====
  const txnList = document.getElementById("txnList");
  const subTabs = document.querySelectorAll(".sub-tabs .sub-tab");

  const sumAddedEl = document.getElementById("sumAdded");
  const sumBetEl = document.getElementById("sumBet");
  const sumWinEl = document.getElementById("sumWin");
  const sumBalanceEl = document.getElementById("sumBalance");

  const txns = Array.isArray(window.TRANSACTIONS) ? window.TRANSACTIONS : [];
  const walletBalanceFromTemplate = Number(window.WALLET_BALANCE ?? 0) || 0;

  console.log("TRANSACTIONS:", txns);
  console.log("WALLET_BALANCE:", walletBalanceFromTemplate);

  function formatDate(dateString) {
    return dateString || "";
  }

  function getTxnBalance(txn) {
    const raw =
      txn?.balanceafter ??
      txn?.balance_after ??
      txn?.balanceAfter ??
      txn?.current_balance ??
      txn?.currentBalance ??
      txn?.balance ??
      null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getLatestBalanceFromTransactions(list) {
    if (!Array.isArray(list) || !list.length) return null;

    for (let i = 0; i < list.length; i++) {
      const bal = getTxnBalance(list[i]);
      if (bal !== null) return bal;
    }

    return null;
  }

  function renderTransactions(filter = "all") {
    if (!txnList) return;

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
      if (sumBalanceEl) sumBalanceEl.textContent = `₹${walletBalanceFromTemplate}`;
      return;
    }

    let sumAdded = 0;
    let sumBet = 0;
    let sumWin = 0;

    txns.forEach((t) => {
      const kind = String(t.kind || "").toLowerCase();
      const amt = Math.abs(Number(t.amount || 0));

      if (kind === "added") sumAdded += amt;
      else if (kind === "bet" || kind === "redeem") sumBet += amt;
      else if (kind === "win") sumWin += amt;
    });

    const filtered = txns.filter((t) => {
      const kind = String(t.kind || "").toLowerCase();

      if (filter === "all") return true;
      if (filter === "added") return kind === "added";
      if (filter === "bet") return kind === "bet" || kind === "redeem";
      if (filter === "win") return kind === "win";
      if (filter === "balance") return true;

      return kind === filter;
    });

    const rows = filtered.map((t) => {
      const kind = String(t.kind || "other").toLowerCase();

      let amountClass = "balance";
      if (kind === "added") amountClass = "added";
      else if (kind === "bet" || kind === "redeem") amountClass = "bet";
      else if (kind === "win") amountClass = "win";

      const isNegative = kind === "bet" || kind === "redeem";
      const sign = isNegative ? "-" : "+";
      const amt = Math.abs(Number(t.amount || 0));
      const formattedAmt = `${sign}₹${amt}`;

      const label = String(t.label || t.kind || "Transaction");
      const gameInfo = String(t.gametitle || t.game_title || t.note || "");

      const rowBalance = getTxnBalance(t);
      const rowBalanceText = rowBalance !== null ? `₹${rowBalance}` : "-";

      return `
        <div class="txn-row">
          <div class="txn-date">${formatDate(t.datetime)}</div>
          <div class="txn-type">${label}</div>
          <div class="txn-game">${gameInfo}</div>
          <div class="txn-amount ${amountClass}">${formattedAmt}</div>
          <div class="txn-after">${rowBalanceText}</div>
        </div>
      `;
    });

    txnList.innerHTML = rows.join("");

    if (sumAddedEl) sumAddedEl.textContent = `₹${sumAdded}`;
    if (sumBetEl) sumBetEl.textContent = `₹${sumBet}`;
    if (sumWinEl) sumWinEl.textContent = `₹${sumWin}`;

    const latestBalance = getLatestBalanceFromTransactions(txns);
    if (sumBalanceEl) {
      sumBalanceEl.textContent = `₹${latestBalance !== null ? latestBalance : walletBalanceFromTemplate}`;
    }
  }

  subTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const filter = tab.dataset.filter || "all";

      subTabs.forEach((st) => st.classList.remove("active"));
      tab.classList.add("active");

      renderTransactions(filter);
    });
  });

  renderTransactions("all");
});
