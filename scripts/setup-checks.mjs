import { existsSync, readFileSync } from 'node:fs';
import { writePrivateFile } from './private-files.mjs';

// Free, read-only endpoints: checking a credential never creates a paid task.
const DATAFORSEO_USER = 'https://api.dataforseo.com/v3/appendix/user_data';
const OPENROUTER_KEY = 'https://openrouter.ai/api/v1/key';
const MINIMUM_NODE = [22, 13];

/** Pick the language for installer messages: --lang, then LANG/LC_ALL, else English. */
export function installerLanguage({ lang, env = process.env } = {}) {
  const requested = lang || env.LASTFIND_LANG || env.LC_ALL || env.LANG || '';
  return /^pt/i.test(requested) ? 'pt-BR' : 'en';
}

export function nodeVersionProblem(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  const [wantMajor, wantMinor] = MINIMUM_NODE;
  return major > wantMajor || (major === wantMajor && minor >= wantMinor)
    ? null
    : version;
}

async function request(fetchImpl, url, headers) {
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      /* A non-JSON answer is reported by status only. */
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Check a DataForSEO login without printing it. `reason` is one of
 * `invalid`, `unreachable`, `unexpected`; a valid account also reports its balance.
 */
export async function checkDataForSeo(
  { login, password },
  { fetchImpl = fetch } = {},
) {
  const basic = Buffer.from(`${login}:${password}`).toString('base64');
  const { status, body } = await request(fetchImpl, DATAFORSEO_USER, {
    Authorization: `Basic ${basic}`,
  });
  if (status === 0) return { ok: false, reason: 'unreachable' };
  if (status === 401 || status === 403 || body?.status_code === 40100)
    return { ok: false, reason: 'invalid' };
  if (status !== 200 || body?.status_code !== 20000)
    return { ok: false, reason: 'unexpected', status };
  const balance = body.tasks?.[0]?.result?.[0]?.money?.balance;
  return { ok: true, balance: typeof balance === 'number' ? balance : null };
}

/** Check an OpenRouter key. A key with a spending limit also reports what is left. */
export async function checkOpenRouter(key, { fetchImpl = fetch } = {}) {
  const { status, body } = await request(fetchImpl, OPENROUTER_KEY, {
    Authorization: `Bearer ${key}`,
  });
  if (status === 0) return { ok: false, reason: 'unreachable' };
  if (status === 401 || status === 403)
    return { ok: false, reason: 'invalid' };
  if (status !== 200 || !body?.data)
    return { ok: false, reason: 'unexpected', status };
  const remaining = body.data.limit_remaining;
  return {
    ok: true,
    remaining: typeof remaining === 'number' ? remaining : null,
  };
}

/** Parse the simple KEY=value lines this project's `.env` uses. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

/** Update only the named keys in place, keeping comments and every other line. */
export function mergeEnv(text, entries) {
  const pending = new Map(Object.entries(entries));
  const lines = text.length ? text.split(/\r?\n/) : [];
  const merged = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  while (merged.length && merged.at(-1) === '') merged.pop();
  for (const [key, value] of pending) merged.push(`${key}=${value}`);
  return merged.join('\n') + '\n';
}

/** Save typed credentials to the private `.env` so the next run does not ask again. */
export function saveEnv(path, entries) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const value of Object.values(entries))
    if (/[\r\n]/.test(value))
      throw new Error('A credential cannot contain a line break.');
  writePrivateFile(path, mergeEnv(text, entries));
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validInstallationName(value) {
  return /^[a-z0-9][a-z0-9-]{2,50}$/.test(value);
}

