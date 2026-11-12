// Password gate for the back office. Everything sits behind a signed,
// HttpOnly session cookie; without it the app never reaches the browser.
//
// Required Worker secrets (wrangler secret put ...):
//   ADMIN_PASS            the access password
//   ADMIN_SESSION_SECRET  long random string (>= 32 chars) used to sign sessions
// If either is missing the gate fails closed (nobody gets in).
const COOKIE = '__Host-kf_admin';
const LEGACY_COOKIE = 'kf_admin'; // pre-v2 name, cleared on logout
const TOKEN_VERSION = 'v2';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

// Applied to every response (gate page and app assets).
// script-src: the only inline script is Angular's critical-CSS loader
// (onload="this.media='all'"), allowed by hash. apis.google.com / firebaseapp.com
// are what Firebase Auth may load. 'wasm-unsafe-eval' is for the zxing scanner.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc=' https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https: wss: data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: https://*.firebaseapp.com https://apis.google.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function secured(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

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

function configured(env) {
  return !!String(env.ADMIN_PASS || '').trim() && !!String(env.ADMIN_SESSION_SECRET || '');
}

// The signature also covers the current password, so changing ADMIN_PASS
// (or ADMIN_SESSION_SECRET) revokes every existing session.
async function signPayload(env, exp) {
  const expected = String(env.ADMIN_PASS || '').trim();
  const passTag = await hmac(env.ADMIN_SESSION_SECRET, 'pass|' + expected);
  return hmac(env.ADMIN_SESSION_SECRET, TOKEN_VERSION + '|' + exp + '|' + passTag);
}

async function issueToken(env) {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return exp + '.' + (await signPayload(env, exp));
}

async function tokenValid(env, raw) {
  if (!raw || !configured(env)) return false;
  const parts = String(raw).split('.');
  if (parts.length !== 2) return false;
  const [exp, sig] = parts;
  if (!/^\d{1,15}$/.test(exp) || Number(exp) < Date.now()) return false;
  return timingSafe(sig, await signPayload(env, exp));
}

// Compare MACs of both values so neither content nor length leaks via timing.
async function passwordMatches(env, password) {
  const expected = String(env.ADMIN_PASS || '').trim();
  if (!expected) return false;
  const [a, b] = await Promise.all([
    hmac(env.ADMIN_SESSION_SECRET, 'pw|' + String(password).trim()),
    hmac(env.ADMIN_SESSION_SECRET, 'pw|' + expected),
  ]);
  return timingSafe(a, b);
}

function cookieFrom(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

// Best-effort only: this map is per isolate. Add a Cloudflare WAF rate-limiting
// rule on POST /__login for a real limit.
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
  const msg = error === 'slow' ? 'Too many attempts. Wait a few minutes and try again.'
    : error === 'config' ? 'The gate is not configured.'
    : error ? 'Wrong password. Try again.' : '';
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
  ${msg ? '<p class="err">' + msg + '</p>' : ''}
</form></body></html>`;
}

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Rumi Fragrances (sister company) catalogue for "Sync from Rumi" in the web
// admin. Only behind the password gate, and only ever fetches Rumi's product
// sitemap or an "Inspired By" product page — never an arbitrary URL.
const RUMI_ORIGIN = 'https://rumifragrances.co.za';
async function rumiProxy(url) {
  let target;
  try { target = new URL(url.searchParams.get('u') || ''); } catch { return new Response('Bad url', { status: 400 }); }
  const ok = target.origin === RUMI_ORIGIN && !target.search && !target.hash &&
    (target.pathname === '/sitemap/products-0' || /^\/product\/inspired-by-[a-z0-9-]+$/i.test(target.pathname));
  if (!ok) return new Response('Not allowed', { status: 403 });
  try {
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': 'KauaTracker/1.0 (sister-company catalogue sync)', Accept: 'text/html,application/xml' },
      cf: { cacheTtl: 900, cacheEverything: true },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response('Upstream error', { status: 502 });
  }
}

async function handle(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/__logout') {
    const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    headers.append('Set-Cookie', LEGACY_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    return new Response(null, { status: 302, headers });
  }

  if (!configured(env)) return htmlResponse(page('config'), 503);

  if (url.pathname === '/__login' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (tooMany(ip)) return htmlResponse(page('slow'), 429);
    let password = '';
    try {
      const form = await request.formData();
      password = String(form.get('password') || '').slice(0, 512);
    } catch { /* ignore */ }
    // Trimmed on both sides: piping a secret through PowerShell/wrangler can add
    // a trailing newline, which must not lock the owner out.
    if (!(await passwordMatches(env, password))) return htmlResponse(page('bad'), 401);
    const token = await issueToken(env);
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Cache-Control': 'no-store',
        'Set-Cookie': COOKIE + '=' + token + '; Path=/; Max-Age=' + SESSION_DAYS * 24 * 3600 + '; HttpOnly; Secure; SameSite=Lax',
      },
    });
  }

  if (await tokenValid(env, cookieFrom(request))) {
    if (url.pathname === '/api/rumi') return rumiProxy(url);
    return env.ASSETS.fetch(request);
  }

  return htmlResponse(page(null), 401);
}

export default {
  async fetch(request, env) {
    return secured(await handle(request, env));
  },
};
