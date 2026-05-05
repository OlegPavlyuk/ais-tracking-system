import type { Bbox } from '@/lib/protocol';
import { bboxToQueryString } from '@/lib/coverageBbox';
import type { SnapshotRow, VesselDetailRow } from '@/store/types';

export class ApiError extends Error {
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

export async function fetchSnapshot(
  bbox: Bbox,
  signal: AbortSignal,
): Promise<{ vessels: SnapshotRow[] }> {
  const url = `/api/vessels?bbox=${encodeURIComponent(bboxToQueryString(bbox))}`;
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
      // ignore parse failure
    }
    const code = body.error?.code ?? `HTTP_${res.status}`;
    const message = body.error?.message ?? res.statusText ?? 'request failed';
    throw new ApiError(code, message, body.error?.details);
  }
  return (await res.json()) as { vessels: SnapshotRow[] };
}

export async function fetchVesselDetail(
  vesselId: string,
  signal: AbortSignal,
): Promise<VesselDetailRow> {
  const url = `/api/vessels/${encodeURIComponent(vesselId)}`;
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
      // ignore parse failure
    }
    const code = body.error?.code ?? `HTTP_${res.status}`;
    const message = body.error?.message ?? res.statusText ?? 'request failed';
    throw new ApiError(code, message, body.error?.details);
  }
  return (await res.json()) as VesselDetailRow;
}
