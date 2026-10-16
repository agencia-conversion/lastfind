import { run } from './cloudflare-cli.mjs';

function listedBuckets(output) {
  // Wrangler's documented command has no JSON flag. Match its name field only,
  // not arbitrary warnings or substrings in a different bucket's name.
  return new Set(
    [...output.matchAll(/^name:\s+(\S+)\s*$/gm)].map((match) => match[1]),
  );
}

// `r2 bucket list` returns a single page (20 buckets by default) and cannot
// be trusted to say a bucket is missing on an account with many buckets. Ask
// for the bucket by name instead: true (exists), false (Cloudflare says it
// does not exist) or null (the answer could not be read).
function bucketExists(bucket, jurisdiction, { runCommand, environment }) {
  let output;
  try {
    output = runCommand(
      ['r2', 'bucket', 'info', bucket, '--json', ...jurisdiction],
      {
        quiet: true,
        env: environment,
      },
    );
  } catch (error) {
    return /\b10006\b|bucket does not exist/i.test(error.output || '')
      ? false
      : null;
  }
  try {
    return JSON.parse(output.slice(output.indexOf('{'))).name === bucket;
  } catch {
    return null;
  }
}
const wait = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export function rawBucketName(config) {
  const database = config.d1_databases?.find(
    (binding) => binding.binding === 'DB',
  )?.database_id;
  if (!database || database.startsWith('00000000'))
    throw new Error('Create the installation database before its archive.');
  return `${config.name.slice(0, 50)}-raw-${database.slice(0, 8)}`;
}

// R2 must already be activated by the account holder. This function never
// activates billing, changes public access or removes an existing binding.
export function assertRawStorageAvailable(config, { runCommand = run } = {}) {
  if (!config.account_id)
    throw new Error(
      'Select a Cloudflare account before configuring raw storage.',
    );
  const bindings = config.r2_buckets ?? [];
  const archives = bindings.filter(
    (binding) => binding.binding === 'RAW_RESPONSES',
  );
  if (archives.length > 1)
    throw new Error(
      'RAW_RESPONSES is bound more than once. Check wrangler.selfhost.json.',
    );
  const archive = archives[0];
  const environment = { CLOUDFLARE_ACCOUNT_ID: config.account_id };
  const jurisdiction = archive?.jurisdiction
    ? ['--jurisdiction', archive.jurisdiction]
    : [];
  const list = () =>
    listedBuckets(
      runCommand(['r2', 'bucket', 'list', ...jurisdiction], {
        quiet: true,
        env: environment,
      }),
    );
  let buckets;
  try {
    buckets = list();
  } catch (error) {
    if (/\b10042\b/.test(error.output || ''))
      throw new Error(
        'R2 is required to preserve original provider responses. Activate R2 in the Cloudflare dashboard for this account (dash.cloudflare.com → R2 Object Storage → Purchase R2; the free allowance covers normal use but Cloudflare may ask for a payment method), then re-run npm run setup. Setup never activates billing or changes your subscription. Existing resources and archive bindings were preserved.',
      );
    if (archive)
      throw new Error(
        'The configured raw archive could not be verified. Existing archive bindings were preserved; check Cloudflare access before deploying.',
      );
    throw error;
  }
  if (archive && !buckets.has(archive.bucket_name)) {
    const found = bucketExists(archive.bucket_name, jurisdiction, {
      runCommand,
      environment,
    });
    if (found === null)
      throw new Error(
        'The configured raw archive could not be verified. Existing archive bindings were preserved; check Cloudflare access before deploying.',
      );
    if (!found)
      throw new Error(
        'The configured RAW_RESPONSES bucket was not found in this account. Refusing to replace or recreate an archive with existing records.',
      );
  }
  return { buckets, archive, bindings, environment, list, jurisdiction };
}

export function provisionRawStorage(
  config,
  { runCommand = run, sleep = wait } = {},
) {
  const { buckets, archive, bindings, environment } = assertRawStorageAvailable(
    config,
    { runCommand },
  );
  if (archive) return config;
  const bucket = rawBucketName(config);
  // The bucket may already exist without being in the config (an interrupted
  // earlier run, or one beyond the first page of `bucket list`): adopt it.
  if (!buckets.has(bucket)) {
    try {
      runCommand(
        [
          'r2',
          'bucket',
          'create',
          bucket,
          '--location',
          'enam',
          '--update-config=false',
        ],
        { env: environment },
      );
    } catch (error) {
      if (!/\b10004\b|already exists/i.test(error.output || '')) throw error;
    }
    // A successful create (or "already exists") is Cloudflare's own answer;
    // the lookup only guards against a bucket that is still being registered.
    let found = null;
    for (let attempt = 0; attempt < 5 && found !== true; attempt++) {
      if (attempt) sleep(2000 * attempt);
      found = bucketExists(bucket, [], { runCommand, environment });
      if (found === null) break;
    }
    if (found === false)
      throw new Error(
        'Raw archive creation was not confirmed. Re-run setup after checking Cloudflare; the database and access key are preserved.',
      );
  }
  return {
    ...config,
    r2_buckets: [
      ...bindings,
      { binding: 'RAW_RESPONSES', bucket_name: bucket },
    ],
  };
}
