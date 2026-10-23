/** An error with an HTTP status and a stable code the web app translates. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string, readonly details?: unknown) {
    super(message ?? code);
  }
}

export const notFound = (what = 'not_found') => new ApiError(404, what);
export const forbidden = (code = 'forbidden') => new ApiError(403, code);
export const badRequest = (code: string, details?: unknown) => new ApiError(400, code, code, details);
export const conflict = (code: string, details?: unknown) => new ApiError(409, code, code, details);
