import type { SnapshotRow, VesselDetailRow } from '@/store/types';

export interface ApiErrorData {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error implements ApiErrorData {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

async function requestJson<T>(url: string, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    throw new ApiError('NETWORK', (err as Error).message);
  }
  if (!res.ok) {
    let body: ErrorEnvelope = {};
    try {
      body = (await res.json()) as ErrorEnvelope;
    } catch {
      // Non-2xx responses may be empty, HTML, plain text, or malformed JSON.
      // We still want to throw a useful ApiError based on HTTP status metadata.
    }
    const code = body.error?.code ?? `HTTP_${res.status}`;
    const message = body.error?.message ?? res.statusText ?? 'request failed';
    throw new ApiError(code, message, body.error?.details);
  }
  return (await res.json()) as T;
}

export async function fetchVessels(signal: AbortSignal): Promise<{ vessels: SnapshotRow[] }> {
  return requestJson<{ vessels: SnapshotRow[] }>('/api/vessels', signal);
}

export async function fetchVesselDetail(
  vesselId: string,
  signal: AbortSignal,
): Promise<VesselDetailRow> {
  return requestJson<VesselDetailRow>(
    `/api/vessels/${encodeURIComponent(vesselId)}`,
    signal,
  );
}
