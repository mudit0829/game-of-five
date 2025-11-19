// Get user data from localStorage or session
const USER_ID = localStorage.getItem('user_id') || 'guest';
let walletBalance = 0;

// Update wallet balance
function updateBalance() {
  fetch(`/balance/${USER_ID}`)
    .then(res => res.json())
    .then(data => {
      walletBalance = data.balance || 0;
      document.getElementById('walletBalance').textContent = walletBalance.toFixed(0);
    })
    .catch(err => console.error('Balance fetch error:', err));
}

// Initialize
updateBalance();

// Update balance every 5 seconds
setInterval(updateBalance, 5000);

// Add ripple effect to cards
document.querySelectorAll('.game-card, .featured-card').forEach(card => {
  card.addEventListener('click', function(e) {
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = e.offsetX + 'px';
    ripple.style.top = e.offsetY + 'px';
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});
