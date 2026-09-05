import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const wranglerCLI = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

export function run(args, { input, quiet = false, env = {} } = {}) {
  const result = spawnSync(
    process.execPath,
    [wranglerCLI, ...args],
    {
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env },
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  );
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
