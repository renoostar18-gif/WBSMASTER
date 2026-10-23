/** Error returned by the API: a stable `code` the UI translates. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown, readonly opIndex?: number) {
    super(code);
  }
}

/** Demo build: the API runs inside the browser (see demo/server.ts). */
export const DEMO = import.meta.env.MODE === 'demo';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // written out (not via DEMO) so the bundler removes the demo from normal builds
  if (import.meta.env.MODE === 'demo') return (await import('./demo/server.js')).demoRequest<T>(method, url, body);
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'server_error', data?.details, data?.opIndex);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export interface Me {
  user: { id: string; email: string; name: string; locale: 'en' | 'ar'; theme: 'auto' | 'light' | 'dark' };
  organisations: { id: string; name: string; plan: 'free' | 'team' | 'business'; role: string }[];
}
