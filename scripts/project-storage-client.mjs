/** Personal-owner CLI client. Credentials never appear in process arguments. */
export function installationOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Configure a valid installation URL before using storage commands.',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error(
      'Storage commands require an HTTPS origin (HTTP is allowed only for localhost).',
    );
  return url.origin;
}

export async function ownerStorageClient({ url, key, fetchRequest = fetch }) {
  const origin = installationOrigin(url);
  if (typeof key !== 'string' || key.trim().length < 32)
    throw new Error('The installation access key is missing or invalid.');
  let cookie;
  const headers = () => ({
    'Content-Type': 'application/json',
    Origin: origin,
    ...(cookie ? { Cookie: cookie } : {}),
  });
  async function request(path, method = 'GET', body) {
    const response = await fetchRequest(`${origin}${path}`, {
      method,
      headers: headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        `Storage request failed (${response.status}); no JSON response was received.`,
      );
    }
    if (!response.ok)
      throw new Error(
        typeof result?.error === 'string'
          ? result.error.slice(0, 500)
          : `Storage request failed (${response.status}).`,
      );
    return { result, response };
  }
  const { response } = await request('/api/auth/login', 'POST', {
    key: key.trim(),
  });
  cookie = response.headers
    .getSetCookie?.()
    .find((value) => value.startsWith('__Host-lastfind-session='))
    ?.split(';')[0];
  if (!cookie) {
    const header = response.headers.get('set-cookie');
    if (header?.startsWith('__Host-lastfind-session='))
      cookie = header.split(';')[0];
  }
  if (!cookie)
    throw new Error('Owner sign-in did not establish an installation session.');
  return {
    async projects() {
      const { result } = await request('/api/workspace');
      return (result.projects ?? []).map(({ id, name, domain }) => ({
        id,
        name,
        domain,
      }));
    },
    async status(project) {
      if (!project || typeof project !== 'string')
        throw new Error('Choose a project ID.');
      return (
        await request(`/api/projects/${encodeURIComponent(project)}/storage`)
      ).result;
    },
    async download(project) {
      if (!project || typeof project !== 'string')
        throw new Error('Choose a project ID.');
      const response = await fetchRequest(
        `${origin}/api/projects/${encodeURIComponent(project)}/storage?format=export`,
        {
          headers: headers(),
          redirect: 'error',
          signal: AbortSignal.timeout(300000),
        },
      );
      if (!response.ok || !response.body)
        throw new Error(`Project export failed (${response.status}).`);
      return response.body;
    },
    async restoreBegin(project, manifest) {
      if (!project || typeof project !== 'string')
        throw new Error('Choose a project ID.');
      return (
        await request(
          `/api/projects/${encodeURIComponent(project)}/storage`,
          'POST',
          { action: 'restore-begin', manifest },
        )
      ).result;
    },
    async restoreChunk(project, generation, entity, rows) {
      if (!project || typeof project !== 'string')
        throw new Error('Choose a project ID.');
      return (
        await request(
          `/api/projects/${encodeURIComponent(project)}/storage`,
          'POST',
          { action: 'restore-chunk', generation, entity, rows },
        )
      ).result;
    },
    async restoreCommit(project, generation) {
      if (!project || typeof project !== 'string')
        throw new Error('Choose a project ID.');
      return (
        await request(
          `/api/projects/${encodeURIComponent(project)}/storage`,
          'POST',
          { action: 'restore-commit', generation },
        )
      ).result;
    },
    async close() {
      if (cookie) {
        await request('/api/auth/logout', 'POST', {});
        cookie = undefined;
      }
    },
  };
}
