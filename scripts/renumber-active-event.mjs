const cloudUrl = String(process.env.POS_CLOUD_URL || 'https://punto-venta-iota.vercel.app').replace(/\/$/, '');
const username = process.env.POS_ADMIN_USER;
const password = process.env.POS_ADMIN_PASSWORD;
const targetName = process.env.POS_TARGET_EVENT;

if (!username || !password || !targetName) {
  throw new Error('Faltan POS_ADMIN_USER, POS_ADMIN_PASSWORD o POS_TARGET_EVENT');
}

async function request(path, options = {}) {
  const response = await fetch(`${cloudUrl}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const login = await request('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const authorization = { Authorization: `Bearer ${login.token}` };
const before = await request('/api/state', { headers: authorization });
const state = structuredClone(before.state);
const targets = state.events.filter((event) => event.name === targetName && !event.closedAt);

if (targets.length !== 1) {
  throw new Error(`Se esperaba 1 evento activo exacto; encontrados: ${targets.length}`);
}

const event = targets[0];
const targetSessions = state.sessions
  .filter((session) => session.eventId === event.id)
  .sort((left, right) => String(left.openedAt || '').localeCompare(String(right.openedAt || '')) || left.id.localeCompare(right.id));
const targetSessionIds = new Set(targetSessions.map((session) => session.id));
const orphanSales = state.sales.filter((sale) => sale.eventId === event.id && !targetSessionIds.has(sale.sessionId));

if (orphanSales.length) {
  throw new Error(`Hay ${orphanSales.length} ventas del evento sin caja válida; no se modificó nada`);
}

const untouchedBefore = new Map(state.sales
  .filter((sale) => sale.eventId !== event.id)
  .map((sale) => [sale.id, JSON.stringify({
    number: sale.number,
    cashNumber: sale.cashNumber,
    cashCode: sale.cashCode,
  })]));

const sessionSummary = [];
for (const [sessionIndex, session] of targetSessions.entries()) {
  const cashNumber = sessionIndex + 1;
  const cashCode = `CAJ${String(cashNumber).padStart(2, '0')}`;
  Object.assign(session, { cashNumber, cashCode });

  const sessionSales = state.sales
    .filter((sale) => sale.eventId === event.id && sale.sessionId === session.id)
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || left.id.localeCompare(right.id));

  for (const [saleIndex, sale] of sessionSales.entries()) {
    Object.assign(sale, {
      number: String(saleIndex + 1).padStart(5, '0'),
      cashNumber,
      cashCode,
    });
  }

  sessionSummary.push({
    cashCode,
    sessionId: session.id,
    sales: sessionSales.map((sale) => `#${cashCode} - #${sale.number}`),
  });
}

for (const sale of state.sales.filter((item) => item.eventId !== event.id)) {
  const current = JSON.stringify({
    number: sale.number,
    cashNumber: sale.cashNumber,
    cashCode: sale.cashCode,
  });
  if (untouchedBefore.get(sale.id) !== current) throw new Error(`Venta externa alterada: ${sale.id}`);
}

const saved = await request('/api/state', {
  method: 'PUT',
  headers: { ...authorization, 'Content-Type': 'application/json' },
  body: JSON.stringify({ state, expectedRevision: before.revision }),
});
const after = await request('/api/state', { headers: authorization });

if (Number(after.revision) !== Number(saved.revision)) throw new Error('Revisión final inesperada');
for (const summary of sessionSummary) {
  const session = after.state.sessions.find((item) => item.id === summary.sessionId);
  if (session?.cashCode !== summary.cashCode) throw new Error(`Caja no verificada: ${summary.sessionId}`);
  const references = after.state.sales
    .filter((sale) => sale.eventId === event.id && sale.sessionId === summary.sessionId)
    .sort((left, right) => Number(left.number) - Number(right.number))
    .map((sale) => `#${sale.cashCode} - #${sale.number}`);
  if (JSON.stringify(references) !== JSON.stringify(summary.sales)) throw new Error(`Ventas no verificadas: ${summary.sessionId}`);
}
for (const [saleId, snapshot] of untouchedBefore) {
  const sale = after.state.sales.find((item) => item.id === saleId);
  if (!sale) throw new Error(`Venta externa desapareció: ${saleId}`);
  const current = JSON.stringify({
    number: sale.number,
    cashNumber: sale.cashNumber,
    cashCode: sale.cashCode,
  });
  if (snapshot !== current) throw new Error(`Venta externa cambió: ${saleId}`);
}

console.log(JSON.stringify({
  ok: true,
  event: event.name,
  revisionBefore: before.revision,
  revisionAfter: after.revision,
  sessions: sessionSummary,
}, null, 2));
