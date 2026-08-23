import assert from 'node:assert/strict';
import test from 'node:test';
import { restrictCashierState } from '../server/cloud-store.mjs';
import { appendCanonicalSale } from '../src/lib/sale-persistence.js';

const actor = { id: 'user-flor', name: 'Flor', role: 'cashier' };
const state = () => ({
  settings: { businessName: 'AQPTUNING 2026' },
  users: [actor],
  stores: [{ id: 'store-a', name: 'Tienda A', address: '', phone: '' }],
  products: [],
  events: [{ id: 'event-1', name: 'Evento', closedAt: null }],
  sessions: [{ id: 'session-1', eventId: 'event-1', userId: actor.id, openedAt: '2026-08-23T10:00:00Z', closedAt: null, cashNumber: 1, cashCode: 'CAJ01' }],
  sales: [],
});
const draft = (id) => ({
  id,
  number: '00093',
  eventId: 'event-1',
  sessionId: 'session-1',
  storeId: 'store-a',
  payment: 'YAPE',
  items: [{ productId: 'p1', name: 'Producto', qty: 1, price: 10 }],
  createdAt: '2026-08-23T12:00:00Z',
  syncStatus: 'pending',
});

test('servidor asigna número único e ignora número propuesto', () => {
  const first = appendCanonicalSale(state(), draft('sale-a'), actor);
  const second = appendCanonicalSale(first.state, draft('sale-b'), actor);
  assert.equal(first.sale.number, '00001');
  assert.equal(second.sale.number, '00002');
  assert.equal(second.sale.syncStatus, 'synced');
});

test('UUID repetido devuelve misma venta sin duplicarla', () => {
  const first = appendCanonicalSale(state(), draft('sale-a'), actor);
  const repeated = appendCanonicalSale(first.state, { ...draft('sale-a'), items: [{ name: 'Otro', qty: 1, price: 99 }] }, actor);
  assert.equal(repeated.created, false);
  assert.equal(repeated.state.sales.length, 1);
  assert.equal(repeated.sale.total, 10);
});

test('sincroniza venta offline creada antes del cierre', () => {
  const closed = state();
  closed.events[0].closedAt = '2026-08-23T13:00:00Z';
  closed.sessions[0].closedAt = '2026-08-23T12:30:00Z';
  const result = appendCanonicalSale(closed, draft('sale-offline'), actor);
  assert.equal(result.sale.number, '00001');
});

test('cliente antiguo no puede borrar venta ya confirmada', () => {
  const saved = appendCanonicalSale(state(), draft('sale-saved'), actor).state;
  const stale = state();
  const restricted = restrictCashierState(saved, stale, actor);
  assert.equal(restricted.sales.length, 1);
  assert.equal(restricted.sales[0].id, 'sale-saved');
});
