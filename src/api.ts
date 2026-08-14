export type ApiResult<T> = { success: boolean; data: T; error?: { code: string; message: string } };
const base = import.meta.env.VITE_API_BASE_URL ?? 'https://finance-telegram-mini-app.getananan.workers.dev';
const tokenKey = 'finance.session';
export const getToken = () => localStorage.getItem(tokenKey);
export const setToken = (token: string) => localStorage.setItem(tokenKey, token);
export const clearToken = () => localStorage.removeItem(tokenKey);
export class ApiError extends Error { constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); this.name = 'ApiError'; } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...options.headers } }); const payload = await response.json().catch(() => ({ success:false } as ApiResult<T>)); if (!response.ok || !payload.success) throw new ApiError(payload.error?.message ?? 'ไม่สามารถเชื่อมต่อระบบได้', response.status, payload.error?.code); return payload.data; }
