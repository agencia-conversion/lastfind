import { mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { writePrivateFile, writePrivateJson } from './private-files.mjs';
import {
  assertRawStorageAvailable,
  provisionRawStorage,
} from './raw-storage.mjs';
import { configureProjectStorage } from './project-storage-config.mjs';
import {
  currentAccounts,
  readJson,
  run,
  assertWorkerAvailable,
} from './cloudflare-cli.mjs';
import {
  SetupError,
  explainFailure,
  gatherCredentials,
  installerLanguage,
  nodeVersionProblem,
  researchVars,
  saveEnv,
  validEmail,
  validInstallationName,
} from './setup-checks.mjs';

const { values } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    name: { type: 'string' },
    account: { type: 'string' },
    email: { type: 'string' },
    lang: { type: 'string' },
    'check-only': { type: 'boolean', default: false },
    help: { type: 'boolean' },
  },
});
const language = installerLanguage({ lang: values.lang });
const m = (en, pt) => (language === 'pt-BR' ? pt : en);
if (values.help) {
  console.log(
    m(
      'npm run setup -- [--name lastfind] [--account ACCOUNT_ID] [--email you@example.com] [--lang en|pt-BR] [--yes] [--check-only]\nThe guided installer asks for what is missing. --check-only only verifies your DataForSEO and OpenRouter credentials. --yes never asks: it needs the values in .env (DATAFORSEO_*, optional OPENROUTER_API_KEY), CLOUDFLARE_API_TOKEN, and --email.',
      'npm run setup -- [--name lastfind] [--account ACCOUNT_ID] [--email voce@exemplo.com] [--lang en|pt-BR] [--yes] [--check-only]\nO instalador guiado pergunta o que faltar. --check-only apenas confere as credenciais do DataForSEO e do OpenRouter. --yes nunca pergunta: precisa dos valores no .env (DATAFORSEO_*, OPENROUTER_API_KEY opcional), de CLOUDFLARE_API_TOKEN e de --email.',
    ),
  );
  process.exit(0);
}

