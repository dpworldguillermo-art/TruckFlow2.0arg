const form = document.getElementById('loginForm');
const message = document.getElementById('loginMessage');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Validando…';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');

    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    location.replace(next && next.startsWith('/') ? next : '/');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
