import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role } from './config.js';

export const SESSION_COOKIE = 'ops_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export interface SessionPayload {
  username: string;
  role: Role;
  exp: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(payload: { username: string; role: Role }, secret: string, now = Date.now()): string {
  const body: SessionPayload = { username: payload.username, role: payload.role, exp: now + SESSION_TTL_MS };
  const encoded = b64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(encoded, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.username !== 'string' || (payload.role !== 'owner' && payload.role !== 'operator')) return null;
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE}=`)) {
      return trimmed.slice(SESSION_COOKIE.length + 1);
    }
  }
  return null;
}

function secureFlag(): string {
  // OPS_PUBLIC_BASE_URL over https => Secure; local http dev => no Secure.
  return process.env.OPS_PUBLIC_BASE_URL?.startsWith('https://') ? '; Secure' : '';
}

export function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureFlag()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag()}`;
}
