import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Every `/_next/static/...` file a built page can reference (the RSC assets manifest feeds each page's
// modulepreload/stylesheet links; captured HTML holds them literally) must exist among the client assets.
// A stale name ships as a 404 on every page, as `live-app-*.js` did with @vitejs/plugin-rsc 0.5.34.
const REFERENCE = /\/_next\/static\/[A-Za-z0-9._\-/]+\.(?:js|css|woff2?|png|svg|webp|jpg|ico)/g;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)],
  );
}

/** The referenced client assets that the build at `dist` does not contain, with the file that references each. */
export function missingAssetReferences(dist) {
  const client = resolve(dist, 'client');
  const sources = files(dist).filter((path) => path.endsWith('__vite_rsc_assets_manifest.js') || path.endsWith('.html'));
  const missing = [];
  for (const source of sources)
    for (const reference of new Set(readFileSync(source, 'utf8').match(REFERENCE) ?? []))
      if (!existsSync(resolve(client, `.${reference}`))) missing.push({ reference, source });
  return missing;
}

export function assertAssetReferences(dist) {
  const missing = missingAssetReferences(dist);
  if (missing.length)
    throw new Error(
      `Built pages reference client assets that were not emitted:\n${missing.map(({ reference, source }) => `  ${reference} (in ${source})`).join('\n')}`,
    );
}
