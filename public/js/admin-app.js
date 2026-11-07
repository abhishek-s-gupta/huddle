import { api } from '/js/api.js';

// Theme support
const savedTheme = localStorage.getItem('huddle_theme') || 'light';
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

document.getElementById('btn-theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('huddle_theme', next);
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api.logout();
  window.location.href = '/';
});

let targetEndCode = null;
const modalEnd = document.getElementById('modal-confirm-end');
const btnCancelEnd = document.getElementById('btn-cancel-end');
const btnCloseEndModal = document.getElementById('btn-close-end-modal');
const btnConfirmEnd = document.getElementById('btn-confirm-end');

function openEndModal(code) {
  targetEndCode = code;
  document.getElementById('end-room-prompt').textContent = `Are you sure you want to terminate meeting "${code}"? All active participants will be ejected.`;
  modalEnd.classList.add('active');
}

function closeEndModal() {
  modalEnd.classList.remove('active');
  targetEndCode = null;
}

btnCancelEnd.addEventListener('click', closeEndModal);
btnCloseEndModal.addEventListener('click', closeEndModal);
modalEnd.addEventListener('click', (e) => {
  if (e.target === modalEnd) closeEndModal();
});

btnConfirmEnd.addEventListener('click', async () => {
  if (!targetEndCode) return;
  btnConfirmEnd.disabled = true;
  btnConfirmEnd.textContent = 'Terminating...';

  try {
    await api.post(`/api/admin/rooms/${encodeURIComponent(targetEndCode)}/end`, {});
    closeEndModal();
    await loadOverview();
  } catch (err) {
    alert(err.message || 'Failed to end room.');
  } finally {
    btnConfirmEnd.disabled = false;
    btnConfirmEnd.textContent = 'End Meeting';
  }
});

async function loadOverview() {
  try {
    const data = await api.get('/api/admin/overview');
    
    // Stats
    document.getElementById('stat-users').textContent = data.stats.totalUsers;
    document.getElementById('stat-active-rooms').textContent = data.stats.activeRoomsCount;
    document.getElementById('stat-total-rooms').textContent = data.stats.totalRoomsCount;
    document.getElementById('stat-audit').textContent = data.stats.totalAuditLogs;

    // Active Rooms
    const tbodyRooms = document.getElementById('tbody-active-rooms');
    const emptyRooms = document.getElementById('empty-active-rooms');
    const roomsCount = document.getElementById('active-rooms-count');
    tbodyRooms.innerHTML = '';
    roomsCount.textContent = `${data.activeRooms.length} active`;

    if (data.activeRooms.length === 0) {
      emptyRooms.style.display = 'block';
    } else {
      emptyRooms.style.display = 'none';
      data.activeRooms.forEach(room => {
        const tr = document.createElement('tr');
        const timeStr = new Date(room.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tr.innerHTML = `
          <td>
            <div style="font-weight: 500;">${escapeHtml(room.title)}</div>
            <div class="text-meta" style="font-family: monospace;">${escapeHtml(room.code)}</div>
          </td>
          <td>
            <div>${escapeHtml(room.host_name)}</div>
            <div class="text-meta">${escapeHtml(room.host_email)}</div>
          </td>
          <td class="text-meta">${timeStr}</td>
          <td class="text-meta">${room.activeParticipants} participant${room.activeParticipants === 1 ? '' : 's'}</td>
          <td>
            <span class="badge-status ${room.isLocked ? 'badge-ended' : 'badge-active'}">
              ${room.isLocked ? 'Locked' : 'Open'}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-danger btn-end-room" data-code="${escapeHtml(room.code)}" style="padding: 4px 10px; font-size: var(--font-size-meta);">
              End
            </button>
          </td>
        `;
        tbodyRooms.appendChild(tr);
      });

      // Attach end room listeners
      document.querySelectorAll('.btn-end-room').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const code = e.currentTarget.getAttribute('data-code');
          openEndModal(code);
        });
      });
    }

    // Users
    const tbodyUsers = document.getElementById('tbody-users');
    const usersCount = document.getElementById('users-count');
    tbodyUsers.innerHTML = '';
    usersCount.textContent = `${data.users.length} users`;

    data.users.forEach(u => {
      const tr = document.createElement('tr');
      const dateStr = new Date(u.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      tr.innerHTML = `
        <td class="text-meta" style="font-family: monospace;">#${u.id}</td>
        <td style="font-weight: 500;">${escapeHtml(u.display_name)}</td>
        <td class="text-meta">${escapeHtml(u.email)}</td>
        <td>
          <span class="badge-status ${u.isAdmin ? 'badge-active' : 'badge-ended'}">
            ${u.isAdmin ? 'Admin' : 'Member'}
          </span>
        </td>
        <td class="text-meta">${dateStr}</td>
      `;
      tbodyUsers.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load admin overview:', err);
    if (err.status === 403) {
      window.location.href = '/dashboard';
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.getElementById('btn-refresh').addEventListener('click', loadOverview);

loadOverview();
