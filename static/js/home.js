// === Get user ID from storage for balance requests ===
const USER_ID = localStorage.getItem('user_id') || 'guest';
let walletBalance = 0;

// --- Update wallet balance ---
function updateBalance() {
  fetch(`/balance/${USER_ID}`)
    .then(res => res.json())
    .then(data => {
      const pill = document.getElementById('coinsPill');
      walletBalance = data.balance || 0;

      const display = document.getElementById('walletBalance');
      if (display) {
        display.textContent = walletBalance.toLocaleString('en-IN');
      }

      // small bounce animation when value updates
      if (pill) {
        pill.classList.add('bounce');
        setTimeout(() => pill.classList.remove('bounce'), 450);
      }
    })
    .catch(err => {
      console.error('Balance fetch error', err);
    });
}

// Update on load and every 10 seconds
updateBalance();
setInterval(updateBalance, 10000);

// --- Coins pill click → Redeem page ---
const coinsPill = document.getElementById('coinsPill');
if (coinsPill) {
  coinsPill.addEventListener('click', () => {
    window.location.href = '/coins';
  });
}

// --- Ripple effect for card clicks (for pro touch) ---
document.querySelectorAll('.game-card, .featured-card').forEach(card => {
  card.addEventListener('click', function (e) {
    const rect = this.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${e.clientX - rect.left}px`;
    ripple.style.top = `${e.clientY - rect.top}px`;
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});

// --- Bottom navigation active state ---
const navItems = document.querySelectorAll('.bottom-nav .nav-item');
const routes = ['/home', '/history', '/profile', '/help'];
const currentPath = window.location.pathname;

navItems.forEach((item, idx) => {
  if (currentPath.startsWith(routes[idx])) {
    navItems.forEach(x => x.classList.remove('active'));
    item.classList.add('active');
  }
});

// Optional: Smooth scroll for main-content on load
const mainContent = document.querySelector('.main-content');
if (mainContent) {
  mainContent.scrollTo({ top: 0, behavior: 'smooth' });
}
