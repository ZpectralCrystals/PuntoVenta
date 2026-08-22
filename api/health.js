import { cloudDb, readState, sendJson } from '../server/cloud-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    const payload = await readState(cloudDb());
    return sendJson(res, 200, { ok: true, database: 'supabase', revision: payload.revision });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
}
