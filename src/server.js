'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');

const {
  initAuth,
  sanitizeLoginInput,
  verifyCredentials,
  requireAuth,
} = require('./auth');
const { getDashboardFeed, renderFeedHtml } = require('./publicData');

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET deve ter pelo menos 32 caracteres. Veja .env.example');
  process.exit(1);
}

initAuth().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

const app = express();

app.set('trust proxy', 1);

// A02:2025 Security Misconfiguration — cabeçalhos de segurança
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

app.use(
  session({
    name: 'sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: 1000 * 60 * 30, // 30 minutos
    },
  })
);

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET,
  getSessionIdentifier: (req) => req.sessionID || '',
  cookieName: 'csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: '/',
  },
  getTokenFromRequest: (req) =>
    req.body._csrf || req.headers['x-csrf-token'],
});

// A07:2025 — rate limit no login (mitiga força bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Muitas tentativas de login. Tente novamente em alguns minutos.',
});

function renderLogin(res, { error = '', csrfToken = '' } = {}) {
  res.type('html').send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Login | Projeto Aplicado UNCISAL</title>
  <link rel="stylesheet" href="/css/styles.css" />
</head>
<body>
  <main class="shell">
    <section class="panel" aria-labelledby="login-title">
      <p class="brand">UNCISAL · Secure by Design</p>
      <h1 id="login-title">Acesso seguro</h1>
      <p class="lead">Autentique-se para abrir a área interna protegida.</p>
      ${error ? `<p class="alert" role="alert">${error}</p>` : ''}
      <form method="POST" action="/login" autocomplete="off" novalidate>
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <label for="username">Usuário</label>
        <input id="username" name="username" type="text" maxlength="64" required autofocus />
        <label for="password">Senha</label>
        <input id="password" name="password" type="password" maxlength="128" required />
        <button type="submit">Entrar</button>
      </form>
    </section>
  </main>
</body>
</html>`);
}

function renderDashboard(res, { username, csrfToken, feedHtml = '' }) {
  const safeUser = String(username)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  res.type('html').send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Área Interna | Projeto Aplicado UNCISAL</title>
  <link rel="stylesheet" href="/css/styles.css" />
</head>
<body>
  <main class="shell">
    <section class="panel wide" aria-labelledby="dash-title">
      <header class="topbar">
        <p class="brand">UNCISAL · Área autenticada</p>
        <form method="POST" action="/logout">
          <input type="hidden" name="_csrf" value="${csrfToken}" />
          <button type="submit" class="ghost">Logout</button>
        </form>
      </header>
      <h1 id="dash-title">Bem-vindo(a), ${safeUser}</h1>
      <p class="lead">
        Esta página só é servida após autenticação válida. Abaixo: estabelecimentos
        de saúde de Maceió (CNES) via API pública DEMAS.
      </p>
      ${feedHtml}
      <ul class="checklist">
        <li>Sessão com cookie <code>httpOnly</code> + <code>SameSite=Strict</code></li>
        <li>Proteção CSRF nos formulários</li>
        <li>Rate limiting e validação no login</li>
      </ul>
    </section>
  </main>
</body>
</html>`);
}

app.get('/', (req, res) => {
  if (req.session?.authenticated) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session?.authenticated) {
    return res.redirect('/dashboard');
  }

  const error = req.query.error
    ? String(req.query.error).slice(0, 200)
    : '';
  const safeError = error
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Persiste a sessão antes de emitir o CSRF (evita mismatch do sessionID)
  req.session.csrfReady = true;
  req.session.save((err) => {
    if (err) {
      console.error('[auth] session save failed', err.message);
      return res.status(500).send('Erro interno. Tente novamente.');
    }
    const csrfToken = generateToken(req, res, true);
    return renderLogin(res, { error: safeError, csrfToken });
  });
});

app.post('/login', loginLimiter, doubleCsrfProtection, async (req, res) => {
  const parsed = sanitizeLoginInput(req.body.username, req.body.password);
  const csrfToken = generateToken(req, res, true);

  if (!parsed.ok) {
    return renderLogin(res, { error: parsed.error, csrfToken });
  }

  const valid = await verifyCredentials(parsed.rawUsername, parsed.password);
  if (!valid) {
    // Mensagem genérica — não revela se usuário ou senha falhou (A07)
    return renderLogin(res, {
      error: 'Credenciais inválidas.',
      csrfToken,
    });
  }

  // Regenera o ID de sessão após login (mitiga session fixation — A01/A07)
  req.session.regenerate((err) => {
    if (err) {
      console.error('[auth] session regenerate failed', err.message);
      return res.status(500).send('Erro interno. Tente novamente.');
    }
    req.session.authenticated = true;
    req.session.user = parsed.rawUsername;
    req.session.loginAt = new Date().toISOString();
    console.info(`[auth] login ok user=${parsed.rawUsername} at=${req.session.loginAt}`);
    return res.redirect('/dashboard');
  });
});

// A01:2025 Broken Access Control — rota protegida no servidor
app.get('/dashboard', requireAuth, async (req, res) => {
  const csrfToken = generateToken(req, res, true);
  let feedHtml = '';
  try {
    const feed = await getDashboardFeed();
    feedHtml = renderFeedHtml(feed);
  } catch (err) {
    console.error('[feed]', err.message);
    feedHtml =
      '<p class="alert" role="alert">Não foi possível carregar o painel ao vivo.</p>';
  }
  return renderDashboard(res, {
    username: req.session.user,
    csrfToken,
    feedHtml,
  });
});

app.post('/logout', requireAuth, doubleCsrfProtection, (req, res) => {
  const user = req.session.user;
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth] logout failed', err.message);
    } else {
      console.info(`[auth] logout user=${user}`);
    }
    res.clearCookie('sid');
    res.clearCookie('csrf');
    return res.redirect('/login');
  });
});

// Healthcheck simples (sem dados sensíveis)
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// A10:2025 — tratamento seguro de erros (sem stack trace ao cliente)
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  if (err.code === 'EBADCSRFTOKEN' || /csrf/i.test(err.message || '')) {
    return res.status(403).send('Token CSRF inválido. Recarregue a página.');
  }
  res.status(500).send('Erro interno do servidor.');
});

app.use((_req, res) => {
  res.status(404).send('Recurso não encontrado.');
});

app.listen(PORT, '127.0.0.1', () => {
  console.info(`App ouvindo em 127.0.0.1:${PORT} (proxy Nginx na frente)`);
});