/** Reduce an unexpected failure to a sentence a person can act on. */
export function explainFailure(error, language = 'en') {
  const output = `${error?.output || ''} ${error?.message || ''}`;
  const pt = language === 'pt-BR';
  if (/\b10042\b/.test(output))
    return null; // R2 guidance already comes with its own message.
  if (/\b10000\b|authentication error|Authentication failed/i.test(output))
    return pt
      ? 'A Cloudflare recusou o acesso. Se você usa CLOUDFLARE_API_TOKEN, confira se o token tem permissão de edição para Workers, D1 e R2 nesta conta. Se você entrou pelo navegador, rode `npx wrangler logout` e depois `npm run setup` de novo.'
      : 'Cloudflare refused access. If you use CLOUDFLARE_API_TOKEN, check that the token can edit Workers, D1 and R2 on this account. If you signed in through the browser, run `npx wrangler logout` and then `npm run setup` again.';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(output))
    return pt
      ? 'Não consegui falar com a Cloudflare. Confira sua conexão com a internet e rode `npm run setup` de novo: nada do que já foi criado se perde.'
      : 'Could not reach Cloudflare. Check your internet connection and run `npm run setup` again: nothing already created is lost.';
  return null;
}

export class SetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetupError';
  }
}

const say = (language) => (en, pt) => (language === 'pt-BR' ? pt : en);

/**
 * Obtain and verify the provider credentials. Values come from the environment
 * or `.env`; an interactive run asks for what is missing and lets the person
 * correct a wrong value. Nothing here ever prints a credential.
 */
