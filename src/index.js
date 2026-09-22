const SESSION_COOKIE = 'tf_session';
const SESSION_SECONDS = 2 * 60 * 60;
const USER_PREFIX = 'auth:user:';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Salud del servicio (sin exponer secretos).
    if (path === '/api/health') {
      return json({
        ok: true,
        storage: Boolean(env.DATA),
        authConfigured: Boolean(env.AUTH_SECRET && env.ADMIN_USER && env.ADMIN_PASSWORD),
        app: 'TruckFlow 2.0 - ARGENTINA'
      });
    }

    // Autenticación.
    if (path === '/api/auth/login' && request.method === 'POST') {
      return login(request, env);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      return logout();
    }
    if (path === '/api/auth/me' && request.method === 'GET') {
      const session = await requireSession(request, env);
      if (session.response) return session.response;
      return json({ user: session.user, role: session.role, expiresAt: session.exp * 1000 });
    }

    // Sincronización / lectura de datos.
    if (path === '/api/data') {
      if (request.method === 'POST') {
        if (!env.DATA) {
          return json({ error: 'El almacenamiento DATA todavía no está configurado en Cloudflare.' }, 503);
        }

        const auth = request.headers.get('authorization') || '';
        if (!env.SYNC_TOKEN || auth !== `Bearer ${env.SYNC_TOKEN}`) {
          return json({ error: 'No autorizado' }, 401);
        }

        let obj;
        try {
          obj = await request.json();
          if (!obj || !Array.isArray(obj.rows)) throw new Error('rows requerido');
        } catch {
          return json({ error: 'JSON inválido' }, 400);
        }

        await env.DATA.put('latest', JSON.stringify(obj));
        return json({ ok: true, count: obj.rows.length ?? 0 });
      }

      if (request.method === 'GET') {
        const session = await requireSession(request, env);
        if (session.response) return session.response;

        if (env.DATA) {
          const stored = await env.DATA.get('latest');
          if (stored) {
            return new Response(stored, {
              headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store'
              }
            });
          }
        }

        const demoUrl = new URL('/data/latest.json', request.url);
        return env.ASSETS.fetch(new Request(demoUrl, request));
      }

      return json({ error: 'Método no permitido' }, 405);
    }

    // Gestión de usuarios: solo administradores.
    if (path === '/api/users' && request.method === 'GET') {
      const admin = await requireAdmin(request, env);
      if (admin.response) return admin.response;
      return listUsers(env);
    }
    if (path === '/api/users' && request.method === 'POST') {
      const admin = await requireAdmin(request, env);
      if (admin.response) return admin.response;
      return createUser(request, env);
    }

    const passwordMatch = path.match(/^\/api\/users\/([^/]+)\/password$/);
    if (passwordMatch && request.method === 'PUT') {
      const admin = await requireAdmin(request, env);
      if (admin.response) return admin.response;
      return changePassword(request, env, decodeURIComponent(passwordMatch[1]));
    }

    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && request.method === 'DELETE') {
      const admin = await requireAdmin(request, env);
      if (admin.response) return admin.response;
      return deleteUser(env, decodeURIComponent(userMatch[1]), admin.user);
    }

    // No permitir acceso directo al JSON demo/operativo sin sesión.
    if (path.startsWith('/data/')) {
      const session = await requireSession(request, env);
      if (session.response) return session.response;
      return env.ASSETS.fetch(request);
    }

    // /login solo redirige una vez al archivo estático real.
    // /login.html NO pasa por el Worker: Cloudflare lo sirve directamente como asset.
    if (path === '/login') {
      const target = new URL('/login.html', request.url);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }

    // Páginas HTML protegidas.
    if (isProtectedPage(path)) {
      const session = await requireSession(request, env);
      if (session.response) return redirectToLogin(request);

      if ((path === '/users.html' || path === '/users' || path === '/admin.html' || path === '/admin') && session.role !== 'admin') {
        return new Response('Acceso restringido a administradores.', { status: 403 });
      }

      const assetPath = normalizePagePath(path);
      const assetUrl = new URL(assetPath, request.url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    // JS/CSS/imágenes y demás assets públicos. Los datos siguen protegidos arriba.
    return env.ASSETS.fetch(request);
  }
};

