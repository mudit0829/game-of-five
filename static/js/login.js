// Elements
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');
const errorMessage = document.getElementById('errorMessage');
const rememberMeCheckbox = document.getElementById('rememberMe');

const loginButton = loginForm.querySelector('.login-button');
const buttonTextEl = loginButton.querySelector('.button-text');

// Toggle password visibility
togglePassword.addEventListener('click', () => {
  const newType = passwordInput.type === 'password' ? 'text' : 'password';
  passwordInput.type = newType;
  togglePassword.classList.toggle('active');
});

// Show error helper
function showError(msg) {
  if (!errorMessage) return;
  errorMessage.textContent = msg || 'Something went wrong';
  errorMessage.classList.add('show');
  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 4000);
}

// Handle submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const rememberMe = rememberMeCheckbox.checked;

  if (!username || !password) {
    showError('Please fill in both fields.');
    return;
  }

  loginButton.disabled = true;
  buttonTextEl.textContent = 'Logging in...';

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        remember_me: rememberMe,
      }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // save basic info
      if (rememberMe) {
        localStorage.setItem('username', username);
      } else {
        localStorage.removeItem('username');
      }

      localStorage.setItem('user_id', data.user_id);
      if (data.token) {
        localStorage.setItem('token', data.token);
      }

      window.location.href = data.redirect || '/home';
    } else {
      showError(data.message || 'Invalid username or password');
    }
  } catch (err) {
    console.error('Login error', err);
    showError('Connection error. Please try again.');
  } finally {
    loginButton.disabled = false;
    buttonTextEl.textContent = 'Login';
  }
});

// Prefill remembered username
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('username');
  if (saved) {
    usernameInput.value = saved;
    rememberMeCheckbox.checked = true;
  }
});
