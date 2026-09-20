'use strict';

/**
 * Smoke test local do fluxo login → dashboard → logout.
 * Uso: node scripts/smoke-test.js
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

function parseCookies(res) {
  const raw = res.headers.getSetCookie?.() || [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  let cookie = '';

  const loginPage = await fetch(`${BASE}/login`, {
    headers: cookie ? { cookie } : {},
  });
  const set1 = parseCookies(loginPage);
  if (set1) cookie = mergeCookies(cookie, set1);
  const html = await loginPage.text();
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('CSRF token não encontrado no login');
  const csrf = match[1];

  const body = new URLSearchParams({
    username: process.env.DEMO_USERNAME || 'admin',
    password: process.env.DEMO_PASSWORD || 'TroqueEstaSenhaForte123!',
    _csrf: csrf,
  });

  const post = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body,
  });
  const set2 = parseCookies(post);
  if (set2) cookie = mergeCookies(cookie, set2);

  if (post.status !== 302 || !String(post.headers.get('location') || '').includes('/dashboard')) {
    const t = await post.text();
    throw new Error(`Login falhou: status=${post.status} body=${t.slice(0, 200)}`);
  }

  const dash = await fetch(`${BASE}/dashboard`, { headers: { cookie } });
  const set3 = parseCookies(dash);
  if (set3) cookie = mergeCookies(cookie, set3);
  const dashHtml = await dash.text();
  if (dash.status !== 200 || !dashHtml.includes('Bem-vindo')) {
    throw new Error('Dashboard inacessível após login');
  }
  if (!dashHtml.includes('CNES') || !dashHtml.includes('Maceió')) {
    throw new Error('Painel CNES Maceió ausente no dashboard');
  }

  const csrf2 = (dashHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  if (!csrf2) throw new Error('CSRF do logout ausente');

  const logout = await fetch(`${BASE}/logout`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body: new URLSearchParams({ _csrf: csrf2 }),
  });

  if (logout.status !== 302) {
    throw new Error(`Logout falhou: ${logout.status}`);
  }

  const set4 = parseCookies(logout);
  if (set4) cookie = mergeCookies(cookie, set4);

  const blocked = await fetch(`${BASE}/dashboard`, {
    redirect: 'manual',
    headers: { cookie },
  });
  if (blocked.status !== 302) {
    throw new Error('Dashboard deveria redirecionar sem autenticação');
  }

  console.log('Smoke test OK: login, dashboard, logout e controle de acesso.');
}

function mergeCookies(existing, incoming) {
  const map = new Map();
  for (const part of `${existing};${incoming}`.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
