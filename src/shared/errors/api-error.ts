import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/** Throwable carrier for the standard `{ error: { code, message, details } }` envelope. */
export class ApiError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, details?: unknown) {
    const body: ErrorEnvelope = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
    super(body, status);
  }
}
