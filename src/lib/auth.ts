export type TelegramUser = { id: number; first_name?: string; username?: string };
export async function verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds: number): Promise<TelegramUser> {
  const params = new URLSearchParams(initData); const hash = params.get('hash'); const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) throw new Error('Invalid or expired Telegram authentication');
  params.delete('hash'); const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const secret = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const key = await crypto.subtle.sign('HMAC', secret, enc.encode(botToken));
  const signingKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, enc.encode(dataCheckString)));
  const expected = [...signature].map(x => x.toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqual(hash, expected)) throw new Error('Invalid Telegram signature');
  const rawUser = params.get('user'); if (!rawUser) throw new Error('Telegram user is missing');
  return JSON.parse(rawUser) as TelegramUser;
}
function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }
