import { authenticate, bodyOf, publicPayload, readState, sendJson } from '../server/cloud-store.mjs';
import { appendCanonicalSale, updateSaleObservation } from '../src/lib/sale-persistence.js';

const MAX_ATTEMPTS = 6;

export default async function handler(req, res) {
  if (!['POST', 'PATCH'].includes(req.method)) return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    const auth = await authenticate(req);
    if (!auth) return sendJson(res, 401, { error: 'Sesión requerida' });
    const body = bodyOf(req);

    if (req.method === 'PATCH') {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = await readState(auth.db);
        const result = updateSaleObservation(current.state, body.saleId, body.observation, auth.user);
        if (!result.changed) return sendJson(res, 200, { ok: true, unchanged: true, sale: result.sale, ...publicPayload(current) });
        const updatedAt = new Date().toISOString();
        const { data, error } = await auth.db.from('app_state')
          .update({ state: result.state, revision: current.revision + 1, updated_at: updatedAt })
          .eq('id', 1).eq('revision', current.revision)
          .select('revision,updated_at').maybeSingle();
        if (error) throw error;
        if (!data) continue;
        return sendJson(res, 200, {
          ok: true,
          unchanged: false,
          sale: result.sale,
          ...publicPayload({ state: result.state, revision: Number(data.revision), updatedAt: data.updated_at }),
        });
      }
      return sendJson(res, 409, { error: 'No se pudo guardar observación; reintenta' });
    }

    const draft = body.sale;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await readState(auth.db);
      const result = appendCanonicalSale(current.state, draft, auth.user);
      if (!result.created) {
        return sendJson(res, 200, { ok: true, idempotent: true, sale: result.sale, ...publicPayload(current) });
      }

      const updatedAt = new Date().toISOString();
      const { data, error } = await auth.db.from('app_state')
        .update({ state: result.state, revision: current.revision + 1, updated_at: updatedAt })
        .eq('id', 1).eq('revision', current.revision)
        .select('revision,updated_at').maybeSingle();
      if (error) throw error;
      if (!data) continue;
      return sendJson(res, 201, {
        ok: true,
        idempotent: false,
        sale: result.sale,
        ...publicPayload({ state: result.state, revision: Number(data.revision), updatedAt: data.updated_at }),
      });
    }
    return sendJson(res, 409, { error: 'No se pudo reservar número de venta; reintenta' });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'Error interno' });
  }
}
