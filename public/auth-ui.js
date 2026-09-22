(async function () {
  async function getMe() {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (response.status === 401) {
      const next = location.pathname + location.search;
      location.replace('/login.html?next=' + encodeURIComponent(next));
      return null;
    }
    if (!response.ok) return null;
    return response.json();
  }

  const me = await getMe();
  if (!me) return;

  const dock = document.createElement('div');
  dock.className = 'session-dock';
  dock.innerHTML = `
    <span class="session-user">${escapeHtml(me.user)}</span>
    ${me.role === 'admin' ? '<a href="/users.html" class="session-link">Usuarios</a>' : ''}
    <button type="button" class="session-logout" title="Cerrar sesión">Cerrar sesión</button>
  `;
  document.body.appendChild(dock);

  dock.querySelector('.session-logout').addEventListener('click', async () => {
    const button = dock.querySelector('.session-logout');
    button.disabled = true;
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    location.replace('/login.html');
  });

  // Revisa cada minuto. A las 2 horas obliga un nuevo inicio de sesión.
  setInterval(getMe, 60_000);

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }
})();
