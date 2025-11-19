// === Get user ID from storage for balance requests ===
const USER_ID = localStorage.getItem('user_id') || 'guest';
let walletBalance = 0;

// --- Update wallet balance ---
function updateBalance() {
  fetch(`/balance/${USER_ID}`)
    .then(res => res.json())
    .then(data => {
      walletBalance = data.balance || 0;
      document.getElementById('walletBalance').textContent = walletBalance.toLocaleString('en-IN');
    });
}

// Update on load and every 10 seconds
updateBalance();
setInterval(updateBalance, 10000);

// --- Ripple effect for card clicks (for pro touch) ---
document.querySelectorAll('.game-card, .featured-card').forEach(card => {
  card.addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${e.offsetX}px`;
    ripple.style.top = `${e.offsetY}px`;
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

// Optional: Smooth scroll for main-content
document.querySelector('.main-content').scrollTo({ top: 0, behavior: 'smooth' });

/* --- Optional: Add .ripple CSS to your home.css ---
.ripple {
  position: absolute;
  width: 90px;
  height: 90px;
  background: rgba(56,189,248,0.18);
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0.5);
  pointer-events: none;
  animation: ripple-grow 0.6s linear;
  z-index: 9;
}
@keyframes ripple-grow {
  to {
    transform: translate(-50%, -50%) scale(2.2);
    opacity: 0;
  }
}
*/
