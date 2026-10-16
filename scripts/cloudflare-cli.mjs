import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const wranglerCLI = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);

export function run(args, { input, quiet = false, env = {} } = {}) {
  const result = spawnSync(process.execPath, [wranglerCLI, ...args], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env },
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!quiet) process.stdout.write(result.stdout || '');
  if (result.status !== 0) {
    // Wrangler redacts values during secret upload; do not print input.
    if (!quiet) process.stderr.write(result.stderr || '');
    const error = new Error(
      `Cloudflare command failed: ${args[0]} ${args[1] || ''}`,
    );
    error.output = `${result.stderr || ''} ${result.stdout || ''}`;
    throw error;
  }
  return result.stdout;
}
export function readJson(file, fallback = null) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}
export function currentAccounts() {
  const raw = run(['whoami', '--json'], { quiet: true });
  return JSON.parse(raw);
}
export function deploymentURL(output) {
  const urls = output.match(
    /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/g,
  );
  if (!urls?.length)
    throw new Error(
      'Cloudflare did not return a workers.dev URL. Check the deployment output.',
    );
  return urls.at(-1);
}

export function assertWorkerAvailable(name, account) {
  try {
    run(['deployments', 'list', '--name', name, '--json'], {
      quiet: true,
      env: { CLOUDFLARE_ACCOUNT_ID: account },
    });
  } catch (error) {
    if (/code: 10007/.test(error.output || '')) return;
    throw error;
  }
  throw new Error(
    `Worker ${name} already exists. Use a fresh name to avoid overwriting another service.`,
  );
}

export async function waitForHealth(url) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok && (await response.json()).ok) return;
    } catch {
      /* New workers.dev subdomains can need DNS/TLS propagation. */
    }
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    `Published at ${url}, but DNS/TLS or application health is not ready. Recheck /api/health before using the installation.`,
  );
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

// A new deployment answers /api/health before every page file is served from
// every Cloudflare location. Opening the address in that gap leaves the app on
// "Loading…", so "ready" also means the page files of this build are reachable.
export async function waitForAssets(
  url,
  directory,
  {
    request = fetch,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) {
  const files = filesUnder(join(directory, '_next', 'static'))
    .map((file) => `/${relative(directory, file).split(sep).join('/')}`)
    .concat(
      existsSync(join(directory, 'vinext-client-entry-manifest.json'))
        ? ['/vinext-client-entry-manifest.json']
        : [],
    );
  let missing = files;
  for (
    let attempt = 0;
    attempt < 24 && (attempt === 0 || missing.length);
    attempt++
  ) {
    if (attempt) await sleep(5000);
    // The page itself must point at files that exist: right after a rebuild an
    // edge location can still serve the previous page, whose files are gone.
    const referenced = await request(`${url}/app`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
      .then((response) => response.text())
      .then((html) =>
        [...html.matchAll(/\/_next\/static\/[^"'\s)<>]+/g)].map((m) => m[0]),
      )
      .catch(() => []);
    const wanted = [...new Set([...files, ...referenced])];
    const answers = await Promise.all(
      wanted.map((path) =>
        request(`${url}${path}`, {
          method: 'HEAD',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        }).then(
          (response) => response.ok,
          () => false,
        ),
      ),
    );
    missing = wanted.filter((_, index) => !answers[index]);
  }
  if (missing.length)
    throw new Error(
      `Published at ${url}, but ${missing.length} page file(s) are not available yet. Wait a minute and open the address again; if the page stays on "Loading", run npm run setup again.`,
    );
}
