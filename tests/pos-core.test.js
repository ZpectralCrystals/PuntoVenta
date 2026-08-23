import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToCart,
  authenticateUser,
  calculateChange,
  cartCount,
  cartSubtotal,
  cashierOperationalSales,
  cashRegisterCode,
  compareSalesByReference,
  eventSettlement,
  filterSalesByStore,
  nextCashNumber,
  nextSessionSaleNumber,
  saleReference,
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

test('muestra historial operativo propio por sesión o evento', () => {
  const sales = [
    { id: 'v1', userId: 'flor', eventId: 'e1', sessionId: 's1' },
    { id: 'v2', userId: 'flor', eventId: 'e1', sessionId: 's2' },
    { id: 'v3', userId: 'otro', eventId: 'e1', sessionId: 's1' },
    { id: 'v4', userId: 'flor', eventId: 'e2', sessionId: 's3' },
  ];
  assert.deepEqual(cashierOperationalSales(sales, 'flor', 'e1', 's1').map((sale) => sale.id), ['v1']);
  assert.deepEqual(cashierOperationalSales(sales, 'flor', 'e1').map((sale) => sale.id), ['v1', 'v2']);
});

test('numera cajas por evento y ventas por caja', () => {
  const sessions = [
    { id: 's1', eventId: 'e1', cashNumber: 1 },
    { id: 's2', eventId: 'otro', cashNumber: 4 },
  ];
  const sales = [
    { sessionId: 's1', number: '00001' },
    { sessionId: 's1', number: '00002' },
    { sessionId: 's2', number: '00009' },
  ];
  assert.equal(nextCashNumber(sessions, 'e1'), 2);
  assert.equal(nextCashNumber(sessions, 'nuevo'), 1);
  assert.equal(nextSessionSaleNumber(sales, 's1'), '00003');
  assert.equal(nextSessionSaleNumber(sales, 'sin-ventas'), '00001');
  assert.equal(cashRegisterCode(2), 'CAJ02');
  assert.equal(saleReference({ cashCode: 'CAJ02', number: '00001' }), '#CAJ02 - #00001');
  assert.equal(saleReference({ number: '00007' }), '#00007');
});

test('filtra historial por tienda y ordena desde primer ticket', () => {
  const sales = [
    { id: 'v3', storeId: 'a', cashNumber: 2, number: '00001' },
    { id: 'v2', storeId: 'b', cashNumber: 1, number: '00002' },
    { id: 'v1', storeId: 'a', cashNumber: 1, number: '00001' },
  ];
  assert.deepEqual(filterSalesByStore(sales, 'all').map((sale) => sale.id), ['v3', 'v2', 'v1']);
  assert.deepEqual(filterSalesByStore(sales, 'a').map((sale) => sale.id), ['v3', 'v1']);
  assert.deepEqual([...sales].sort(compareSalesByReference).map((sale) => sale.id), ['v1', 'v2', 'v3']);
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
    id: 's1', cashNumber: 1, cashCode: 'CAJ01', cashier: 'Flor', openedAt: '2026-01-01T08:00:00Z', closedAt: '2026-01-01T12:00:00Z',
    saleCount: 3, salesTotal: 90, payments: { EFECTIVO: 40, YAPE: 50 },
    openingCash: 100, expectedCash: 140, countedCash: 145, difference: 5,
  });
});
