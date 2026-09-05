declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RAW_RESPONSES?: R2Bucket;
    PROJECT_STORES?: DurableObjectNamespace;
  }
}
