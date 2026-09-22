const body = document.getElementById('usersBody');
const message = document.getElementById('userMessage');
const dialog = document.getElementById('passwordDialog');
const createForm = document.getElementById('createUserForm');
const newUsernameInput = document.getElementById('newUsername');
const newPasswordInput = document.getElementById('newPassword');
const newRoleInput = document.getElementById('newRole');
const refreshButton = document.getElementById('refreshUsers');
const passwordDialogX = document.getElementById('passwordDialogX');
const savePasswordButton = document.getElementById('savePassword');
const resetPasswordInput = document.getElementById('resetPassword');
const passwordUserLabel = document.getElementById('passwordUserLabel');
let passwordTarget = '';

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname));
    throw new Error('Sesión vencida');
  }
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }
  return data;
}

async function loadUsers() {
  body.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
  try {
    const data = await api('/api/users');
    if (!data.users || !data.users.length) {
      body.innerHTML = '<tr><td colspan="4">Todavía no hay usuarios creados.</td></tr>';
      return;
    }
    body.innerHTML = data.users.map(u => `
      <tr>
        <td><strong>${esc(u.username)}</strong></td>
        <td>${u.role === 'admin' ? (u.builtin ? 'Administrador principal' : 'Administrador') : 'Usuario'}</td>
        <td>${u.builtin ? 'Cloudflare' : formatDate(u.createdAt)}</td>
        <td class="user-actions">
          ${u.builtin ? '<span class="user-system-note">Gestionado en Cloudflare</span>' : `
          <button class="btn secondary" data-reset="${encodeURIComponent(u.username)}">Contraseña</button>
          <button class="btn danger-soft" data-delete="${encodeURIComponent(u.username)}">Eliminar</button>`}
        </td>
      </tr>`).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4">${esc(e.message)}</td></tr>`;
  }
}

createForm.addEventListener('submit', async e => {
  e.preventDefault();
  message.textContent = 'Creando…';
  const submit = createForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const username = newUsernameInput.value.trim();
    const password = newPasswordInput.value;
    const role = newRoleInput.value;
    const created = await api('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    createForm.reset();
    message.textContent = `Usuario ${created.username} creado correctamente.`;
    await loadUsers();
    // KV puede tardar brevemente en propagar listados; una segunda lectura evita confusión.
    setTimeout(loadUsers, 1500);
  } catch (err) {
    message.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

refreshButton.addEventListener('click', loadUsers);

body.addEventListener('click', async e => {
  const del = e.target.closest('[data-delete]');
  const reset = e.target.closest('[data-reset]');
  if (del) {
    const username = decodeURIComponent(del.dataset.delete);
    if (!confirm(`¿Eliminar al usuario ${username}?`)) return;
    try {
      await api('/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }
  if (reset) {
    passwordTarget = decodeURIComponent(reset.dataset.reset);
    passwordUserLabel.textContent = passwordTarget;
    resetPasswordInput.value = '';
    dialog.showModal();
  }
});

passwordDialogX.addEventListener('click', () => dialog.close());
savePasswordButton.addEventListener('click', async () => {
  const password = resetPasswordInput.value;
  try {
    await api('/api/users/' + encodeURIComponent(passwordTarget) + '/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    dialog.close();
    alert('Contraseña actualizada.');
  } catch (err) {
    alert(err.message);
  }
});

function formatDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleString('es-PE');
}
function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

loadUsers();
