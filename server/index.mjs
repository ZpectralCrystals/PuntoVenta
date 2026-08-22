import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { INITIAL_STATE } from '../src/lib/initial-state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DATA_DIR = join(ROOT, 'data');
const DB_PATH = process.env.POS_DB_PATH ? resolve(process.env.POS_DB_PATH) : join(DATA_DIR, 'pos.sqlite');
const BACKUP_DIR = process.env.POS_BACKUP_DIR ? resolve(process.env.POS_BACKUP_DIR) : join(dirname(DB_PATH), 'backups');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 5 * 1024 * 1024;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const BACKUP_INTERVAL = 10 * 60 * 1000;
const BACKUP_LIMIT = 144;

const DIST_READY = existsSync(DIST);
if (!DIST_READY) console.warn('Falta dist/. API disponible; ejecuta npm run build para interfaz.');

mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(BACKUP_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 10000;
  PRAGMA wal_autocheckpoint = 200;
  PRAGMA foreign_keys = ON;
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);
db.prepare('INSERT OR IGNORE INTO app_state (id, json, revision, updated_at) VALUES (1, ?, 1, ?)')
  .run(JSON.stringify(INITIAL_STATE), new Date().toISOString());

const integrity = db.prepare('PRAGMA quick_check').get();
if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('SQLite no superó verificación de integridad');

const readState = db.prepare('SELECT json, revision, updated_at FROM app_state WHERE id = 1');
const writeState = db.prepare('UPDATE app_state SET json = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ? RETURNING revision, updated_at');
const readSession = db.prepare('SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ?');
const saveSession = db.prepare('INSERT OR REPLACE INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
const refreshSession = db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?');
const deleteSession = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
const loginFailures = new Map();
let lastBackupRevision = 0;
let backupRunning = false;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sanitizeUser(user) {
  const { password: _password, ...safe } = user;
  return safe;
}

function sanitizeState(state) {
  return { ...state, users: state.users.map(sanitizeUser) };
}

function rawStatePayload() {
  const row = readState.get();
  return { state: JSON.parse(row.json), revision: Number(row.revision), updatedAt: row.updated_at };
}

function statePayload() {
  const payload = rawStatePayload();
  return { ...payload, state: sanitizeState(payload.state) };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Payload demasiado grande');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('JSON inválido');
    error.status = 400;
    throw error;
  }
}

function validState(state) {
  return state && typeof state === 'object'
    && state.settings && typeof state.settings === 'object'
    && Array.isArray(state.users) && Array.isArray(state.stores) && state.stores.length > 0
    && Array.isArray(state.products) && Array.isArray(state.sessions)
    && Array.isArray(state.sales) && Array.isArray(state.events);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientIp(req) {
  return req.socket.remoteAddress || 'desconocido';
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function allowLogin(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = loginFailures.get(ip);
  if (!entry || now - entry.startedAt > 10 * 60 * 1000) return true;
  return entry.count < 10;
}

function registerLoginFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = loginFailures.get(ip);
  loginFailures.set(ip, !current || now - current.startedAt > 10 * 60 * 1000
    ? { count: 1, startedAt: now }
    : { ...current, count: current.count + 1 });
}

function authenticatedUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const hash = token ? tokenHash(token) : '';
  const session = hash ? readSession.get(hash) : null;
  if (!token || !session || Number(session.expires_at) < Date.now()) {
    if (hash) deleteSession.run(hash);
    return null;
  }
  const user = rawStatePayload().state.users.find((item) => item.id === session.user_id && item.active);
  if (!user) {
    deleteSession.run(hash);
    return null;
  }
  refreshSession.run(Date.now() + SESSION_TTL, hash);
  return { token, hash, user };
}

function preservePasswords(currentUsers, nextUsers) {
  const current = new Map(currentUsers.map((user) => [user.id, user]));
  return nextUsers.map((user) => {
    const password = user.password || current.get(user.id)?.password;
    if (!password) throw Object.assign(new Error(`Clave requerida para ${user.username || 'nuevo usuario'}`), { status: 400 });
    return { ...user, password };
  });
}

