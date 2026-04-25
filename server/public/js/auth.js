/**
 * Auth Controller - Login page logic
 */

(function () {
  'use strict';

  // If already authenticated, go to dashboard
  if (api.isAuthenticated()) {
    window.location.href = '/dashboard.html';
    return;
  }

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorEl = document.getElementById('login-error');
  const btnText = document.querySelector('.btn-text');
  const btnLoader = document.querySelector('.btn-loader');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Please enter email and password');
      return;
    }

    // Show loading
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline';

    try {
      await api.login(email, password);
      window.location.href = '/dashboard.html';
    } catch (err) {
      showError(err.message || 'Login failed. Check your credentials.');
      btnText.style.display = 'inline';
      btnLoader.style.display = 'none';
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
})();
