# Projeto Aplicado: Práticas de Mercado — UNCISAL

Protótipo web com foco em **Secure by Design** e **Secure by Default**, cobrindo os três eixos da disciplina e a esteira de CI/CD.

Documento de escopo oficial: [Escopo e elementos obrigatórios](https://github.com/ziraldocardoso/Projeto_aplicado-praticas_de_mercado/blob/main/Escopo_e_elementos_obrigatorios.md).

---

## Visão geral

| Eixo | Entrega |
|------|---------|
| **1 — Infraestrutura** | Ubuntu/Debian + Nginx + SSH por chave + Fail2Ban + HTTPS (Certbot) + PQC |
| **2 — Repositório** | GitHub público + `.gitignore` sem segredos |
| **3 — Desenvolvimento** | App Node.js/Express: Login, Dashboard, Logout + 3 mitigações OWASP Top 10:2025 |
| **CI/CD** | GitHub Actions faz deploy automático em `push` para `main` |

Fluxo: **IDE com IA (Cursor / Antigravity)** → **GitHub** → **GitHub Actions** → **VM na nuvem (Nginx + Node)**.

---

## Como rodar localmente

```bash
cp .env.example .env
# edite SESSION_SECRET, DEMO_USERNAME e DEMO_PASSWORD

npm install
npm start
```

Acesse: `http://127.0.0.1:3000/login`

> Em desenvolvimento, o cookie de sessão usa `secure: false` (`NODE_ENV` diferente de `production`). Em produção, atrás do Nginx com HTTPS, use `NODE_ENV=production`.

---

## Estrutura do repositório

```
.
├── .github/workflows/deploy.yml   # Pipeline CI/CD
├── infra/
│   ├── setup-server.sh            # Provisionamento Ubuntu/Debian
│   ├── nginx.conf                 # Reverse proxy + HTTP→HTTPS
│   └── nginx-pqc.conf             # Diretivas PQC
├── public/css/styles.css
├── src/
│   ├── auth.js                    # Auth, sanitização, requireAuth
│   ├── publicData.js              # CNES Maceió via DEMAS (MS)
│   └── server.js                  # App Express
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Eixo 3 — Funcionalidades

1. **Tela de Login** (`GET/POST /login`)
2. **Página interna** (`GET /dashboard`) — só após autenticação no servidor
3. **Logout** (`POST /logout`) — invalida a sessão
4. **Painel CNES Maceió** no dashboard — consumo **server-side** da API pública:
   - [DEMAS – Dados Abertos](https://apidadosabertos.saude.gov.br/v1/) → `GET /cnes/estabelecimentos?codigo_municipio=270430`
   - Lista estabelecimentos de saúde em **Maceió/AL** (código IBGE `270430`), priorizando unidades com atendimento ambulatorial SUS
   - Sem chave de API; timeout, cache (~10 min) e escape HTML no servidor

Credenciais ficam **apenas** em variáveis de ambiente (`.env` no servidor). Nunca no código versionado.

### Por que CNES/DEMAS e não CadSUS/CNS?

A API [CNS/CadSUS (Conecta)](https://www.gov.br/conecta/catalogo/apis/cadsus-cadastro-de-usuarios-do-sus) exige integração institucional (DataSUS). O **CNES** via DEMAS é a base pública de estabelecimentos de saúde e permite demonstrar interoperabilidade real em tecnologia da saúde no contexto da UNCISAL (Maceió), sem credencial Conecta.

---

## Mitigações OWASP Top 10:2025

Foram mitigadas **3 categorias** oficiais ([OWASP Top 10:2025](https://owasp.org/Top10/2025/)):

### 1) A01:2025 — Broken Access Control

- Middleware `requireAuth` em `src/auth.js` bloqueia `/dashboard` e `/logout` sem sessão válida.
- Após login, `req.session.regenerate()` evita *session fixation*.
- Cookie de sessão: `httpOnly`, `sameSite: 'strict'`, `secure` em produção.

**Onde ver:** `src/auth.js` (`requireAuth`) e `src/server.js` (rotas `/dashboard`, `/logout`).

### 2) A05:2025 — Injection

- Validação e sanitização do formulário (`validator.trim`, `escape`, allowlist de caracteres, limites de tamanho).
- CSP via Helmet restringe scripts/estilos.
- Escape de saída HTML no dashboard e nas mensagens de erro.

**Onde ver:** `sanitizeLoginInput` em `src/auth.js`; CSP em `src/server.js`.

### 3) A07:2025 — Authentication Failures

- Senha armazenada apenas como hash bcrypt (custo 12) em memória após boot.
- Comparação com bcrypt sempre executada (mitiga timing óbvio de usuário inexistente).
- Mensagem genérica de falha (“Credenciais inválidas”).
- Rate limiting: 10 tentativas / 15 min no `POST /login`.
- Proteção CSRF (`csrf-csrf`) nos POSTs.
- Sem senha hardcoded no repositório.

**Onde ver:** `src/auth.js` (`verifyCredentials`, `initAuth`); `loginLimiter` e CSRF em `src/server.js`.

> Extra de endurecimento (não conta como um dos 3 obrigatórios, mas reforça A02/A04): Helmet, HSTS no Nginx, TLS 1.2/1.3, segredo de sessão ≥ 32 caracteres.

---

## Eixo 2 — Repositório seguro

- Repositório **público** no GitHub.
- `.gitignore` bloqueia `.env`, chaves (`*.pem`, `id_rsa*`), `node_modules`, bancos locais.
- Use SSH ou PAT para `git push`; ative **2FA** na conta GitHub.
- Secrets do deploy ficam em **GitHub → Settings → Secrets and variables → Actions**, nunca no YAML.

### Secrets necessários no GitHub Actions

| Secret | Descrição |
|--------|-----------|
| `SSH_PRIVATE_KEY` | Chave privada usada pelo Actions para entrar no servidor |
| `SERVER_HOST` | IP público da VM |
| `DEPLOY_USER` | Usuário SSH (ex.: `deploy`) |
| `APP_PATH` | Caminho no servidor (ex.: `/var/www/projeto-aplicado`) |
| `SSH_PORT` | (Opcional) Porta SSH; padrão 22 |

---

## Eixo 1 — Infraestrutura (passo a passo)

### 1. Criar a VM (Free Tier)

Escolha um provedor com Free Tier (sugestão prática: **Oracle Cloud Always Free** ou **AWS Free Tier** / **Google Cloud**).

Requisitos:

- SO: **Ubuntu Server** ou **Debian** (última LTS estável)
- IP público
- Security Group / Firewall liberando **apenas**:
  - `22/tcp` (SSH)
  - `80/tcp` (HTTP — ACME + redirect)
  - `443/tcp` (HTTPS)

### 2. Acesso por chave SSH

No seu PC:

```bash
ssh-keygen -t ed25519 -C "projeto-aplicado"
```

Cadastre a chave **pública** na VM. Confirme o login por chave e **só então** rode o script (ele desativa senha).

### 3. Provisionar o servidor

```bash
# na VM, como root/sudo
sudo bash infra/setup-server.sh
```

O script instala Nginx, Fail2Ban (`maxretry=4`, `bantime=86400`), Node.js, Certbot (snap) e a unit systemd `projeto-aplicado`.

### 4. Aplicação e `.env` no servidor

```bash
sudo mkdir -p /var/www/projeto-aplicado
# após o primeiro deploy (ou rsync manual), no servidor:
cd /var/www/projeto-aplicado
sudo -u deploy cp .env.example .env
sudo -u deploy nano .env   # SESSION_SECRET + credenciais
sudo -u deploy npm ci --omit=dev
sudo systemctl enable --now projeto-aplicado
```

### 5. Nginx + HTTPS (Certbot ≥ 5.4, IP público)

1. Ajuste `infra/nginx.conf` substituindo `SEU_IP_PUBLICO`.
2. Copie para `/etc/nginx/sites-available/projeto` e habilite o site.
3. Emita o certificado (Let's Encrypt com suporte a IP — veja [anúncio Let's Encrypt](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)):

```bash
sudo certbot --nginx -d SEU_IP_PUBLICO
# ou o fluxo indicado pela documentação atual do Certbot para certificados em IP
sudo systemctl reload nginx
```

Confirme o redirecionamento HTTP → HTTPS e a renovação automática (`systemctl list-timers | grep certbot` ou `certbot renew --dry-run`).

### 6. PQC (Post-Quantum Cryptography)

Inclua as diretivas de `infra/nginx-pqc.conf` no server HTTPS (conforme suporte do OpenSSL/Nginx da distro). Valide em:

- Certificado / IP: [SSL.org Certificate Checker](https://www.ssl.org/) → **Trusted: YES** e algoritmo aceitável
- PQC: [DigiCert TLS quantum readiness check](https://www.digicert.com/pqc-checker)

Se usar domínio: [Qualys SSL Labs](https://www.ssllabs.com/ssltest/) com **nota A** + suporte PQC.

### 7. Fail2Ban — verificação

```bash
sudo fail2ban-client status sshd
```

Deve mostrar jail ativo com política de 4 tentativas / banimento de 24h.

---

## CI/CD — GitHub Actions

Arquivo: `.github/workflows/deploy.yml`

- Gatilho: `git push origin main`
- Usa `SSH_PRIVATE_KEY` (Secret) + `rsync` para sincronizar o código
- Roda `npm ci` e `systemctl restart projeto-aplicado` no servidor
- **Não** envia `.env` nem chaves

Fluxo esperado após o servidor estar pronto:

```bash
git add .
git commit -m "feat: protótipo seguro com login e CI/CD"
git push origin main
```

Acompanhe em **GitHub → Actions**.

---

## Codificação assistida por IA

O desenvolvimento e a auditoria de segurança deste código foram realizados com assistência de IA no ambiente Cursor (IDE com agente), equivalente ao fluxo indicado com [Google Antigravity](https://antigravity.google/product/antigravity-ide/) no escopo da disciplina.

---

## Checklist de entrega

- [ ] App acessível por IP público (HTTPS)
- [ ] Nginx com redirect HTTP→HTTPS + Certbot
- [ ] Testes SSL/PQC ok
- [ ] SSH só por chave + Fail2Ban (4 erros / 24h)
- [ ] Repositório GitHub público
- [ ] `.gitignore` ok — sem segredos commitados
- [ ] Login + página interna + Logout
- [ ] README com 3 itens OWASP documentados
- [ ] Deploy automático via GitHub Actions no `push` para `main`

---

## URL de produção

> Preencha após a VM estar no ar:

- **Aplicação:** `https://SEU_IP_PUBLICO/`
- **Repositório:** `https://github.com/SEU_USUARIO/SEU_REPO`
