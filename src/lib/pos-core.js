export const money = (value) =>
  new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);

export const cartSubtotal = (cart) =>
  cart.reduce((total, item) => total + item.price * item.qty, 0);

export const cartCount = (cart) =>
  cart.reduce((total, item) => total + item.qty, 0);

export function addToCart(cart, product) {
  const existing = cart.find((item) => item.productId === product.id);
  if (existing) {
    return cart.map((item) =>
      item.productId === product.id ? { ...item, qty: item.qty + 1 } : item,
    );
  }
  return [
    ...cart,
    {
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      qty: 1,
      note: '',
    },
  ];
}

export function updateCartQty(cart, productId, delta) {
  return cart
    .map((item) =>
      item.productId === productId
        ? { ...item, qty: Math.max(0, item.qty + delta) }
        : item,
    )
    .filter((item) => item.qty > 0);
}

export function calculateChange(total, received) {
  return Math.max(0, Number(received || 0) - Number(total || 0));
}

export function authenticateUser(users, username, password) {
  const normalized = String(username || '').trim().toLowerCase();
  return users.find((user) => user.active && user.username.toLowerCase() === normalized && user.password === String(password || '')) || null;
}

export function sessionSummary(session, sales) {
  const sessionSales = sales.filter((sale) => sale.sessionId === session?.id);
  const totals = { EFECTIVO: 0, YAPE: 0 };
  for (const sale of sessionSales) {
    totals[sale.payment] = (totals[sale.payment] || 0) + sale.total;
  }
  return {
    count: sessionSales.length,
    salesTotal: sessionSales.reduce((sum, sale) => sum + sale.total, 0),
    expectedCash: Number(session?.openingAmount || 0) + totals.EFECTIVO,
    payments: totals,
  };
}

export function eventSettlement(event, stores, sessions, sales) {
  const eventSessions = sessions.filter((session) => session.eventId === event?.id);
  const eventSales = sales.filter((sale) => sale.eventId === event?.id);
  const rows = stores.map((store) => {
    const storeSales = eventSales.filter((sale) => sale.storeId === store.id);
    const payments = { EFECTIVO: 0, YAPE: 0 };
    for (const sale of storeSales) payments[sale.payment] = (payments[sale.payment] || 0) + sale.total;
    return {
      storeId: store.id,
      storeName: store.name,
      saleCount: storeSales.length,
      salesTotal: storeSales.reduce((sum, sale) => sum + sale.total, 0),
      payments,
    };
  });
  const openingCash = eventSessions.reduce((sum, session) => sum + Number(session.openingAmount || 0), 0);
  const countedCash = eventSessions
    .filter((session) => session.closedAt)
    .reduce((sum, session) => sum + Number(session.closingAmount || 0), 0);
  const cashSales = rows.reduce((sum, row) => sum + row.payments.EFECTIVO, 0);
  const expectedCash = openingCash + cashSales;
  return {
    centralizedCash: true,
    stores: rows,
    saleCount: rows.reduce((sum, row) => sum + row.saleCount, 0),
    salesTotal: rows.reduce((sum, row) => sum + row.salesTotal, 0),
    openingCash,
    expectedCash,
    countedCash,
    difference: countedCash - expectedCash,
    openRegisters: eventSessions.filter((session) => !session.closedAt).length,
    payments: {
      EFECTIVO: rows.reduce((sum, row) => sum + row.payments.EFECTIVO, 0),
      YAPE: rows.reduce((sum, row) => sum + row.payments.YAPE, 0),
    },
  };
}
