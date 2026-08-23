import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToCart,
  authenticateUser,
  calculateChange,
  cartCount,
  cartSubtotal,
  eventSettlement,
  sessionSummary,
  updateCartQty,
} from '../src/lib/pos-core.js';

const product = { id: 'p1', name: 'Pollo a la brasa', price: 30 };

test('agrega productos y acumula cantidad', () => {
  const once = addToCart([], product);
  const twice = addToCart(once, product);
  assert.equal(cartCount(twice), 2);
  assert.equal(cartSubtotal(twice), 60);
});

test('elimina producto cuando cantidad llega a cero', () => {
  const cart = addToCart([], product);
  assert.deepEqual(updateCartQty(cart, 'p1', -1), []);
});

test('calcula vuelto sin valores negativos', () => {
  assert.equal(calculateChange(28, 50), 22);
  assert.equal(calculateChange(28, 20), 0);
});

test('autentica cajero activo con usuario y clave exactos', () => {
  const users = [{ id: 'u1', username: 'flor', password: 'julio', active: true }];
  assert.equal(authenticateUser(users, 'FLOR', 'julio')?.id, 'u1');
  assert.equal(authenticateUser(users, 'flor', 'otra'), null);
});

test('resume caja por método de pago', () => {
  const session = { id: 's1', openingAmount: 100 };
  const sales = [
    { sessionId: 's1', total: 30, payment: 'EFECTIVO' },
    { sessionId: 's1', total: 20, payment: 'YAPE' },
    { sessionId: 'other', total: 999, payment: 'EFECTIVO' },
  ];
  assert.deepEqual(sessionSummary(session, sales), {
    count: 2,
    salesTotal: 50,
    expectedCash: 130,
    payments: { EFECTIVO: 30, YAPE: 20 },
  });
});

test('genera cuadre consolidado de evento por tienda', () => {
  const stores = [{ id: 'a', name: 'Tienda A' }, { id: 'b', name: 'Tienda B' }];
  const sessions = [
    { id: 's1', eventId: 'e1', scope: 'festival', cashier: 'Flor', openingAmount: 100, closingAmount: 145, openedAt: '2026-01-01T08:00:00Z', closedAt: '2026-01-01T12:00:00Z' },
  ];
  const sales = [
    { eventId: 'e1', sessionId: 's1', storeId: 'a', payment: 'EFECTIVO', total: 40 },
    { eventId: 'e1', sessionId: 's1', storeId: 'a', payment: 'YAPE', total: 20 },
    { eventId: 'e1', sessionId: 's1', storeId: 'b', payment: 'YAPE', total: 30 },
  ];
  const result = eventSettlement({ id: 'e1' }, stores, sessions, sales);
  assert.equal(result.saleCount, 3);
  assert.equal(result.salesTotal, 90);
  assert.equal(result.expectedCash, 140);
  assert.equal(result.countedCash, 145);
  assert.equal(result.difference, 5);
  assert.deepEqual(result.payments, { EFECTIVO: 40, YAPE: 50 });
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.sessions[0], {
    id: 's1', cashier: 'Flor', openedAt: '2026-01-01T08:00:00Z', closedAt: '2026-01-01T12:00:00Z',
    saleCount: 3, salesTotal: 90, payments: { EFECTIVO: 40, YAPE: 50 },
    openingCash: 100, expectedCash: 140, countedCash: 145, difference: 5,
  });
});