export async function gatherCredentials({
  env,
  interactive,
  ask,
  askSecret,
  log,
  language = 'en',
  fetchImpl = fetch,
}) {
  const m = say(language);
  const typed = {};
  let login = env.DATAFORSEO_LOGIN || '';
  let password = env.DATAFORSEO_PASSWORD || '';
  let dataforseo;
  for (let attempt = 1; ; attempt++) {
    if (!login || !password) {
      if (!interactive)
        throw new SetupError(
          m(
            'DataForSEO login and password are missing. Put DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in the .env file (see the installation guide, step 2), then run npm run setup again.',
            'Faltam o login e a senha do DataForSEO. Coloque DATAFORSEO_LOGIN e DATAFORSEO_PASSWORD no arquivo .env (veja o guia de instalação, passo 2) e rode npm run setup de novo.',
          ),
        );
      if (attempt === 1)
        log(
          m(
            '\nDataForSEO collects the AI answers Lastfind analyses. It is a separate, prepaid account of yours. In its dashboard open API Access: the login is your account email and the API password is generated there (it is not your site password).',
            '\nO DataForSEO coleta as respostas das IAs que o Lastfind analisa. É uma conta sua, separada e pré-paga. No painel dele abra API Access: o login é o e-mail da conta e a senha da API é gerada ali (não é a senha de entrada no site).',
          ),
        );
      login = await ask(m('DataForSEO login (email)', 'Login do DataForSEO (e-mail)'));
      password = await askSecret(
        m(
          'DataForSEO API password (hidden as you type)',
          'Senha da API do DataForSEO (não aparece ao digitar)',
        ),
      );
      typed.DATAFORSEO_LOGIN = login;
      typed.DATAFORSEO_PASSWORD = password;
      if (!login || !password) continue;
    }
    const result = await checkDataForSeo({ login, password }, { fetchImpl });
    if (result.ok) {
      dataforseo = { login, password, balance: result.balance };
      break;
    }
    if (result.reason === 'unreachable')
      throw new SetupError(
        m(
          'Could not reach DataForSEO to check your credentials. Check your internet connection and run npm run setup again.',
          'Não consegui falar com o DataForSEO para conferir suas credenciais. Confira a internet e rode npm run setup de novo.',
        ),
      );
    if (result.reason === 'unexpected')
      throw new SetupError(
        m(
          `DataForSEO answered unexpectedly (HTTP ${result.status}). Wait a few minutes and run npm run setup again.`,
          `O DataForSEO respondeu de forma inesperada (HTTP ${result.status}). Espere alguns minutos e rode npm run setup de novo.`,
        ),
      );
    const wrong = m(
      'DataForSEO did not accept this login and password. Use the API login (account email) and the API password from the dashboard\'s API Access page.',
      'O DataForSEO não aceitou esse login e senha. Use o login da API (e-mail da conta) e a senha da API da página API Access do painel.',
    );
    if (!interactive || attempt >= 3) throw new SetupError(wrong);
    log(`\n${wrong}`);
    login = '';
    password = '';
    delete typed.DATAFORSEO_LOGIN;
    delete typed.DATAFORSEO_PASSWORD;
  }
  if (dataforseo.balance !== null)
    log(
      dataforseo.balance > 0
        ? m(
            `DataForSEO: login accepted, balance US$ ${dataforseo.balance.toFixed(2)}.`,
            `DataForSEO: login aceito, saldo US$ ${dataforseo.balance.toFixed(2)}.`,
          )
        : m(
            'DataForSEO: login accepted, but the balance is zero. Add funds in the DataForSEO dashboard before the first collection, otherwise it will fail.',
            'DataForSEO: login aceito, mas o saldo está zerado. Adicione saldo no painel do DataForSEO antes da primeira coleta, senão ela falha.',
          ),
    );
  else
    log(m('DataForSEO: login accepted.', 'DataForSEO: login aceito.'));

  let key = env.OPENROUTER_API_KEY || '';
  let openrouter = null;
  const skipHint = m(
    'OpenRouter key for optional brand sentiment (press Enter to skip, hidden as you type)',
    'Chave do OpenRouter para o sentimento de marca, opcional (Enter para pular; não aparece ao digitar)',
  );
  if (!key && interactive) {
    log(
      m(
        '\nOpenRouter is optional. It powers the brand sentiment review, a separate prepaid account with its own small cost. You can skip now and add the key later.',
        '\nO OpenRouter é opcional. Ele alimenta a revisão de sentimento da marca, numa conta pré-paga separada e com custo próprio pequeno. Você pode pular agora e adicionar a chave depois.',
      ),
    );
    key = await askSecret(skipHint);
    if (key) typed.OPENROUTER_API_KEY = key;
  }
  for (let attempt = 1; key; attempt++) {
    const result = await checkOpenRouter(key, { fetchImpl });
    if (result.ok) {
      openrouter = { key, remaining: result.remaining };
      log(
        m('OpenRouter: key accepted.', 'OpenRouter: chave aceita.') +
          (result.remaining !== null
            ? m(
                ` Spending limit left on this key: US$ ${result.remaining.toFixed(2)}.`,
                ` Limite de gasto restante nesta chave: US$ ${result.remaining.toFixed(2)}.`,
              )
            : ''),
      );
      break;
    }
    if (result.reason === 'unreachable')
      throw new SetupError(
        m(
          'Could not reach OpenRouter to check your key. Check your internet connection and run npm run setup again.',
          'Não consegui falar com o OpenRouter para conferir sua chave. Confira a internet e rode npm run setup de novo.',
        ),
      );
    if (result.reason === 'unexpected')
      throw new SetupError(
        m(
          `OpenRouter answered unexpectedly (HTTP ${result.status}). Wait a few minutes and run npm run setup again.`,
          `O OpenRouter respondeu de forma inesperada (HTTP ${result.status}). Espere alguns minutos e rode npm run setup de novo.`,
        ),
      );
    const wrong = m(
      'OpenRouter did not accept this key. Copy it again from openrouter.ai/keys (it starts with sk-or-).',
      'O OpenRouter não aceitou essa chave. Copie de novo em openrouter.ai/keys (ela começa com sk-or-).',
    );
    if (!interactive || attempt >= 3) throw new SetupError(wrong);
    log(`\n${wrong}`);
    delete typed.OPENROUTER_API_KEY;
    key = await askSecret(skipHint);
    if (key) typed.OPENROUTER_API_KEY = key;
  }
  return { dataforseo, openrouter, typed };
}

// One owner owns every project, so research covers all of them by default. A
// value already present in the installation's config (for instance a project
// list the owner edited) is kept when setup runs again.
export function researchVars(existingVars = {}, research) {
  if (!research) return {};
  return {
    BRAND_RESEARCH_ENABLED: existingVars.BRAND_RESEARCH_ENABLED || 'true',
    BRAND_RESEARCH_PROJECTS: existingVars.BRAND_RESEARCH_PROJECTS || '*',
  };
}
