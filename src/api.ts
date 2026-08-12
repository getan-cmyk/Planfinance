export type ApiResult<T> = { success: boolean; data: T; error?: { code: string; message: string } };
const base = import.meta.env.VITE_API_BASE_URL ?? '';
const tokenKey = 'finance.session';
export const getToken = () => localStorage.getItem(tokenKey);
export const setToken = (token: string) => localStorage.setItem(tokenKey, token);
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...options.headers } }); const payload = await response.json() as ApiResult<T>; if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? 'ไม่สามารถเชื่อมต่อระบบได้'); return payload.data; }