async function login(request, env) {
  if (!env.AUTH_SECRET || !env.ADMIN_USER || !env.ADMIN_PASSWORD) {
    return json({ error: 'Autenticación no configurada en Cloudflare.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400);
  }

  const username = normalizeUsername(body?.username);
  const password = String(body?.password || '');
  if (!username || !password) return json({ error: 'Ingresa usuario y contraseña.' }, 400);

  let role = null;
  const adminUser = normalizeUsername(env.ADMIN_USER);

  if (username === adminUser && await secureEqualText(password, String(env.ADMIN_PASSWORD))) {
    role = 'admin';
  } else {
    if (!env.DATA) return json({ error: 'Almacenamiento de usuarios no disponible.' }, 503);
    const record = await env.DATA.get(USER_PREFIX + username, 'json');
    if (!record || record.disabled) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
    const valid = await verifyStoredPassword(password, username, record, env.AUTH_SECRET);
    if (!valid) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
    role = record.role === 'admin' ? 'admin' : 'user';
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = { user: username, role, iat: now, exp: now + SESSION_SECONDS };
  const token = await signSession(payload, env.AUTH_SECRET);

  return json({ ok: true, user: username, role, expiresAt: payload.exp * 1000 }, 200, {
    'set-cookie': cookieHeader(SESSION_COOKIE, token, SESSION_SECONDS)
  });
}

function logout() {
  return json({ ok: true }, 200, {
    'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  });
}

async function listUsers(env) {
  if (!env.DATA) return json({ error: 'Almacenamiento DATA no configurado.' }, 503);

  const users = [];
  const adminName = normalizeUsername(env.ADMIN_USER);
  if (adminName) {
    users.push({ username: adminName, role: 'admin', createdAt: null, builtin: true });
  }

  let cursor;
  do {
    const listed = await env.DATA.list({ prefix: USER_PREFIX, cursor });
    for (const key of listed.keys) {
      const record = await env.DATA.get(key.name, 'json');
      if (!record) continue;
      const username = key.name.slice(USER_PREFIX.length);
      if (username === adminName) continue;
      users.push({
        username,
        role: record.role === 'admin' ? 'admin' : 'user',
        createdAt: record.createdAt || null,
        builtin: false
      });
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);

  users.sort((a, b) => a.username.localeCompare(b.username, 'es'));
  return json({ users });
}

async function createUser(request, env) {
  if (!env.DATA) return json({ error: 'Almacenamiento DATA no configurado.' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Solicitud inválida.' }, 400); }

  const username = normalizeUsername(body?.username);
  const password = String(body?.password || '');
  const role = body?.role === 'admin' ? 'admin' : 'user';

  if (!isValidUsername(username)) {
    return json({ error: 'Usuario inválido. Usa 3-80 caracteres: letras, números, punto, @, guion o guion bajo.' }, 400);
  }
  if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
  if (username === normalizeUsername(env.ADMIN_USER)) return json({ error: 'Ese usuario corresponde al administrador principal.' }, 409);

  const key = USER_PREFIX + username;
  if (await env.DATA.get(key)) return json({ error: 'El usuario ya existe.' }, 409);

  const passwordData = await hashPasswordForStorage(password, username, env.AUTH_SECRET);
  const record = {
    role,
    algorithm: passwordData.algorithm,
    salt: passwordData.salt,
    hash: passwordData.hash,
    createdAt: new Date().toISOString(),
    disabled: false
  };
  await env.DATA.put(key, JSON.stringify(record));
  return json({ ok: true, username, role }, 201);
}

async function changePassword(request, env, rawUsername) {
  if (!env.DATA) return json({ error: 'Almacenamiento DATA no configurado.' }, 503);
  const username = normalizeUsername(rawUsername);
  if (username === normalizeUsername(env.ADMIN_USER)) {
    return json({ error: 'La contraseña del administrador principal se cambia en Cloudflare > Variables and Secrets > ADMIN_PASSWORD.' }, 400);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Solicitud inválida.' }, 400); }
  const password = String(body?.password || '');
  if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);

  const key = USER_PREFIX + username;
  const record = await env.DATA.get(key, 'json');
  if (!record) return json({ error: 'Usuario no encontrado.' }, 404);

  const passwordData = await hashPasswordForStorage(password, username, env.AUTH_SECRET);
  record.algorithm = passwordData.algorithm;
  record.salt = passwordData.salt;
  record.hash = passwordData.hash;
  delete record.iterations;
  record.updatedAt = new Date().toISOString();
  await env.DATA.put(key, JSON.stringify(record));
  return json({ ok: true });
}

async function deleteUser(env, rawUsername, currentUser) {
  if (!env.DATA) return json({ error: 'Almacenamiento DATA no configurado.' }, 503);
  const username = normalizeUsername(rawUsername);
  if (username === normalizeUsername(env.ADMIN_USER)) return json({ error: 'No se puede eliminar el administrador principal.' }, 400);
  if (username === normalizeUsername(currentUser)) return json({ error: 'No puedes eliminar tu propia cuenta mientras tienes sesión iniciada.' }, 400);

  const key = USER_PREFIX + username;
  if (!(await env.DATA.get(key))) return json({ error: 'Usuario no encontrado.' }, 404);
  await env.DATA.delete(key);
  return json({ ok: true });
}

async function requireAdmin(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session;
  if (session.role !== 'admin') return { response: json({ error: 'Solo administradores.' }, 403) };
  return session;
}

async function requireSession(request, env) {
  const session = await readSession(request, env);
  if (!session) return { response: json({ error: 'Sesión no válida o vencida.' }, 401) };
  return session;
}

async function readSession(request, env) {
  if (!env.AUTH_SECRET) return null;
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = await hmac(body, env.AUTH_SECRET);
  if (!secureEqual(signature, expected)) return null;

  let payload;
  try { payload = JSON.parse(decodeBase64Url(body)); }
  catch { return null; }

  const now = Math.floor(Date.now() / 1000);
  if (!payload?.user || !payload?.role || !payload?.exp || payload.exp <= now) return null;
  return payload;
}

async function signSession(payload, secret) {
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = await hmac(body, secret);
  return `${body}.${signature}`;
}

async function hmac(value, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function hashPasswordForStorage(password, username, secret) {
  if (!secret) throw new Error('AUTH_SECRET no configurado.');
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await keyedPasswordDigest(password, username, salt, secret);
  return { algorithm: 'hmac-sha256-v1', salt, hash };
}

async function keyedPasswordDigest(password, username, salt, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const data = enc.encode(`${normalizeUsername(username)}\n${salt}\n${String(password)}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyStoredPassword(password, username, record, secret) {
  try {
    if (record?.algorithm === 'hmac-sha256-v1') {
      const actual = await keyedPasswordDigest(password, username, record.salt, secret);
      return secureEqual(actual, record.hash);
    }
    // Compatibilidad con usuarios creados por la versión PBKDF2 anterior.
    return verifyPassword(password, record.salt, record.hash, record.iterations || 120000);
  } catch {
    return false;
  }
}

async function hashPassword(password, saltBytes = null, iterations = 120000) {
  const enc = new TextEncoder();
  const salt = saltBytes ? base64UrlToBytes(saltBytes) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, 256);
  return {
    salt: bytesToBase64Url(salt),
    hash: bytesToBase64Url(new Uint8Array(bits)),
    iterations
  };
}

async function verifyPassword(password, salt, expectedHash, iterations) {
  try {
    const derived = await hashPassword(password, salt, iterations);
    return secureEqual(derived.hash, expectedHash);
  } catch {
    return false;
  }
}

async function secureEqualText(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function secureEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidUsername(value) {
  return /^[a-z0-9._@-]{3,80}$/.test(value);
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirectToLogin(request) {
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  const login = new URL('/login.html', request.url);
  login.searchParams.set('next', next);
  return Response.redirect(login.toString(), 302);
}

function isProtectedPage(path) {
  return path === '/' || path === '/index.html' ||
    path === '/live.html' || path === '/live' ||
    path === '/live_previous.html' || path === '/live_previous' ||
    path === '/users.html' || path === '/users' ||
    path === '/admin.html' || path === '/admin';
}

function normalizePagePath(path) {
  if (path === '/') return '/index.html';
  if (path === '/live') return '/live.html';
  if (path === '/live_previous') return '/live_previous.html';
  if (path === '/users') return '/users.html';
  if (path === '/admin') return '/admin.html';
  return path;
}

function encodeBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function decodeBase64Url(value) {
  const bytes = base64UrlToBytes(value);
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  let base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}
