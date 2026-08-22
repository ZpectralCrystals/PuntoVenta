import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildSalesWorkbook, buildSettlementWorkbook } from '../src/lib/excel-report.js';

const sales = [
  {
    number: '00001', eventId: 'event-1', payment: 'EFECTIVO', total: 32,
    createdAt: '2026-08-22T20:00:00.000Z', customer: 'Cliente general',
    store: { name: 'La Cueva del Parrillero' }, items: [{ name: 'Bife', qty: 1, price: 32 }],
  },
  {
    number: '00002', eventId: 'event-1', payment: 'YAPE', total: 4,
    createdAt: '2026-08-22T20:05:00.000Z', customer: 'Mesa 2',
    store: { name: 'NellyMarket' }, items: [{ name: 'Energizante', qty: 1, price: 4 }],
  },
];

test('genera Excel estructurado de ventas', async () => {
  const buffer = await buildSalesWorkbook({ sales, storeName: 'Festival', eventName: 'Evento QA', businessName: 'Mesa Clara' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Resumen de ventas', 'Detalle productos']);
  assert.equal(workbook.getWorksheet('Resumen de ventas').getCell('A6').value, 2);
  assert.equal(workbook.getWorksheet('Resumen de ventas').getCell('C6').value, 36);
  assert.equal(workbook.getWorksheet('Resumen de ventas').getCell('E6').value, 32);
  assert.equal(workbook.getWorksheet('Resumen de ventas').getCell('G6').value, 4);
});

test('genera Excel de cuadre sin tarjeta', async () => {
  const settlement = {
    saleCount: 2, salesTotal: 36, openingCash: 100, expectedCash: 132, countedCash: 132, difference: 0,
    payments: { EFECTIVO: 32, YAPE: 4 },
    stores: [
      { storeName: 'La Cueva del Parrillero', saleCount: 1, salesTotal: 32, payments: { EFECTIVO: 32, YAPE: 0 } },
      { storeName: 'NellyMarket', saleCount: 1, salesTotal: 4, payments: { EFECTIVO: 0, YAPE: 4 } },
    ],
  };
  const buffer = await buildSettlementWorkbook({ event: { id: 'event-1', name: 'Evento QA' }, settlement, sales, businessName: 'Mesa Clara' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Cuadre del evento', 'Ventas', 'Detalle productos']);
  const headings = workbook.getWorksheet('Cuadre del evento').getRow(10).values.join(' ');
  assert.equal(headings.includes('Tarjeta'), false);
  assert.match(headings, /Efectivo/);
  assert.match(headings, /Yape/);
});
