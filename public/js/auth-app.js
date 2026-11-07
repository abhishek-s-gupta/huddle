import { api } from '/js/api.js';

let isSignUp = false;

const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const groupName = document.getElementById('group-name');
const inputName = document.getElementById('input-name');
const inputEmail = document.getElementById('input-email');
const inputPassword = document.getElementById('input-password');
const btnSubmit = document.getElementById('btn-submit');
const btnText = document.getElementById('btn-text');
const form = document.getElementById('auth-form');

const errorName = document.getElementById('error-name');
const errorEmail = document.getElementById('error-email');
const errorPassword = document.getElementById('error-password');
const errorGeneral = document.getElementById('error-general');
const formGeneralError = document.getElementById('form-general-error');

function clearErrors() {
  [errorName, errorEmail, errorPassword, errorGeneral].forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
  [inputName, inputEmail, inputPassword].forEach(el => el.classList.remove('input-error'));
  formGeneralError.style.display = 'none';
}

export function switchMode(signup) {
  isSignUp = signup;
  clearErrors();
  if (signup) {
    tabLogin.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'false');
    tabSignup.classList.add('active');
    tabSignup.setAttribute('aria-selected', 'true');
    authTitle.textContent = 'Create an account';
    authSubtitle.textContent = 'Start hosting and joining real-time meetings.';
    groupName.style.display = 'flex';
    btnText.textContent = 'Create Account';
  } else {
    tabSignup.classList.remove('active');
    tabSignup.setAttribute('aria-selected', 'false');
    tabLogin.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'true');
    authTitle.textContent = 'Sign in to Huddle';
    authSubtitle.textContent = 'Enter your credentials to continue to your dashboard.';
    groupName.style.display = 'none';
    btnText.textContent = 'Sign In';
  }
}

tabLogin.addEventListener('click', () => switchMode(false));
tabSignup.addEventListener('click', () => switchMode(true));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const email = inputEmail.value.trim();
  const password = inputPassword.value;
  const displayName = inputName.value.trim();

  let hasError = false;

  if (!email || !email.includes('@')) {
    errorEmail.textContent = 'Please enter a valid email address.';
    errorEmail.style.display = 'block';
    inputEmail.classList.add('input-error');
    hasError = true;
  }

  if (!password || password.length < 8) {
    errorPassword.textContent = 'Password must be at least 8 characters.';
    errorPassword.style.display = 'block';
    inputPassword.classList.add('input-error');
    hasError = true;
  }

  if (isSignUp && (!displayName || displayName.length < 2)) {
    errorName.textContent = 'Display name must be at least 2 characters.';
    errorName.style.display = 'block';
    inputName.classList.add('input-error');
    hasError = true;
  }

  if (hasError) return;

  btnSubmit.disabled = true;
  btnText.textContent = isSignUp ? 'Creating account...' : 'Signing in...';

  try {
    if (isSignUp) {
      await api.signup(email, password, displayName);
    } else {
      await api.login(email, password);
    }

    // Check for redirect query param
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect') || '/dashboard';
    window.location.href = redirect;
  } catch (err) {
    btnSubmit.disabled = false;
    btnText.textContent = isSignUp ? 'Create Account' : 'Sign In';
    errorGeneral.textContent = err.message || 'An unexpected error occurred.';
    formGeneralError.style.display = 'block';
  }
});

// Check if user is already authenticated
api.getMe().then(res => {
  if (res && res.user) {
    window.location.href = '/dashboard';
  }
}).catch(() => {});

window.switchMode = switchMode;
window.__authReady = true;