const interactive = !values.yes && !!process.stdin.isTTY;
const muted = new Writable({
  write(chunk, encoding, callback) {
    if (!muted.hidden) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = interactive
  ? createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
      // Arrow-up must never bring back a typed password or key.
      historySize: 0,
    })
  : null;
// While a child process owns the terminal (sign-in, publishing), the terminal
// must be in its normal mode again, or Ctrl+C is typed instead of delivered.
function runWithTerminal(command, args) {
  const raw = process.stdin.isTTY && process.stdin.isRaw;
  if (raw) process.stdin.setRawMode(false);
  rl?.pause();
  try {
    return spawnSync(command, args, { stdio: 'inherit' });
  } finally {
    rl?.resume();
    if (raw) process.stdin.setRawMode(true);
  }
}
async function ask(label, fallback = '') {
  if (!rl) return fallback;
  process.stdout.write(`${label}${fallback ? ` [${fallback}]` : ''}: `);
  return (await rl.question('')).trim() || fallback;
}
async function askSecret(label) {
  if (!rl) return '';
  process.stdout.write(`${label}: `);
  muted.hidden = true;
  try {
    return (await rl.question('')).trim();
  } finally {
    muted.hidden = false;
    process.stdout.write('\n');
  }
}
const log = (text) => console.log(text);
const ownerKeyCommand =
  process.platform === 'win32'
    ? 'type .lastfind\\access-key.txt'
    : 'cat .lastfind/access-key.txt';

function stop(message) {
  console.error(
    `\n${m('Setup stopped', 'A instalação parou')}: ${message}\n${m(
      'Nothing you already created is lost. Fix the point above and run npm run setup again.',
      'Nada do que você já criou se perde. Corrija o ponto acima e rode npm run setup de novo.',
    )}`,
  );
  process.exitCode = 1;
}

async function cloudflareAccount() {
  let identity;
  const hasToken = !!process.env.CLOUDFLARE_API_TOKEN;
  try {
    identity = currentAccounts();
  } catch {
    // A scoped API token often cannot list accounts; the account id then names it.
    const named = values.account || process.env.CLOUDFLARE_ACCOUNT_ID;
    if (hasToken && named) return named;
    if (hasToken)
      throw new SetupError(
        m(
          'Cloudflare did not accept CLOUDFLARE_API_TOKEN, or the token cannot list your accounts. Check the token permissions (Workers Scripts, D1 and R2 edit), and if it is limited to one account also set CLOUDFLARE_ACCOUNT_ID.',
          'A Cloudflare não aceitou o CLOUDFLARE_API_TOKEN, ou o token não consegue listar suas contas. Confira as permissões do token (editar Workers Scripts, D1 e R2) e, se ele vale para uma só conta, defina também CLOUDFLARE_ACCOUNT_ID.',
        ),
      );
    if (!rl)
      throw new SetupError(
        m(
          'Not signed in to Cloudflare. In a script or on a server, create an API token and set CLOUDFLARE_API_TOKEN (see the installation guide, step 3); on your own computer run npm run setup without --yes and a browser window opens to sign in.',
          'Você não está conectado à Cloudflare. Em script ou servidor, crie um token de API e defina CLOUDFLARE_API_TOKEN (veja o guia de instalação, passo 3); no seu computador rode npm run setup sem --yes e uma janela do navegador abre para entrar.',
        ),
      );
    log(
      m(
        '\nNow connecting to Cloudflare: a browser window opens. Sign in and press Allow. If no window opens, press Ctrl+C and follow step 3 of the installation guide to use an API token instead.',
        '\nAgora a conexão com a Cloudflare: uma janela do navegador vai abrir. Entre na sua conta e clique em Allow. Se nenhuma janela abrir, aperte Ctrl+C e siga o passo 3 do guia de instalação para usar um token de API.',
      ),
    );
    runWithTerminal(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js',
      'login',
    ]);
    try {
      identity = currentAccounts();
    } catch {
      throw new SetupError(
        m(
          'The Cloudflare sign-in did not finish. Run npm run setup again.',
          'A conexão com a Cloudflare não terminou. Rode npm run setup de novo.',
        ),
      );
    }
  }
  const accounts = identity.accounts || [];
  let account = values.account || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account && accounts.length === 1) account = accounts[0].id;
  if (!account && rl) {
    log(m('\nYour Cloudflare accounts:', '\nSuas contas na Cloudflare:'));
    log(accounts.map((a, i) => `${i + 1}. ${a.name}`).join('\n'));
    const index = Number(await ask(m('Account number', 'Número da conta'))) - 1;
    account = accounts[index]?.id;
  }
  if (!account || (accounts.length && !accounts.some((a) => a.id === account)))
    throw new SetupError(
      m(
        'Choose one of your Cloudflare accounts: run npm run setup -- --account ACCOUNT_ID.',
        'Escolha uma das suas contas da Cloudflare: rode npm run setup -- --account ACCOUNT_ID.',
      ),
    );
  return account;
}

