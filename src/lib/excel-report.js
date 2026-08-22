import ExcelJS from 'exceljs';

const COLORS = {
  ink: 'FF18251E',
  green: 'FF3E805E',
  greenSoft: 'FFE5F0E9',
  amber: 'FFD99B45',
  amberSoft: 'FFFFF0D8',
  blue: 'FF526FB5',
  blueSoft: 'FFE8EDF8',
  cream: 'FFF7F5F0',
  white: 'FFFFFFFF',
  muted: 'FF667168',
  line: 'FFD9DED9',
  red: 'FF9D403C',
};

const currencyFormat = '"S/" #,##0.00';
const dateFormat = 'dd/mm/yyyy';
const timeFormat = 'hh:mm AM/PM';

function safeName(value) {
  return String(value || 'reporte')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mesa Clara POS';
  workbook.company = 'Mesa Clara';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}

function solid(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function border(color = COLORS.line) {
  const side = { style: 'thin', color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function eachCell(sheet, startRow, startColumn, endRow, endColumn, apply) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) apply(sheet.getCell(row, column));
  }
}

function styleTitle(sheet, title, subtitle, endColumn = 'H') {
  sheet.mergeCells(`A1:${endColumn}2`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.fill = solid(COLORS.ink);
  titleCell.font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: COLORS.white } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 26;
  sheet.getRow(2).height = 18;

  sheet.mergeCells(`A3:${endColumn}3`);
  const subtitleCell = sheet.getCell('A3');
  subtitleCell.value = subtitle;
  subtitleCell.fill = solid(COLORS.cream);
  subtitleCell.font = { name: 'Aptos', size: 10, color: { argb: COLORS.muted } };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(3).height = 22;
}

function styleCard(sheet, range, label, value, fill, numberFormat) {
  const [start, end] = range.split(':');
  const startColumn = start.match(/[A-Z]+/)[0];
  const endColumn = end.match(/[A-Z]+/)[0];
  const startRow = Number(start.match(/\d+/)[0]);
  const endRow = Number(end.match(/\d+/)[0]);
  sheet.mergeCells(`${startColumn}${startRow}:${endColumn}${startRow}`);
  sheet.mergeCells(`${startColumn}${startRow + 1}:${endColumn}${endRow}`);
  const labelCell = sheet.getCell(`${startColumn}${startRow}`);
  const valueCell = sheet.getCell(`${startColumn}${startRow + 1}`);
  labelCell.value = label;
  valueCell.value = value;
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = sheet.getColumn(startColumn).number; column <= sheet.getColumn(endColumn).number; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.fill = solid(fill);
      cell.border = border(fill);
    }
  }
  labelCell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: COLORS.muted } };
  valueCell.font = { name: 'Aptos Display', size: 17, bold: true, color: { argb: COLORS.ink } };
  labelCell.alignment = { vertical: 'middle', horizontal: 'left' };
  valueCell.alignment = { vertical: 'middle', horizontal: 'left' };
  if (numberFormat) valueCell.numFmt = numberFormat;
}

function setCommonSheetOptions(sheet, frozenRow = 10) {
  sheet.properties.defaultRowHeight = 18;
  sheet.views = [{ state: 'frozen', ySplit: frozenRow, showGridLines: false }];
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
}

