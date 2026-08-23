import { calculateChange, cashRegisterCode, nextCashNumber, nextSessionSaleNumber } from './pos-core.js';

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function updateSaleObservation(sourceState, saleId, value, actor, updatedAt = new Date().toISOString()) {
  const state = structuredClone(sourceState);
  const sale = state.sales.find((item) => item.id === saleId);
  if (!sale) fail('Venta no encontrada', 404);
  if (actor?.role !== 'admin' && sale.userId !== actor?.id) fail('No puedes editar esta venta', 403);
  const observation = String(value || '').trim();
  if (observation.length > 180) fail('Observación supera 180 caracteres');
  if (observation === String(sale.observation || '')) return { state, sale, changed: false };
  Object.assign(sale, {
    observation,
    observationUpdatedAt: safeDate(updatedAt),
    observationUpdatedBy: actor?.name || 'Usuario',
    observationUpdatedByUserId: actor?.id || '',
  });
  return { state, sale, changed: true };
}

function safeDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function appendCanonicalSale(sourceState, draft, actor) {
  const state = structuredClone(sourceState);
  const id = String(draft?.id || '');
  if (!id) fail('ID de venta requerido');
  const existing = state.sales.find((sale) => sale.id === id);
  if (existing) return { state, sale: existing, created: false };

  const createdAt = safeDate(draft.createdAt);
  const createdAtMs = new Date(createdAt).getTime();
  const event = state.events.find((item) => item.id === draft.eventId);
  if (!event || (event.closedAt && createdAtMs > new Date(event.closedAt).getTime())) fail('Evento inválido para fecha de venta');
  const session = state.sessions.find((item) => item.id === draft.sessionId && item.eventId === event.id);
  if (!session || (session.closedAt && createdAtMs > new Date(session.closedAt).getTime())) fail('Caja inválida para fecha de venta');
  if (actor?.role !== 'admin' && session.userId !== actor?.id) fail('Caja pertenece a otro usuario');
  const store = state.stores.find((item) => item.id === draft.storeId);
  if (!store) fail('Tienda inválida');

  const items = (draft.items || []).map((item) => ({
    productId: String(item.productId || ''),
    name: String(item.name || '').trim(),
    price: Number(item.price || 0),
    qty: Math.max(1, Number(item.qty) || 1),
    note: String(item.note || ''),
  })).filter((item) => item.name && item.price >= 0);
  if (!items.length) fail('Venta sin productos');
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (total <= 0) fail('Total de venta inválido');
  const payment = ['EFECTIVO', 'YAPE'].includes(draft.payment) ? draft.payment : null;
  if (!payment) fail('Método de pago inválido');

  const cashNumber = Number(session.cashNumber)
    || nextCashNumber(state.sessions.filter((item) => item.id !== session.id), event.id);
  const cashCode = session.cashCode || cashRegisterCode(cashNumber);
  Object.assign(session, { cashNumber, cashCode });
  const received = payment === 'EFECTIVO' ? Math.max(total, Number(draft.received || total)) : total;
  const saleUser = actor?.role === 'admin' && draft.userId
    ? state.users.find((user) => user.id === draft.userId) || actor
    : actor;
  const sale = {
    ...draft,
    id,
    number: nextSessionSaleNumber(state.sales, session.id),
    cashNumber,
    cashCode,
    eventId: event.id,
    storeId: store.id,
    store: { name: store.name, address: store.address, phone: store.phone },
    business: { ...state.settings },
    sessionId: session.id,
    userId: saleUser?.id || draft.userId,
    cashier: actor?.role === 'admin' && draft.cashier ? draft.cashier : saleUser?.name || 'Sin cajera',
    customer: String(draft.customer || '').trim(),
    items,
    subtotal: total,
    total,
    payment,
    received,
    change: payment === 'EFECTIVO' ? calculateChange(total, received) : 0,
    observation: String(draft.observation || '').trim(),
    syncStatus: 'synced',
    createdAt,
  };
  state.sales.push(sale);
  return { state, sale, created: true };
}
