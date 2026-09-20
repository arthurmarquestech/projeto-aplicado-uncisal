'use strict';

/**
 * Autenticação Secure by Design
 * Mitiga A07:2025 Authentication Failures e A04:2025 Cryptographic Failures
 */

const bcrypt = require('bcryptjs');
const validator = require('validator');

const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;

function getDemoCredentials() {
  const username = process.env.DEMO_USERNAME;
  const password = process.env.DEMO_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'DEMO_USERNAME e DEMO_PASSWORD devem estar definidos no ambiente (.env).'
    );
  }

  return { username, password };
}

/** Hash em memória (gerado na inicialização) — senha nunca fica em texto puro no runtime. */
let passwordHashPromise = null;

function initAuth() {
  const { password } = getDemoCredentials();
  passwordHashPromise = bcrypt.hash(password, 12);
  return passwordHashPromise;
}

/**
 * Sanitiza e valida entrada do formulário de login.
 * Mitiga A05:2025 Injection (XSS / input malicioso).
 */
function sanitizeLoginInput(rawUsername, rawPassword) {
  const username = validator.trim(String(rawUsername ?? '')).slice(0, MAX_USERNAME_LENGTH);
  const password = String(rawPassword ?? '').slice(0, MAX_PASSWORD_LENGTH);

  const safeUsername = validator.escape(username);

  if (!username || !password) {
    return { ok: false, error: 'Usuário e senha são obrigatórios.' };
  }

  if (!validator.isLength(username, { min: 3, max: MAX_USERNAME_LENGTH })) {
    return { ok: false, error: 'Credenciais inválidas.' };
  }

  // Rejeita caracteres de controle / padrões típicos de injeção em campos de texto
  if (!/^[a-zA-Z0-9._@-]+$/.test(username)) {
    return { ok: false, error: 'Credenciais inválidas.' };
  }

  return { ok: true, username: safeUsername, rawUsername: username, password };
}

async function verifyCredentials(username, password) {
  const demo = getDemoCredentials();
  const hash = await passwordHashPromise;

  // Comparação em tempo constante: sempre executa bcrypt mesmo se o usuário não existir
  const userMatches = username === demo.username;
  const passwordMatches = await bcrypt.compare(password, hash);

  return userMatches && passwordMatches;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true && req.session.user) {
    return next();
  }

  // A01:2025 Broken Access Control — negar acesso a rotas internas
  return res.redirect('/login?error=' + encodeURIComponent('Faça login para continuar.'));
}

module.exports = {
  initAuth,
  sanitizeLoginInput,
  verifyCredentials,
  requireAuth,
};
