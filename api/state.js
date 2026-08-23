import { authenticate, prepareUsers, publicPayload, readState, restrictCashierState, sendJson, validState } from '../server/cloud-store.mjs';

export default async function handler(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    const auth = await authenticate(req);
    if (!auth) return sendJson(res, 401, { error: 'Sesión requerida' });
    if (req.method === 'GET') return sendJson(res, 200, publicPayload(await readState(auth.db)));

    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    if (!validState(body.state)) return sendJson(res, 400, { error: 'Estado POS inválido' });
    const current = await readState(auth.db);
    const expectedRevision = Number(body.expectedRevision);
    if (expectedRevision !== current.revision) return sendJson(res, 409, { error: 'Conflicto de revisión', ...publicPayload(current) });

    let nextState = structuredClone(body.state);
    if (auth.user.role === 'cashier') nextState = restrictCashierState(current.state, nextState, auth.user);
    else nextState.users = prepareUsers(current.state.users, nextState.users);

    const updatedAt = new Date().toISOString();
    const { data, error } = await auth.db.from('app_state')
      .update({ state: nextState, revision: current.revision + 1, updated_at: updatedAt })
      .eq('id', 1).eq('revision', current.revision)
      .select('revision,updated_at').maybeSingle();
    if (error) throw error;
    if (!data) return sendJson(res, 409, { error: 'Conflicto de revisión', ...publicPayload(await readState(auth.db)) });
    return sendJson(res, 200, {
      ok: true,
      ...publicPayload({ state: nextState, revision: Number(data.revision), updatedAt: data.updated_at }),
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Error interno' });
  }
}