function restrictCashierState(current, incoming) {
  return {
    ...incoming,
    settings: current.settings,
    users: current.users,
    stores: current.stores,
    products: current.products,
    events: current.events,
  };
}

function staticFile(pathname) {
  if (!DIST_READY) return null;
  const decoded = decodeURIComponent(pathname);
  let target = resolve(DIST, `.${decoded}`);
  if (target !== DIST && !target.startsWith(`${DIST}${sep}`)) return null;
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  if (!existsSync(target) || !statSync(target).isFile()) target = join(DIST, 'index.html');
  return target;
}

async function createBackup() {
  if (backupRunning) return;
  const revision = Number(readState.get().revision);
  if (revision === lastBackupRevision) return;
  backupRunning = true;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await backup(db, join(BACKUP_DIR, `pos-r${revision}-${stamp}.sqlite`));
    lastBackupRevision = revision;
    const files = readdirSync(BACKUP_DIR).filter((file) => file.endsWith('.sqlite')).sort().reverse();
    files.slice(BACKUP_LIMIT).forEach((file) => unlinkSync(join(BACKUP_DIR, file)));
  } catch (error) {
    console.error('No se pudo crear respaldo:', error);
  } finally {
    backupRunning = false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, database: 'sqlite', revision: Number(readState.get().revision), backups: true });
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!allowLogin(req)) return json(res, 429, { error: 'Demasiados intentos. Espera 10 minutos.' });
      const body = await readJson(req);
      const username = String(body.username || '').trim().toLowerCase();
      const user = rawStatePayload().state.users.find((item) => item.active && item.username.toLowerCase() === username);
      if (!user || !safeEqual(user.password, body.password)) {
        registerLoginFailure(req);
        return json(res, 401, { error: 'Usuario o clave incorrectos' });
      }
      loginFailures.delete(clientIp(req));
      const token = randomBytes(32).toString('base64url');
      saveSession.run(tokenHash(token), user.id, Date.now() + SESSION_TTL);
      return json(res, 200, { ...statePayload(), token, currentUser: sanitizeUser(user) });
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const auth = authenticatedUser(req);
      if (auth) deleteSession.run(auth.hash);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      if (!authenticatedUser(req)) return json(res, 401, { error: 'Sesión requerida' });
      return json(res, 200, statePayload());
    }

    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const auth = authenticatedUser(req);
      if (!auth) return json(res, 401, { error: 'Sesión requerida' });
      const body = await readJson(req);
      if (!validState(body.state)) return json(res, 400, { error: 'Estado POS inválido' });
      const currentPayload = rawStatePayload();
      const expectedRevision = Number(body.expectedRevision);
      if (expectedRevision !== currentPayload.revision) return json(res, 409, { error: 'Conflicto de revisión', ...statePayload() });

      let nextState = structuredClone(body.state);
      if (auth.user.role === 'cashier') nextState = restrictCashierState(currentPayload.state, nextState);
      else nextState.users = preservePasswords(currentPayload.state.users, nextState.users);

      const result = writeState.get(JSON.stringify(nextState), new Date().toISOString(), expectedRevision);
      if (!result) return json(res, 409, { error: 'Conflicto de revisión', ...statePayload() });
      return json(res, 200, { ok: true, revision: Number(result.revision), updatedAt: result.updated_at });
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API no encontrada' });
    if (!['GET', 'HEAD'].includes(req.method || '')) return json(res, 405, { error: 'Método no permitido' });

    const file = staticFile(url.pathname);
    if (!file) return json(res, DIST_READY ? 403 : 503, { error: DIST_READY ? 'Ruta no permitida' : 'Interfaz no compilada' });
    const stats = statSync(file);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (error) {
    console.error(error);
    json(res, error.status || 500, { error: error.message || 'Error interno' });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`POS local listo\nMac:     http://127.0.0.1:${PORT}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`Red:     http://${address.address}:${PORT}`);
    }
  }
  console.log(`SQLite:  ${DB_PATH}\nBackups: ${BACKUP_DIR}`);
  createBackup();
});

const backupTimer = setInterval(createBackup, BACKUP_INTERVAL);
backupTimer.unref();

function shutdown() {
  clearInterval(backupTimer);
  server.close(() => {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
