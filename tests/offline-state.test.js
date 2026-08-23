import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeOfflineState } from '../src/lib/offline-state.js';

const state = (overrides = {}) => ({
  settings: { businessName: 'POS' },
  users: [], stores: [], products: [], sessions: [], sales: [], events: [],
  ...overrides,
});

test('fusiona venta offline sin duplicar ID', () => {
  const base = state({ sales: [{ id: 'sale-1', total: 10 }] });
  const local = state({ sales: [{ id: 'sale-1', total: 10 }, { id: 'sale-offline', total: 20 }] });
  const remote = state({ sales: [{ id: 'sale-1', total: 10 }, { id: 'sale-remota', total: 30 }] });
  const merged = mergeOfflineState(base, local, remote);
  assert.deepEqual(merged.sales.map((sale) => sale.id).sort(), ['sale-1', 'sale-offline', 'sale-remota']);
  assert.equal(merged.sales.filter((sale) => sale.id === 'sale-offline').length, 1);
});

test('conserva cierre de caja offline y cambio remoto', () => {
  const openSession = { id: 'session-1', closedAt: null };
  const base = state({ sessions: [openSession], events: [{ id: 'event-1', name: 'Festival', closedAt: null }] });
  const local = state({ sessions: [{ ...openSession, closedAt: '2026-08-23T02:00:00Z', closingAmount: 100 }], events: base.events });
  const remote = state({ sessions: [openSession], events: [{ ...base.events[0], name: 'Festival actualizado' }] });
  const merged = mergeOfflineState(base, local, remote);
  assert.equal(merged.sessions[0].closedAt, '2026-08-23T02:00:00Z');
  assert.equal(merged.events[0].name, 'Festival actualizado');
});
