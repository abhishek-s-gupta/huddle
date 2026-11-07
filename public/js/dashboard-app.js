import { api } from '/js/api.js';

let currentUser = null;

function getAvatarColor(name) {
  const colors = [
    '#2563EB', '#7C3AED', '#DB2777', '#EA580C',
    '#059669', '#0891B2', '#4F46E5', '#D97706'
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Theme Management
const themeBtn = document.getElementById('btn-theme-toggle');
const savedTheme = localStorage.getItem('huddle_theme') || 'light';
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  if (next === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('huddle_theme', next);
});

// Load User
async function loadUser() {
  try {
    const res = await api.getMe();
    if (!res.user) {
      window.location.href = '/';
      return;
    }
    currentUser = res.user;
    document.getElementById('user-display-name').textContent = currentUser.displayName;
    const initials = currentUser.displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const initialsEl = document.getElementById('user-initials');
    initialsEl.textContent = initials;
    initialsEl.style.backgroundColor = getAvatarColor(currentUser.displayName);
    document.getElementById('greeting-title').textContent = `Welcome back, ${currentUser.displayName.split(' ')[0]}`;

    if (currentUser.isAdmin) {
      document.getElementById('link-admin').style.display = 'inline-flex';
    }
  } catch (err) {
    window.location.href = '/';
  }
}

// Load History
async function loadHistory() {
  try {
    const res = await api.get('/api/rooms/history');
    const list = res.history || [];
    const tbody = document.getElementById('history-tbody');
    const empty = document.getElementById('history-empty');
    const countSpan = document.getElementById('history-count');

    countSpan.textContent = `${list.length} meeting${list.length === 1 ? '' : 's'}`;
    tbody.innerHTML = '';

    if (list.length === 0) {
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    list.forEach(item => {
      const tr = document.createElement('tr');
      const dateStr = new Date(item.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const statusBadge = !item.isEnded
        ? '<span class="badge badge-active">In Progress</span>'
        : '<span class="badge badge-ended">Ended</span>';

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 2px;">${escapeHtml(item.title)}</div>
          <div class="text-meta text-mono" style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.code)}</div>
        </td>
        <td>
          <div style="font-weight: 500;">
            ${escapeHtml(item.hostName)}
            ${item.isHost ? '<span class="badge badge-host" style="font-size: 10px; padding: 1px 6px; margin-left: 4px;">You</span>' : ''}
          </div>
        </td>
        <td class="text-meta">${dateStr}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${statusBadge}
            ${item.durationMinutes ? `<span class="text-meta" style="font-size: 12px;">${item.durationMinutes}m</span>` : ''}
          </div>
        </td>
        <td class="text-meta">${item.participantCount}</td>
        <td style="text-align: right;">
          <a href="/lobby/${encodeURIComponent(item.code)}" class="btn btn-secondary btn-sm">
            ${item.isEnded ? 'View' : 'Rejoin'}
          </a>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load meeting history:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Logout
document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    await api.logout();
    window.location.href = '/';
  } catch (err) {
    window.location.href = '/';
  }
});

// Create Modal
const modal = document.getElementById('modal-create-room');
const openModalBtn = document.getElementById('btn-open-create-modal');
const closeModalBtn = document.getElementById('btn-close-modal');
const cancelModalBtn = document.getElementById('btn-cancel-create');
const createForm = document.getElementById('form-create-room');
const createError = document.getElementById('create-error');
const createBtn = document.getElementById('btn-confirm-create');

function openModal() {
  modal.classList.add('active');
  createError.style.display = 'none';
  document.getElementById('create-title').focus();
}

function closeModal() {
  modal.classList.remove('active');
}

openModalBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createError.style.display = 'none';
  const title = document.getElementById('create-title').value.trim();
  const passcode = document.getElementById('create-passcode').value;

  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';

  try {
    const res = await api.post('/api/rooms', { title, passcode });
    if (passcode) {
      sessionStorage.setItem(`huddle_passcode_${res.room.code}`, passcode);
    }
    window.location.href = `/lobby/${res.room.code}`;
  } catch (err) {
    createError.textContent = err.message || 'Failed to create room.';
    createError.style.display = 'block';
    createBtn.disabled = false;
    createBtn.textContent = 'Create & Join';
  }
});

// Join Form
document.getElementById('form-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const rawInput = document.getElementById('input-join-code').value.trim();
  if (!rawInput) return;

  // Extract code and optional E2EE key hash if user pasted a full URL
  let hash = '';
  if (rawInput.includes('#')) {
    hash = '#' + rawInput.split('#')[1];
  }

  let code = rawInput;
  if (rawInput.includes('/room/')) {
    code = rawInput.split('/room/').pop().split('?')[0].split('#')[0];
  } else if (rawInput.includes('/lobby/')) {
    code = rawInput.split('/lobby/').pop().split('?')[0].split('#')[0];
  }
  code = code.trim();

  window.location.href = `/lobby/${encodeURIComponent(code)}${hash}`;
});

loadUser();
loadHistory();
