import { env } from 'cloudflare:workers';
export function rawResponsesBucket(): R2Bucket | undefined {
  return (env as unknown as { RAW_RESPONSES?: R2Bucket }).RAW_RESPONSES;
}
