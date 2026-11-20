import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { env } from '../env.js';
import { db, now } from '../db.js';
import { newId, token } from './ids.js';
import type { User } from '../types.js';

/**
 * Krishbot has one user: whoever runs it on their own computer. The app listens on 127.0.0.1 only.
 * /api/auth/me hands the browser a session cookie on first contact; the host and same-origin checks below keep other sites out.
 */
const COOKIE = 'krishbot_session';
const TTL_MS = 365 * 24 * 3600 * 1000;

export type AuthVars = { Variables: { user: User } };

/** The one local user; made on first use. */
export function localUser(): User & { isNew?: boolean } {
  const r = db.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1').get() as any;
  if (r) return { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url };
  const id = newId('usr');
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(id, '', 'You', now());
  return { id, email: '', name: 'You', avatarUrl: null, isNew: true };
}

export function createSession(c: Context, userId: string) {
  const t = token();
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(t, userId, now(), now() + TTL_MS);
  setCookie(c, COOKIE, t, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: TTL_MS / 1000 });
}

export function userFromToken(t: string | undefined): User | null {
  if (!t) return null;
  const r = db
    .prepare('SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?')
    .get(t, now()) as any;
  return r ? { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url } : null;
}

export function userFromCookieHeader(cookieHeader: string | undefined): User | null {
  const m = (cookieHeader?.split(/;\s*/) ?? []).find((p) => p.startsWith(`${COOKIE}=`));
  return m ? userFromToken(decodeURIComponent(m.slice(COOKIE.length + 1))) : null;
}

export const requireUser: MiddlewareHandler<AuthVars> = async (c, next) => {
  const u = userFromToken(getCookie(c, COOKIE));
  if (!u) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', u);
  await next();
};

/** Only requests addressed to this computer are served, so a web page cannot reach the app through DNS tricks. */
export const localHostOnly: MiddlewareHandler = async (c, next) => {
  const host = (c.req.header('host') ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return c.text('Not found', 404);
  await next();
};

const originOf = (u: string) => { try { return new URL(u).origin; } catch { return null; } };
const localOrigins = (h: string | undefined) => new Set([originOf(env.appUrl), h ? `http://${h}` : null].filter((o): o is string => !!o));

/** Browsers say where a request comes from; anything from another site is refused (CSRF). */
export function isSameOriginRequest(origin: string | undefined, fetchSite: string | undefined, host?: string): boolean {
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  if (origin) return localOrigins(host).has(origin);
  return true;
}

/** Refuses cross-site requests that could change something. */
export const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isSameOriginRequest(c.req.header('origin'), c.req.header('sec-fetch-site'), c.req.header('host'))) {
    return c.json({ error: 'cross-site request refused' }, 403);
  }
  await next();
};
