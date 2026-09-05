import { run } from './cloudflare-cli.mjs';

function listedBuckets(output) {
  // Wrangler's documented command has no JSON flag. Match its name field only,
  // not arbitrary warnings or substrings in a different bucket's name.
  return new Set(
    [...output.matchAll(/^name:\s+(\S+)\s*$/gm)].map((match) => match[1]),
  );
}
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
        'R2 is required to preserve original provider responses. Activate R2 in the Cloudflare dashboard for this account, then re-run npm run setup. Setup never activates billing or changes your subscription. Existing resources and archive bindings were preserved.',
      );
    if (archive)
      throw new Error(
        'The configured raw archive could not be verified. Existing archive bindings were preserved; check Cloudflare access before deploying.',
      );
    throw error;
  }
  if (archive) {
    if (!buckets.has(archive.bucket_name))
      throw new Error(
        'The configured RAW_RESPONSES bucket was not found in this account. Refusing to replace or recreate an archive with existing records.',
      );
  }
  return { buckets, archive, bindings, environment, list };
}

export function provisionRawStorage(config, { runCommand = run } = {}) {
  const { buckets, archive, bindings, environment, list } =
    assertRawStorageAvailable(config, { runCommand });
  if (archive) return config;
  const bucket = rawBucketName(config);
  if (!buckets.has(bucket)) {
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
    if (!list().has(bucket))
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
