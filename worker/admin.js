// Password gate for the back office. Everything sits behind a signed,
// HttpOnly session cookie; without it the app never reaches the browser.
const COOKIE = 'kf_admin';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafe(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function issueToken(env) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return exp + '.' + (await hmac(env.ADMIN_SESSION_SECRET, String(exp)));
}

async function tokenValid(env, raw) {
  if (!raw) return false;
  const parts = String(raw).split('.');
  if (parts.length !== 2) return false;
  const [exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return timingSafe(sig, await hmac(env.ADMIN_SESSION_SECRET, exp));
}

function cookieFrom(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const hits = (attempts.get(ip) || []).filter((t) => now - t < 5 * 60 * 1000);
  if (hits.length >= 8) return true;
  hits.push(now);
  attempts.set(ip, hits);
  if (attempts.size > 2000) attempts.clear();
  return false;
}

function page(error) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Kauā Back Office</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#0b0b0c; color:#f5f5f7;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,sans-serif; }
  form { width:min(360px,90vw); background:#161617; padding:28px; border-radius:20px;
    border:1px solid rgba(255,255,255,.08); box-shadow:0 24px 60px rgba(0,0,0,.5); }
  h1 { font-size:17px; margin:0 0 4px; letter-spacing:-.02em; }
  p { font-size:13px; color:#8e8e93; margin:0 0 18px; }
  input { width:100%; padding:13px 14px; font-size:16px; border-radius:12px;
    border:1px solid rgba(255,255,255,.12); background:#0b0b0c; color:#fff; box-sizing:border-box; }
  input:focus { outline:none; border-color:#a9603e; box-shadow:0 0 0 3px rgba(169,96,62,.25); }
  button { width:100%; margin-top:12px; padding:13px; font-size:15px; font-weight:600;
    border:0; border-radius:12px; background:#a9603e; color:#fff; cursor:pointer; }
  button:active { transform:scale(.985); }
  .err { color:#ff453a; font-size:13px; margin:12px 0 0; }
</style></head><body>
<form method="POST" action="/__login">
  <h1>Kauā Back Office</h1>
  <p>Private. Enter the access password to continue.</p>
  <input type="password" name="password" autocomplete="current-password" autofocus required />
  <button type="submit">Unlock</button>
  ${error ? '<p class="err">Wrong password. Try again.</p>' : ''}
</form></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__logout') {
      return new Response(null, {
        status: 302,
        headers: { Location: '/', 'Set-Cookie': COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' },
      });
    }

    if (url.pathname === '/__login' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (tooMany(ip)) return new Response(page('slow'), { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      let password = '';
      try {
        const form = await request.formData();
        password = String(form.get('password') || '');
      } catch { /* ignore */ }
      // Trim both sides: piping a secret through PowerShell/wrangler can add a
      // trailing newline, which must not lock the owner out.
      const expected = String(env.ADMIN_PASS || '').trim();
      if (!expected || !timingSafe(String(password).trim(), expected)) {
        return new Response(page('bad'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      const token = await issueToken(env);
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': COOKIE + '=' + token + '; Path=/; Max-Age=' + SESSION_DAYS * 24 * 3600 + '; HttpOnly; Secure; SameSite=Lax',
        },
      });
    }

    if (await tokenValid(env, cookieFrom(request))) {
      return env.ASSETS.fetch(request);
    }

    return new Response(page(null), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  },
};
