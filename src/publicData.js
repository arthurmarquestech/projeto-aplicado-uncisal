'use strict';

/**
 * Painel CNES Maceió — DEMAS (Ministério da Saúde)
 *
 * Consome a API pública de Dados Abertos:
 * https://apidadosabertos.saude.gov.br/cnes/estabelecimentos
 *
 * Município IBGE 270430 = Maceió/AL (UNCISAL).
 * Sem chave de API. CadSUS/CNS (Conecta) permanece institucional — ver README.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };

const CNES_BASE =
  process.env.CNES_API_BASE ||
  'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos';
const MUNICIPIO_IBGE = process.env.CNES_MUNICIPIO_IBGE || '270430';
const MUNICIPIO_NOME = process.env.CNES_MUNICIPIO_NOME || 'Maceió';
const UF = process.env.CNES_UF || 'AL';
const FETCH_LIMIT = Number(process.env.CNES_FETCH_LIMIT || 30);
const DISPLAY_LIMIT = Number(process.env.CNES_DISPLAY_LIMIT || 8);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, max = 100) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatCep(cep) {
  const digits = String(cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return escapeHtml(cep || '—');
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} em ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEstabelecimento(raw) {
  const nome = raw.nome_fantasia || raw.nome_razao_social || 'Estabelecimento sem nome';
  const atendimentoSus = String(
    raw.estabelecimento_faz_atendimento_ambulatorial_sus || ''
  ).toUpperCase();

  return {
    cnes: String(raw.codigo_cnes ?? ''),
    nome: truncate(nome, 80),
    bairro: truncate(raw.bairro_estabelecimento || '—', 40),
    cep: raw.codigo_cep_estabelecimento || '',
    esfera: truncate(raw.descricao_esfera_administrativa || '—', 30),
    turno: truncate(raw.descricao_turno_atendimento || '—', 70),
    atendimentoSus: atendimentoSus === 'SIM',
  };
}

async function fetchCnesMaceio() {
  const url =
    `${CNES_BASE}?codigo_municipio=${encodeURIComponent(MUNICIPIO_IBGE)}` +
    `&limit=${encodeURIComponent(FETCH_LIMIT)}`;

  const data = await fetchJson(url);
  const list = Array.isArray(data.estabelecimentos) ? data.estabelecimentos : [];
  const normalized = list.map(normalizeEstabelecimento).filter((e) => e.cnes);

  // Prioriza unidades com atendimento ambulatorial SUS
  normalized.sort((a, b) => Number(b.atendimentoSus) - Number(a.atendimentoSus));

  return {
    municipio: MUNICIPIO_NOME,
    uf: UF,
    municipioIbge: MUNICIPIO_IBGE,
    totalRetornado: normalized.length,
    items: normalized.slice(0, DISPLAY_LIMIT),
  };
}

async function getDashboardFeed() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const cnes = await fetchCnesMaceio();
    const feed = {
      cnes: { ok: true, ...cnes },
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: now, data: feed };
    return feed;
  } catch (err) {
    console.error('[cnes]', err.message);
    const feed = {
      cnes: {
        ok: false,
        municipio: MUNICIPIO_NOME,
        uf: UF,
        items: [],
        error: 'Não foi possível consultar o CNES (DEMAS) neste momento.',
      },
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: now, data: feed };
    return feed;
  }
}

function renderFeedHtml(feed) {
  const cnes = feed.cnes;

  let listHtml;
  if (!cnes.ok) {
    listHtml = `<p class="feed-meta" role="alert">${escapeHtml(cnes.error)}</p>`;
  } else if (!cnes.items.length) {
    listHtml = `<p class="feed-meta">Nenhum estabelecimento retornado para ${escapeHtml(cnes.municipio)}.</p>`;
  } else {
    listHtml = `<ul class="cnes-list">${cnes.items
      .map((item) => {
        const susBadge = item.atendimentoSus
          ? '<span class="sev sev-low">SUS</span>'
          : '<span class="sev sev-na">Sem ambulatorial SUS</span>';
        return `<li>
          <div class="cve-head">
            <strong>${escapeHtml(item.nome)}</strong>
            ${susBadge}
          </div>
          <p class="cve-summary">
            CNES ${escapeHtml(item.cnes)} · ${escapeHtml(item.bairro)} · CEP ${formatCep(item.cep)}
          </p>
          <p class="feed-source" style="margin-top:0.35rem">
            ${escapeHtml(item.esfera)} · ${escapeHtml(item.turno)}
          </p>
        </li>`;
      })
      .join('')}</ul>`;
  }

  const metaOk = cnes.ok
    ? `<p class="feed-meta">
        Amostra de <strong>${escapeHtml(cnes.items.length)}</strong> unidades em
        ${escapeHtml(cnes.municipio)}/${escapeHtml(cnes.uf)}
        (código IBGE ${escapeHtml(cnes.municipioIbge)}), priorizando atendimento ambulatorial SUS.
      </p>`
    : '';

  return `<section class="feed" aria-label="CNES Maceió via DEMAS">
    <p class="feed-title">CNES · Maceió / AL</p>
    <div class="feed-grid feed-grid-cnes">
      <div class="feed-card feed-card-span">
        <h2>Estabelecimentos de saúde</h2>
        ${metaOk}
        ${listHtml}
        <p class="feed-source">
          Fonte: DEMAS — API de Dados Abertos do Ministério da Saúde
          (<a href="https://apidadosabertos.saude.gov.br/v1/" rel="noopener noreferrer" target="_blank">documentação</a>).
          Consulta server-side, sem chave. CadSUS/CNS (Conecta) exige acesso institucional e não é usado neste protótipo.
        </p>
      </div>
    </div>
  </section>`;
}

module.exports = {
  getDashboardFeed,
  renderFeedHtml,
};
