import { getCookie, setCookie } from 'hono/cookie';
import { env } from '../env.js';
import { db, now } from '../db.js';
import { newId, token } from './ids.js';
/**
 * Krishbot has one user: whoever runs it on their own computer. The app listens on 127.0.0.1 only.
 * /api/auth/me hands the browser a session cookie on first contact; the host and same-origin checks below keep other sites out.
 */
const COOKIE = 'krishbot_session';
const TTL_MS = 365 * 24 * 3600 * 1000;
/** The one local user; made on first use. */
export function localUser() {
    const r = db.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1').get();
    if (r)
        return { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url };
    const id = newId('usr');
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(id, '', 'You', now());
    return { id, email: '', name: 'You', avatarUrl: null, isNew: true };
}
export function createSession(c, userId) {
    const t = token();
    db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(t, userId, now(), now() + TTL_MS);
    setCookie(c, COOKIE, t, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: TTL_MS / 1000 });
}
export function userFromToken(t) {
    if (!t)
        return null;
    const r = db
        .prepare('SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?')
        .get(t, now());
    return r ? { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url } : null;
}
export function userFromCookieHeader(cookieHeader) {
    const m = (cookieHeader?.split(/;\s*/) ?? []).find((p) => p.startsWith(`${COOKIE}=`));
    return m ? userFromToken(decodeURIComponent(m.slice(COOKIE.length + 1))) : null;
}
export const requireUser = async (c, next) => {
    const u = userFromToken(getCookie(c, COOKIE));
    if (!u)
        return c.json({ error: 'unauthenticated' }, 401);
    c.set('user', u);
    await next();
};
/** Only requests addressed to this computer are served, so a web page cannot reach the app through DNS tricks. */
export const localHostOnly = async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')
        return c.text('Not found', 404);
    await next();
};
const originOf = (u) => { try {
    return new URL(u).origin;
}
catch {
    return null;
} };
const localOrigins = (h) => new Set([originOf(env.appUrl), h ? `http://${h}` : null].filter((o) => !!o));
/** Browsers say where a request comes from; anything from another site is refused (CSRF). */
export function isSameOriginRequest(origin, fetchSite, host) {
    if (fetchSite)
        return fetchSite === 'same-origin' || fetchSite === 'none';
    if (origin)
        return localOrigins(host).has(origin);
    return true;
}
/** Refuses cross-site requests that could change something. */
export const sameOriginWrites = async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isSameOriginRequest(c.req.header('origin'), c.req.header('sec-fetch-site'), c.req.header('host'))) {
        return c.json({ error: 'cross-site request refused' }, 403);
    }
    await next();
};
//# sourceMappingURL=auth.js.map