import { env } from 'cloudflare:workers';
import { ApiError } from './http';

export function monitoringStorageStatus() {
  const rawArchive = Boolean(env.RAW_RESPONSES);
  const projectStorage = Boolean(env.PROJECT_STORES);
  return { rawArchive, projectStorage, ready: rawArchive && projectStorage };
}

export function requireMonitoringStorage() {
  if (!monitoringStorageStatus().ready)
    throw new ApiError(503, 'Monitoring is temporarily unavailable.');
}
