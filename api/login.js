import { bodyOf, cloudDb, createSession, publicPayload, readState, sanitizeUser, sendJson, verifyPassword } from '../server/cloud-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    const db = cloudDb();
    const body = bodyOf(req);
    const username = String(body.username || '').trim().toLowerCase();
    const payload = await readState(db);
    const user = payload.state.users.find((item) => item.active && item.username.toLowerCase() === username);
    if (!user || !verifyPassword(body.password, user.passwordHash)) return sendJson(res, 401, { error: 'Usuario o clave incorrectos' });
    const token = await createSession(db, user.id);
    return sendJson(res, 200, { ...publicPayload(payload), token, currentUser: sanitizeUser(user) });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Error interno' });
  }
}