async function main() {
  const problem = nodeVersionProblem();
  if (problem)
    throw new SetupError(
      m(
        `Node.js ${problem} is too old. Install Node.js 22.13 or newer from nodejs.org, then run npm ci and npm run setup.`,
        `O Node.js ${problem} é antigo demais. Instale o Node.js 22.13 ou mais novo em nodejs.org e rode npm ci e npm run setup.`,
      ),
    );
  if (existsSync('.env')) process.loadEnvFile('.env');
  log(
    m(
      'Lastfind setup. This installs your own private copy on your Cloudflare account. About 5 minutes; you can stop and run it again at any time.',
      'Instalação do Lastfind. Isto cria a sua cópia privada na sua conta da Cloudflare. Leva cerca de 5 minutos; você pode parar e rodar de novo quando quiser.',
    ),
  );
  log(
    m(
      'Costs, all billed to your own accounts: Cloudflare Workers/D1/R2 stay in the free allowances for normal use (Cloudflare may ask for a payment method to turn on R2); DataForSEO charges per AI answer collected (about US$ 0.0012 for ChatGPT, Gemini and Google, more for Perplexity and Claude); OpenRouter is optional. Safety limits (1,500 collections a month, 1,000 a day) can be changed later.\n',
      'Custos, todos cobrados nas suas próprias contas: Workers/D1/R2 da Cloudflare ficam nos limites gratuitos em uso normal (a Cloudflare pode pedir um meio de pagamento para ativar o R2); o DataForSEO cobra por resposta de IA coletada (cerca de US$ 0,0012 no ChatGPT, Gemini e Google, mais no Perplexity e no Claude); o OpenRouter é opcional. Os limites de segurança (1.500 coletas por mês, 1.000 por dia) podem ser mudados depois.\n',
    ),
  );

  // Check what is cheap to check first: wrong keys fail here, before anything is created.
  const credentials = await gatherCredentials({
    env: process.env,
    interactive,
    ask,
    askSecret,
    log,
    language,
  });
  if (Object.keys(credentials.typed).length) {
    saveEnv('.env', credentials.typed);
    log(
      m(
        'Saved to the private .env file in this folder, so you will not be asked again. Never share or commit it.',
        'Salvo no arquivo privado .env desta pasta, para não perguntar de novo. Nunca compartilhe nem publique esse arquivo.',
      ),
    );
  }
  if (values['check-only']) {
    log(
      m(
        '\nCredentials verified. Nothing was installed (--check-only).',
        '\nCredenciais conferidas. Nada foi instalado (--check-only).',
      ),
    );
    return;
  }

  const account = await cloudflareAccount();
  const existing = readJson('wrangler.selfhost.json', {});
  const name = await ask(
    m(
      'Name for your installation (letters, numbers, hyphens)',
      'Nome da sua instalação (letras, números, hífens)',
    ),
    values.name || existing.name || 'lastfind',
  );
  if (!validInstallationName(name))
    throw new SetupError(
      m(
        'Use 3–51 lowercase letters, numbers or hyphens for the name, for example my-lastfind.',
        'Use de 3 a 51 letras minúsculas, números ou hífens no nome, por exemplo meu-lastfind.',
      ),
    );
  const email = await ask(
    m('Your email', 'Seu e-mail'),
    values.email || existing.vars?.OWNER_EMAIL || '',
  );
  if (!validEmail(email))
    throw new SetupError(
      m(
        'Provide your email, for example --email you@example.com.',
        'Informe seu e-mail, por exemplo --email voce@exemplo.com.',
      ),
    );
  if (existing.account_id && existing.account_id !== account)
    throw new SetupError(
      m(
        'This folder is already installed on another Cloudflare account. Use a fresh copy of the project for a separate installation.',
        'Esta pasta já está instalada em outra conta da Cloudflare. Use uma cópia nova do projeto para uma instalação separada.',
      ),
    );
  if (
    existing.name &&
    existing.d1_databases?.[0]?.database_id &&
    !existing.d1_databases[0].database_id.startsWith('00000000') &&
    existing.name !== name
  )
    throw new SetupError(
      m(
        `This folder already has the installation "${existing.name}". Run setup again with that name to update it, or use a fresh copy of the project for another name.`,
        `Esta pasta já tem a instalação "${existing.name}". Rode de novo com esse nome para atualizá-la, ou use uma cópia nova do projeto para outro nome.`,
      ),
    );
  const research = !!credentials.openrouter;
  let config = {
    ...existing,
    $schema: 'node_modules/wrangler/config-schema.json',
    name,
    account_id: account,
    main: 'packages/core/worker/index.ts',
    compatibility_date: '2026-05-22',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: true,
    placement: { mode: 'smart' },
    observability: { enabled: true, head_sampling_rate: 0.1 },
    vars: {
      ...existing.vars,
      SELF_HOST_MONTHLY_LIMIT: existing.vars?.SELF_HOST_MONTHLY_LIMIT || '1500',
      GLOBAL_DAILY_RUN_LIMIT: existing.vars?.GLOBAL_DAILY_RUN_LIMIT || '1000',
      OWNER_EMAIL: email,
      ENABLE_PROVIDER_CALLBACKS: 'true',
      ...researchVars(existing.vars, research),
    },
    d1_databases: [],
    triggers: { crons: ['*/5 * * * *'] },
    ...(existing.r2_buckets ? { r2_buckets: existing.r2_buckets } : {}),
  };
  config = configureProjectStorage(config);
  // Reject unavailable R2 before creating D1 or publishing a Worker.
  assertRawStorageAvailable(config);
  const databases = JSON.parse(
    run(['d1', 'list', '--json'], {
      quiet: true,
      env: { CLOUDFLARE_ACCOUNT_ID: account },
    }),
  );
  const existingId = existing.d1_databases?.[0]?.database_id;
  let database = databases.find((d) => d.uuid === existingId);
  if (!database) {
    assertWorkerAvailable(name, account);
    if (databases.some((d) => d.name === name))
      throw new SetupError(
        m(
          `A database named ${name} already exists in this Cloudflare account and does not belong to this folder. Choose another installation name.`,
          `Já existe um banco de dados chamado ${name} nesta conta da Cloudflare e ele não pertence a esta pasta. Escolha outro nome para a instalação.`,
        ),
      );
    log(m('Creating your database…', 'Criando o seu banco de dados…'));
    run(['d1', 'create', name, '--location', 'enam', '--update-config=false'], {
      env: { CLOUDFLARE_ACCOUNT_ID: account },
    });
    database = JSON.parse(
      run(['d1', 'list', '--json'], {
        quiet: true,
        env: { CLOUDFLARE_ACCOUNT_ID: account },
      }),
    ).find((d) => d.name === name);
  }
  if (!database?.uuid)
    throw new SetupError(
      m(
        'The database creation was not confirmed. Check Cloudflare, then run npm run setup again.',
        'A criação do banco de dados não foi confirmada. Confira a Cloudflare e rode npm run setup de novo.',
      ),
    );
  config.d1_databases = [
    {
      binding: 'DB',
      database_name: database.name,
      database_id: database.uuid,
      migrations_dir: 'apps/selfhost/drizzle',
    },
  ];
  // Checkpoint identity before archive creation: retrying a failed R2 step
  // must reuse this database, never mistake it for an unrelated installation.
  writePrivateJson('wrangler.selfhost.json', config);
  config = provisionRawStorage(config);
  writePrivateJson('wrangler.selfhost.json', config);
  mkdirSync('.lastfind', { recursive: true, mode: 0o700 });
  chmodSync('.lastfind', 0o700);
  const secrets = readJson('.lastfind/secrets.json', {});
  Object.assign(secrets, {
    DATAFORSEO_LOGIN: credentials.dataforseo.login,
    DATAFORSEO_PASSWORD: credentials.dataforseo.password,
    SESSION_SECRET: secrets.SESSION_SECRET || randomBytes(32).toString('hex'),
  });
  if (research) secrets.OPENROUTER_API_KEY = credentials.openrouter.key;
  {
    const accessFile = '.lastfind/access-key.txt';
    const accessKey = existsSync(accessFile)
      ? readFileSync(accessFile, 'utf8').trim()
      : randomBytes(32).toString('base64url');
    writePrivateFile(accessFile, accessKey + '\n');
    secrets.OWNER_ACCESS_KEY_HASH = createHash('sha256')
      .update(accessKey)
      .digest('hex');
  }
  writePrivateJson('.lastfind/secrets.json', secrets);
  log(
    m(
      'Publishing your installation (building takes a minute or two)…',
      'Publicando a sua instalação (a montagem leva um ou dois minutos)…',
    ),
  );
  const deployed = runWithTerminal(process.execPath, [
    'scripts/deploy-selfhost.mjs',
  ]);
  if (deployed.status !== 0) {
    process.exitCode = deployed.status || 1;
    stop(
      m(
        'the publishing step failed (details above). Your database, access key and settings are saved.',
        'a etapa de publicação falhou (detalhes acima). Seu banco de dados, sua chave de acesso e suas configurações estão salvos.',
      ),
    );
    return;
  }
  const url = readJson('.lastfind/secrets.json', {}).APP_URL;
  log(
    m(
      `\nReady. Open ${url ? `${url}/app` : 'the address printed above'} and sign in with your owner key.\nYour owner key is saved in .lastfind/access-key.txt. Show it with: ${ownerKeyCommand}\nCopy it into your password manager, and never share it. The very first collection starts when you add your first prompt; results appear within a few minutes.\nTo see what was installed or to update later, read the installation guide (README).`,
      `\nPronto. Abra ${url ? `${url}/app` : 'o endereço mostrado acima'} e entre com a sua chave de proprietário.\nSua chave está salva em .lastfind/access-key.txt. Para mostrá-la: ${ownerKeyCommand}\nCopie-a para o seu gerenciador de senhas e nunca a compartilhe. A primeira coleta começa quando você adicionar o primeiro prompt; os resultados aparecem em poucos minutos.\nPara ver o que foi instalado ou atualizar depois, leia o guia de instalação (README).`,
    ),
  );
}

try {
  await main();
} catch (error) {
  stop(
    error instanceof SetupError
      ? error.message
      : explainFailure(error, language) ||
          (error instanceof Error ? error.message : String(error)),
  );
} finally {
  rl?.close();
}
