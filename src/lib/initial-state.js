export const INITIAL_STATE = {
  seedVersion: 4,
  settings: {
    businessName: 'Mesa Clara',
    ruc: '20601234567',
    receiptFooter: 'Gracias por su compra. ¡Vuelva pronto!',
    cashier: 'Caja principal',
    currency: 'PEN',
  },
  users: [
    { id: 'user-admin', name: 'Administrador', username: 'admin', password: 'admin123', role: 'admin', storeId: null, active: true },
    { id: 'user-flor', name: 'Flor', username: 'flor', password: 'julio', role: 'cashier', storeId: null, active: true },
  ],
  stores: [
    {
      id: 'store-central',
      name: 'La Cueva del Parrillero',
      address: 'Festival gastronómico',
      phone: '999 000 111',
      color: '#3e805e',
    },
    {
      id: 'store-pueblo',
      name: 'NellyMarket',
      address: 'Festival gastronómico',
      phone: '999 000 222',
      color: '#526fb5',
    },
  ],
  products: [
    { id: 'cueva-bife', storeId: 'store-central', name: '220 gr de bife angosto con chorizo y papas', category: 'Parrillas', sku: 'CUE-001', price: 32, active: true, color: '#f7e1ca' },
    { id: 'cueva-cilindro', storeId: 'store-central', name: 'Chancho/pollo al cilindro a la BBQ y papas', category: 'Cilindro', sku: 'CUE-002', price: 29, active: true, color: '#dcecdf' },
    { id: 'cueva-hamburguesa', storeId: 'store-central', name: 'Hamburguesa de 130 gr, papas hilo y ensalada', category: 'Hamburguesas', sku: 'CUE-003', price: 18, active: true, color: '#dbe5f4' },
    { id: 'cueva-choripan', storeId: 'store-central', name: 'Choripán, papas al hilo y ensalada', category: 'Parrillas', sku: 'CUE-004', price: 15, active: true, color: '#f4dfdd' },
    { id: 'cueva-gaseosa', storeId: 'store-central', name: 'Gaseosa', category: 'Bebidas', sku: 'CUE-005', price: 5, active: true, color: '#e7e3c4' },
    { id: 'cueva-agua', storeId: 'store-central', name: 'Agua', category: 'Bebidas', sku: 'CUE-006', price: 3, active: true, color: '#dbe5f4' },
    { id: 'nelly-energizante', storeId: 'store-pueblo', name: 'Energizante', category: 'Bebidas', sku: 'NEL-001', price: 4, active: true, color: '#dbe5f4' },
    { id: 'nelly-lucky-unidad', storeId: 'store-pueblo', name: 'Cigarro Lucky — unidad', category: 'Cigarros', sku: 'NEL-002', price: 2, active: true, color: '#f7e1ca' },
    { id: 'nelly-lucky-caja', storeId: 'store-pueblo', name: 'Cigarro Lucky — caja', category: 'Cigarros', sku: 'NEL-003', price: 20, active: true, color: '#f4dfdd' },
  ],
  sessions: [],
  sales: [],
  events: [],
};

export const createInitialState = () => structuredClone(INITIAL_STATE);
