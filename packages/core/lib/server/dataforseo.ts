import {
  captureRawResponse,
  type RawProviderResponse,
} from '@/lib/raw-responses';
import { setting } from './env';
import { ApiError } from './http';
import type { Engine } from '@/lib/types';
import { isEngine } from '@/lib/engines';
import { providerBase } from '@/lib/provider-contract';
import { requireMonitoringStorage } from './monitoring-storage';
export type ProviderTask = {
  id: string;
  status_code: number;
  status_message: string;
  cost: number;
  data?: { tag?: string };
  result?: Record<string, unknown>[] | null;
};
const rawResponses = new WeakMap<ProviderTask, RawProviderResponse>();
export function rawProviderResponse(task: ProviderTask) {
  return rawResponses.get(task);
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public code: number,
    public ambiguous = false,
  ) {
    super(message);
  }
}
export async function provider(
  engine: Engine,
  path: string,
  payload?: unknown,
): Promise<ProviderTask[]> {
  // Paid requests can only start in an installation able to retain their data.
  if (payload) requireMonitoringStorage();
  if (!isEngine(engine)) throw new ApiError(400, 'Motor inválido.');
  const login = setting('DATAFORSEO_LOGIN'),
    password = setting('DATAFORSEO_PASSWORD');
  if (!login || !password)
    throw new ApiError(
      503,
      'A integração DataForSEO ainda não foi configurada pelo operador.',
    );
  const endpoint = `https://api.dataforseo.com/v3/${providerBase(engine)}/${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${login}:${password}`)}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(engine === 'perplexity' ? 125000 : 25000),
    });
  } catch {
    throw new ProviderError(
      'O provedor não confirmou a solicitação. Não repetimos cobranças automaticamente.',
      0,
      !!payload,
    );
  }
  if (!response.ok)
    throw new ProviderError(
      `DataForSEO HTTP ${response.status}. Verifique a conta do provedor.`,
      response.status,
      !!payload && response.status >= 500,
    );
  let data: { status_code: number; tasks: ProviderTask[] };
  let body: string;
  try {
    body = await response.text();
    data = JSON.parse(body);
  } catch {
    throw new ProviderError('Resposta inválida do provedor.', 0, !!payload);
  }
  if (data.status_code !== 20000 || !Array.isArray(data.tasks))
    throw new ProviderError(
      `DataForSEO retornou o código ${data.status_code}.`,
      data.status_code,
      !!payload,
    );
  if (
    (path === 'live' || path.startsWith('task_get/')) &&
    data.tasks.length === 1
  ) {
    const task = data.tasks[0];
    const raw = captureRawResponse(
      body,
      endpoint,
      new Date().toISOString(),
      task.id,
    );
    if (raw) rawResponses.set(task, raw);
  }
  return data.tasks;
}