function addSalesTable(sheet, sales, startRow = 10, tableName = 'VentasTable') {
  const rows = sales.map((sale) => {
    const createdAt = new Date(sale.createdAt);
    return [
      `#${sale.number}`,
      createdAt,
      createdAt,
      sale.store?.name || 'Sin tienda',
      sale.customer || 'Cliente general',
      sale.payment,
      sale.items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
      Number(sale.total || 0),
    ];
  });
  sheet.addTable({
    name: tableName,
    ref: `A${startRow}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: [
      { name: 'Venta' },
      { name: 'Fecha' },
      { name: 'Hora' },
      { name: 'Tienda' },
      { name: 'Cliente' },
      { name: 'Pago' },
      { name: 'Unidades' },
      { name: 'Total' },
    ],
    rows,
  });
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 13;
  sheet.getColumn(3).width = 13;
  sheet.getColumn(4).width = 28;
  sheet.getColumn(5).width = 24;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 11;
  sheet.getColumn(8).width = 15;
  const firstDataRow = startRow + 1;
  const lastDataRow = Math.max(firstDataRow, startRow + rows.length);
  for (let row = firstDataRow; row <= lastDataRow; row += 1) {
    sheet.getCell(row, 2).numFmt = dateFormat;
    sheet.getCell(row, 3).numFmt = timeFormat;
    sheet.getCell(row, 7).numFmt = '#,##0';
    sheet.getCell(row, 8).numFmt = currencyFormat;
  }
  eachCell(sheet, startRow, 1, lastDataRow, 8, (cell) => { cell.font = { name: 'Aptos', size: 10 }; });
  sheet.getRow(startRow).height = 24;
  return { firstDataRow, lastDataRow };
}

function addProductDetailSheet(workbook, sales) {
  const sheet = workbook.addWorksheet('Detalle productos', { properties: { tabColor: { argb: COLORS.amber } } });
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  styleTitle(sheet, 'Detalle de productos', 'Una fila por producto vendido · valores listos para filtros y análisis', 'I');
  const rows = sales.flatMap((sale) => sale.items.map((item) => [
    `#${sale.number}`,
    new Date(sale.createdAt),
    sale.store?.name || 'Sin tienda',
    item.name,
    Number(item.qty || 0),
    Number(item.price || 0),
    Number(item.qty || 0) * Number(item.price || 0),
    sale.payment,
    sale.customer || 'Cliente general',
  ]));
  sheet.addTable({
    name: 'DetalleProductosTable',
    ref: 'A5',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: ['Venta', 'Fecha', 'Tienda', 'Producto', 'Cantidad', 'Precio unitario', 'Subtotal', 'Pago', 'Cliente'].map((name) => ({ name })),
    rows,
  });
  [12, 18, 28, 42, 11, 16, 15, 14, 24].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let row = 6; row <= 5 + rows.length; row += 1) {
    sheet.getCell(row, 2).numFmt = 'dd/mm/yyyy hh:mm AM/PM';
    sheet.getCell(row, 5).numFmt = '#,##0';
    sheet.getCell(row, 6).numFmt = currencyFormat;
    sheet.getCell(row, 7).numFmt = currencyFormat;
  }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return sheet;
}

export async function buildSalesWorkbook({ sales, storeName, eventName, businessName }) {
  const workbook = createWorkbook();
  const sheet = workbook.addWorksheet('Resumen de ventas', { properties: { tabColor: { argb: COLORS.green } } });
  setCommonSheetOptions(sheet);
  styleTitle(
    sheet,
    'Reporte de ventas',
    `${businessName || 'Mesa Clara'} · ${storeName || 'Todas las tiendas'} · ${eventName || 'Histórico'} · Generado ${new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`,
  );
  const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cash = sales.filter((sale) => sale.payment === 'EFECTIVO').reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const yape = sales.filter((sale) => sale.payment === 'YAPE').reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  styleCard(sheet, 'A5:B7', 'TICKETS', sales.length, COLORS.greenSoft, '#,##0');
  styleCard(sheet, 'C5:D7', 'VENTA TOTAL', total, COLORS.amberSoft, currencyFormat);
  styleCard(sheet, 'E5:F7', 'EFECTIVO', cash, COLORS.greenSoft, currencyFormat);
  styleCard(sheet, 'G5:H7', 'YAPE', yape, COLORS.blueSoft, currencyFormat);
  sheet.getRow(5).height = 20;
  sheet.getRow(6).height = 22;
  sheet.getRow(7).height = 18;
  addSalesTable(sheet, sales);
  addProductDetailSheet(workbook, sales);
  return workbook.xlsx.writeBuffer();
}

