import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { appendCanonicalSale } from '../src/lib/sale-persistence.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable ${name}`);
  return value;
}

export function cloudDb() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(payload);
}

export function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export function sanitizeUser(user) {
  const { password: _password, passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export function sanitizeState(state) {
  return { ...state, users: (state.users || []).map(sanitizeUser) };
}

export async function readState(db = cloudDb()) {
  const { data, error } = await db.from('app_state').select('state,revision,updated_at').eq('id', 1).single();
  if (error) throw error;
  return { state: data.state, revision: Number(data.revision), updatedAt: data.updated_at };
}

export function publicPayload(payload) {
  return { ...payload, state: sanitizeState(payload.state) };
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, expected] = stored.split('$');
  const actual = scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await db.from('auth_sessions').insert({ token_hash: tokenHash(token), user_id: userId, expires_at: expiresAt });
  if (error) throw error;
  return token;
}

export async function authenticate(req, db = cloudDb()) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const hash = tokenHash(token);
  const { data: session } = await db.from('auth_sessions').select('user_id,expires_at').eq('token_hash', hash).maybeSingle();
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    await db.from('auth_sessions').delete().eq('token_hash', hash);
    return null;
  }
  const payload = await readState(db);
  const user = payload.state.users.find((item) => item.id === session.user_id && item.active);
  if (!user) {
    await db.from('auth_sessions').delete().eq('token_hash', hash);
    return null;
  }
  await db.from('auth_sessions').update({ expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() }).eq('token_hash', hash);
  return { db, hash, token, user, payload };
}

export function prepareUsers(currentUsers, nextUsers) {
  const current = new Map(currentUsers.map((user) => [user.id, user]));
  return nextUsers.map((user) => {
    const previous = current.get(user.id);
    const passwordHash = user.password
      ? hashPassword(user.password)
      : user.passwordHash || previous?.passwordHash || (previous?.password ? hashPassword(previous.password) : null);
    if (!passwordHash) throw new Error(`Clave requerida para ${user.username || 'nuevo usuario'}`);
    const next = { ...user, passwordHash };
    delete next.password;
    return next;
  });
}

export function restrictCashierState(current, incoming, actor) {
  const currentSessions = new Map(current.sessions.map((session) => [session.id, session]));
  const sessions = incoming.sessions.map((session) => {
    const saved = currentSessions.get(session.id);
    if (saved?.closedAt && !session.closedAt) return structuredClone(saved);
    return structuredClone(session);
  });
  for (const session of current.sessions) {
    if (!sessions.some((item) => item.id === session.id)) sessions.push(structuredClone(session));
  }
  let next = {
    ...incoming,
    settings: current.settings,
    users: current.users,
    stores: current.stores,
    products: current.products,
    events: current.events,
    sessions,
    sales: structuredClone(current.sales),
  };
  const savedIds = new Set(current.sales.map((sale) => sale.id));
  const additions = incoming.sales
    .filter((sale) => !savedIds.has(sale.id))
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
  for (const draft of additions) next = appendCanonicalSale(next, draft, actor).state;
  return next;
}

export function validState(state) {
  return state && typeof state === 'object' && state.settings && typeof state.settings === 'object'
    && Array.isArray(state.users) && Array.isArray(state.stores) && state.stores.length > 0
    && Array.isArray(state.products) && Array.isArray(state.sessions)
    && Array.isArray(state.sales) && Array.isArray(state.events);
}
