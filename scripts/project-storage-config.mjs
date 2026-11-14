export const PROJECT_STORE_BINDING = 'PROJECT_STORES';
export const PROJECT_STORE_CLASS = 'ProjectStore';

/** Add the local SQLite namespaces (project storage, the agent) without changing existing namespace identities. */
export function configureProjectStorage(config) {
  const bindings = config.durable_objects?.bindings ?? [];
  const matches = bindings.filter(
    (binding) => binding.name === PROJECT_STORE_BINDING,
  );
  if (matches.length > 1)
    throw new Error(
      'PROJECT_STORES is bound more than once. Check wrangler.selfhost.json.',
    );
  if (
    matches.some(
      (binding) =>
        binding.class_name !== PROJECT_STORE_CLASS || binding.script_name,
    )
  )
    throw new Error(
      'PROJECT_STORES already points to another class or Worker. Refusing to replace project storage.',
    );

  const configured = {
    ...config,
    durable_objects: {
      ...config.durable_objects,
      bindings: matches.length
        ? [...bindings]
        : [
            ...bindings,
            { name: PROJECT_STORE_BINDING, class_name: PROJECT_STORE_CLASS },
          ],
    },
  };
  if (config.migrations?.length)
    throw new Error(
      'This installation uses Cloudflare migration declarations. Review its namespace identity before configuring the declarative SQLite export.',
    );
  const current = config.exports?.[PROJECT_STORE_CLASS];
  if (
    current &&
    (current.type !== 'durable-object' || current.storage !== 'sqlite')
  )
    throw new Error(
      'ProjectStore must use SQLite storage. Refusing to replace the existing export.',
    );
  configured.exports = {
    ...config.exports,
    [PROJECT_STORE_CLASS]: current ?? {
      type: 'durable-object',
      storage: 'sqlite',
    },
  };
  delete configured.migrations;
  return configureAgent(configured);
}

export const AGENT_BINDING = 'LASTFIND_AGENT';
export const AGENT_CLASS = 'LastfindAgent';

/** The agent's namespace (one SQLite object per conversation), added once and never repointed. */
function configureAgent(config) {
  const bindings = config.durable_objects.bindings;
  const matches = bindings.filter((binding) => binding.name === AGENT_BINDING);
  if (matches.length > 1 || matches.some((binding) => binding.class_name !== AGENT_CLASS || binding.script_name))
    throw new Error('LASTFIND_AGENT already points to another class or Worker. Refusing to replace it.');
  const current = config.exports?.[AGENT_CLASS];
  if (current && (current.type !== 'durable-object' || current.storage !== 'sqlite'))
    throw new Error('LastfindAgent must use SQLite storage. Refusing to replace the existing export.');
  return {
    ...config,
    durable_objects: { ...config.durable_objects, bindings: matches.length ? bindings : [...bindings, { name: AGENT_BINDING, class_name: AGENT_CLASS }] },
    exports: { ...config.exports, [AGENT_CLASS]: current ?? { type: 'durable-object', storage: 'sqlite' } },
  };
}