export async function buildSettlementWorkbook({ event, settlement, sales, businessName }) {
  const workbook = createWorkbook();
  const sheet = workbook.addWorksheet('Cuadre del evento', { properties: { tabColor: { argb: COLORS.green } } });
  setCommonSheetOptions(sheet);
  styleTitle(
    sheet,
    `Cuadre · ${event.name}`,
    `${businessName || 'Mesa Clara'} · ${event.closedAt ? 'Evento cerrado' : 'Corte provisional'} · Generado ${new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`,
  );
  styleCard(sheet, 'A5:B7', 'TICKETS', settlement.saleCount, COLORS.greenSoft, '#,##0');
  styleCard(sheet, 'C5:D7', 'VENTA TOTAL', settlement.salesTotal, COLORS.amberSoft, currencyFormat);
  styleCard(sheet, 'E5:F7', 'EFECTIVO', settlement.payments.EFECTIVO, COLORS.greenSoft, currencyFormat);
  styleCard(sheet, 'G5:H7', 'YAPE', settlement.payments.YAPE, COLORS.blueSoft, currencyFormat);
  sheet.addTable({
    name: 'CuadreTiendasTable',
    ref: 'A10',
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: [
      { name: 'Tienda', totalsRowLabel: 'TOTAL' },
      { name: 'Tickets', totalsRowFunction: 'sum' },
      { name: 'Venta total', totalsRowFunction: 'sum' },
      { name: 'Efectivo', totalsRowFunction: 'sum' },
      { name: 'Yape', totalsRowFunction: 'sum' },
      { name: '% del evento', totalsRowFunction: 'sum' },
    ],
    rows: settlement.stores.map((row) => [
      row.storeName,
      row.saleCount,
      row.salesTotal,
      row.payments.EFECTIVO,
      row.payments.YAPE,
      settlement.salesTotal ? row.salesTotal / settlement.salesTotal : 0,
    ]),
  });
  [30, 12, 16, 16, 16, 15].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let row = 11; row <= 11 + settlement.stores.length; row += 1) {
    sheet.getCell(row, 2).numFmt = '#,##0';
    [3, 4, 5].forEach((column) => { sheet.getCell(row, column).numFmt = currencyFormat; });
    sheet.getCell(row, 6).numFmt = '0.0%';
  }
  const cashRow = 14 + settlement.stores.length;
  sheet.mergeCells(`A${cashRow}:B${cashRow}`);
  sheet.getCell(`A${cashRow}`).value = 'CAJA CENTRAL';
  sheet.getCell(`A${cashRow}`).font = { bold: true, color: { argb: COLORS.white } };
  sheet.getCell(`A${cashRow}`).fill = solid(COLORS.ink);
  const cashRows = [
    ['Fondo inicial', settlement.openingCash],
    ['Efectivo vendido', settlement.payments.EFECTIVO],
    ['Efectivo esperado', settlement.expectedCash],
    ['Efectivo contado', settlement.countedCash],
    ['Diferencia', settlement.difference],
  ];
  cashRows.forEach(([label, value], index) => {
    const row = cashRow + index + 1;
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`B${row}`).value = value;
    sheet.getCell(`B${row}`).numFmt = currencyFormat;
    sheet.getCell(`A${row}`).font = { bold: true, color: { argb: COLORS.muted } };
    eachCell(sheet, row, 1, row, 2, (cell) => {
      cell.fill = solid(index % 2 ? COLORS.white : COLORS.cream);
      cell.border = border();
    });
  });
  if (settlement.difference !== 0) sheet.getCell(`B${cashRow + cashRows.length}`).font = { bold: true, color: { argb: COLORS.red } };

  const salesSheet = workbook.addWorksheet('Ventas', { properties: { tabColor: { argb: COLORS.blue } } });
  setCommonSheetOptions(salesSheet);
  styleTitle(salesSheet, `Ventas · ${event.name}`, 'Detalle completo de tickets del evento');
  addSalesTable(salesSheet, sales, 5, 'VentasEventoTable');
  salesSheet.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
  addProductDetailSheet(workbook, sales);
  return workbook.xlsx.writeBuffer();
}

export function downloadWorkbook(buffer, fileName) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  link.download = `${safeName(fileName)}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
