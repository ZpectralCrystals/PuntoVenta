import { authenticate, sendJson } from '../server/cloud-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    const auth = await authenticate(req);
    if (auth) await auth.db.from('auth_sessions').delete().eq('token_hash', auth.hash);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Error interno' });
  }
}
