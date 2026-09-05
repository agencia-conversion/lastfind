import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readJson } from './cloudflare-cli.mjs';
import { ownerStorageClient } from './project-storage-client.mjs';
import { inspectBackupFile, saveBackup } from './project-storage-backup.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    url: { type: 'string' },
    'key-file': { type: 'string', default: '.lastfind/access-key.txt' },
    batches: { type: 'string', default: '1' },
    output: { type: 'string' },
    input: { type: 'string' },
    generation: { type: 'string' },
    help: { type: 'boolean' },
  },
});
const command = positionals[0] || 'status';
if (values.help) {
  console.log(`npm run storage -- <list|status|export|restore|restore-commit> [--project ID] [--batches 1-100]

Uses the private personal-installation access key. Reads APP_URL from
.lastfind/secrets.json; --url and --key-file can select another installation.

list      List your projects and their IDs.
status    Inspect the project SQLite database and publication status.
export    Save verified NDJSON using --output FILE (never overwrites files).
restore   Validate and upload --input FILE into a new isolated generation.
restore-commit  Verify and switch a prepared --generation ID; --batches 1-100.

Export includes normalized records and references to private R2 archives, not
copies of the raw R2 objects. Back up those objects separately. Restore never
starts collection or uploads a different project's backup. The commit is explicit.

Setup configures the shared namespace. Every project gets its own private SQLite
database automatically. Restore uploads never switch the active generation.
`);
  process.exit(0);
}
if (
  positionals.length > 1 ||
  !['list', 'status', 'export', 'restore', 'restore-commit'].includes(command)
)
  throw new Error('Unknown storage command. Run npm run storage -- --help.');
if (command !== 'list' && !values.project)
  throw new Error(
    'Provide --project ID. Use npm run storage -- list to see project IDs.',
  );
const batches = Number(values.batches);
if (
  !Number.isInteger(batches) ||
  batches < 1 ||
  batches > 100 ||
  (command !== 'restore-commit' && batches !== 1)
)
  throw new Error('Use --batches 1–100 only with restore-commit.');
if (command === 'export' && !values.output)
  throw new Error('Provide --output FILE for the private project backup.');
if (command === 'restore' && !values.input)
  throw new Error('Provide --input FILE for the private project backup.');
if (command === 'restore-commit' && !values.generation)
  throw new Error('Provide --generation ID returned by restore.');
const restoreManifest =
  command === 'restore'
    ? await inspectBackupFile(values.input, { project: values.project })
    : null;
const config = readJson('wrangler.selfhost.json', {});
if (!values.url && config.vars?.AUTH_MODE !== 'owner')
  throw new Error(
    'This CLI is for a personal owner installation. Cloud operators must use their authenticated operations interface.',
  );
const secrets = readJson('.lastfind/secrets.json', {});
const url = values.url || secrets.APP_URL;
const key = readFileSync(values['key-file'], 'utf8').trim();
const client = await ownerStorageClient({ url, key });
try {
  if (command === 'list')
    console.log(JSON.stringify(await client.projects(), null, 2));
  else if (command === 'status')
    console.log(JSON.stringify(await client.status(values.project), null, 2));
  else if (command === 'export') {
    const manifest = await saveBackup(
      await client.download(values.project),
      values.output,
      { project: values.project },
    );
    console.log(
      JSON.stringify(
        {
          saved: values.output,
          projectId: manifest.projectId,
          counts: manifest.counts,
          digests: manifest.digests,
        },
        null,
        2,
      ),
    );
  } else if (command === 'restore') {
    const candidate = await client.restoreBegin(
      values.project,
      restoreManifest,
    );
    if (typeof candidate.generation !== 'string' || !candidate.generation)
      throw new Error('The server did not return a restore generation.');
    console.log(
      JSON.stringify(
        { generation: candidate.generation, status: 'uploading' },
        null,
        2,
      ),
    );
    let chunks = 0;
    const uploaded = await inspectBackupFile(values.input, {
      project: values.project,
      onChunk: async (entity, rows) => {
        await client.restoreChunk(
          values.project,
          candidate.generation,
          entity,
          rows,
        );
        chunks++;
        console.log(
          JSON.stringify({
            generation: candidate.generation,
            chunks,
            entity,
            rows: rows.length,
          }),
        );
      },
    });
    if (JSON.stringify(uploaded) !== JSON.stringify(restoreManifest))
      throw new Error(
        'The backup changed during restore. The current project store was not switched.',
      );
    console.log(
      JSON.stringify(
        {
          generation: candidate.generation,
          status: 'ready-for-verification',
          next: `npm run storage -- restore-commit --project ${values.project} --generation ${candidate.generation} --batches 100`,
        },
        null,
        2,
      ),
    );
  } else
    for (let batch = 0; batch < batches; batch++) {
      const result = await client.restoreCommit(
        values.project,
        values.generation,
      );
      console.log(
        JSON.stringify({ command, batch: batch + 1, ...result }, null, 2),
      );
      if (result.done === true) break;
    }
} finally {
  // Failure to close the ephemeral owner session must not hide the operation's
  // outcome. The cookie is never written to disk or printed.
  try {
    await client.close();
  } catch {
    console.warn(
      'The temporary storage session could not be closed; it expires automatically.',
    );
  }
}
