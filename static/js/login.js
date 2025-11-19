// Get form elements
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');
const errorMessage = document.getElementById('errorMessage');
const loginButton = loginForm.querySelector('.login-button');
const rememberMeCheckbox = document.getElementById('rememberMe');

// Toggle password visibility
togglePassword.addEventListener('click', () => {
  const type = passwordInput.type === 'password' ? 'text' : 'password';
  passwordInput.type = type;
  
  // Optional: Change eye icon
  togglePassword.classList.toggle('active');
});

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  
  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 4000);
}

// Handle form submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const rememberMe = rememberMeCheckbox.checked;
  
  // Validation
  if (!username || !password) {
    showError('Please fill in all fields');
    return;
  }
  
  // Disable button during login
  loginButton.disabled = true;
  loginButton.querySelector('.button-text').textContent = 'Logging in...';
  
  try {
    // Send login request to backend
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username,
        password: password,
        remember_me: rememberMe
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      // Store user data
      if (rememberMe) {
        localStorage.setItem('username', username);
      }
      localStorage.setItem('user_id', data.user_id);
      localStorage.setItem('token', data.token);
      
      // Redirect to game selection/dashboard
      window.location.href = data.redirect || '/';
    } else {
      showError(data.message || 'Invalid username or password');
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('Connection error. Please try again.');
  } finally {
    // Re-enable button
    loginButton.disabled = false;
    loginButton.querySelector('.button-text').textContent = 'Login';
  }
});

// Load saved username if "Remember Me" was checked
window.addEventListener('DOMContentLoaded', () => {
  const savedUsername = localStorage.getItem('username');
  if (savedUsername) {
    usernameInput.value = savedUsername;
    rememberMeCheckbox.checked = true;
  }
});

// Social login buttons (optional - implement as needed)
document.querySelectorAll('.social-button').forEach(button => {
  button.addEventListener('click', (e) => {
    const provider = e.currentTarget.classList.contains('google') ? 'google' : 'facebook';
    console.log(`Social login with ${provider} - implement OAuth flow here`);
    // Implement your OAuth flow here
  });
});
