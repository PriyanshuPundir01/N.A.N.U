function switchView(viewName) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + viewName).classList.add('active');
  
  // Clear all errors and inputs on switch
  document.querySelectorAll('.error-msg, .success-msg').forEach(el => el.textContent = '');
  document.querySelectorAll('form').forEach(f => f.reset());
  
  if (viewName === 'forgot') {
    document.getElementById('forgotForm').style.display = 'flex';
    document.getElementById('verifyForm').style.display = 'none';
  }
}

async function apiCall(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  err.textContent = '';
  btn.textContent = 'Logging in...';
  
  try {
    const data = await apiCall('/api/auth/login', {
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value
    });
    localStorage.setItem('nanu_token', data.token);
    window.location.href = '/';
  } catch (error) {
    err.textContent = error.message;
    btn.textContent = 'Log In';
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('reg-btn');
  const err = document.getElementById('reg-error');
  err.textContent = '';
  btn.textContent = 'Signing up...';
  
  try {
    const data = await apiCall('/api/auth/register', {
      email: document.getElementById('reg-email').value,
      password: document.getElementById('reg-password').value
    });
    localStorage.setItem('nanu_token', data.token);
    window.location.href = '/';
  } catch (error) {
    err.textContent = error.message;
    btn.textContent = 'Sign Up';
  }
});

let resetEmail = '';

document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('forgot-btn');
  const err = document.getElementById('forgot-error');
  const succ = document.getElementById('forgot-success');
  err.textContent = '';
  succ.textContent = '';
  btn.textContent = 'Sending...';
  
  try {
    resetEmail = document.getElementById('forgot-email').value;
    await apiCall('/api/auth/forgot-password', { email: resetEmail });
    succ.textContent = 'OTP sent! (Check server console)';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('verifyForm').style.display = 'flex';
  } catch (error) {
    err.textContent = error.message;
  } finally {
    btn.textContent = 'Send OTP';
  }
});

document.getElementById('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('verify-btn');
  const err = document.getElementById('forgot-error');
  err.textContent = '';
  btn.textContent = 'Verifying...';
  
  try {
    const data = await apiCall('/api/auth/reset-password', {
      email: resetEmail,
      otp: document.getElementById('verify-otp').value,
      newPassword: document.getElementById('verify-new-password').value
    });
    localStorage.setItem('nanu_token', data.token);
    window.location.href = '/';
  } catch (error) {
    err.textContent = error.message;
    btn.textContent = 'Reset & Log In';
  }
});
