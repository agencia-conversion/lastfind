declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RAW_RESPONSES?: R2Bucket;
    PROJECT_STORES?: DurableObjectNamespace;
    PROJECT_RUNNERS?: DurableObjectNamespace;
    /** One agent per conversation (worker/agent.ts). */
    LASTFIND_AGENT?: DurableObjectNamespace<import('../worker/agent').LastfindAgent>;
    WORKER_VERSION?: WorkerVersionMetadata;
  }
}
