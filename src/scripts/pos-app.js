import {
  addToCart,
  calculateChange,
  cartCount,
  cartSubtotal,
  eventSettlement,
  money,
  sessionSummary,
  updateCartQty,
} from '../lib/pos-core.js';
import { INITIAL_STATE } from '../lib/initial-state.js';

const STORAGE_KEY = 'mesa-clara-pos-v1';
const SESSION_KEY = 'mesa-clara-current-user';
const AUTH_KEY = 'mesa-clara-auth-token';
const palette = ['#3e805e', '#d47a4c', '#526fb5', '#9a624f', '#7c67a9', '#b49338'];
const productColors = ['#dcecdf', '#f7e1ca', '#dbe5f4', '#eadcf0', '#f4dfdd', '#e7e3c4'];

const initialState = INITIAL_STATE;

let state = loadState();
let authToken = sessionStorage.getItem(AUTH_KEY) || '';
let currentUser = authToken ? state.users.find((user) => user.id === sessionStorage.getItem(SESSION_KEY) && user.active) || null : null;
let selectedStoreId = state.stores[0]?.id || '';
let cart = [];
let selectedCategory = 'Todos';
let paymentMethod = 'EFECTIVO';
let isAdmin = currentUser?.role === 'admin';
let toastTimer;
let remoteRevision = 0;
let remoteEnabled = false;
let syncReady = false;
let pendingWrites = 0;
let mutationNumber = 0;
let localDirty = false;
let saveChain = Promise.resolve();
let remoteBaseState = structuredClone(state);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const currentStore = () => state.stores.find((store) => store.id === selectedStoreId);
const currentEvent = () => state.events.find((event) => !event.closedAt);
const currentSession = () => state.sessions.find((session) => session.eventId === currentEvent()?.id && !session.closedAt);
const storeProducts = () => state.products.filter((product) => product.storeId === selectedStoreId);
const activeSales = () => state.sales.filter((sale) => !sale.excludedAt);
const storeSales = () => activeSales().filter((sale) => sale.storeId === selectedStoreId && (currentUser?.role === 'admin' || sale.userId === currentUser?.id));
const formatDate = (date) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.stores?.length) {
      const loaded = { ...structuredClone(initialState), ...stored, events: stored.events || [], users: stored.users?.length ? stored.users : structuredClone(initialState.users) };
      let dirty = false;
      loaded.users.forEach((user) => {
        if (user.role === 'cashier' && user.storeId !== null) { user.storeId = null; dirty = true; }
      });
      if (Number(stored.seedVersion || 0) < 2) {
        const qaStoreIds = loaded.stores.filter((store) => store.name === 'Tienda Evento QA').map((store) => store.id);
        loaded.stores = loaded.stores.filter((store) => !qaStoreIds.includes(store.id));
        loaded.products = loaded.products.filter((product) => product.storeId !== 'store-central' && !qaStoreIds.includes(product.storeId));
        loaded.users = loaded.users.filter((user) => user.username !== 'rosa');
        const cueva = loaded.stores.find((store) => store.id === 'store-central');
        if (cueva) Object.assign(cueva, structuredClone(initialState.stores.find((store) => store.id === 'store-central')));
        loaded.products.push(...structuredClone(initialState.products.filter((product) => product.storeId === 'store-central')));
        loaded.seedVersion = 2;
        dirty = true;
      }
      if (Number(stored.seedVersion || 0) < 3) {
        const nelly = loaded.stores.find((store) => store.id === 'store-pueblo');
        if (nelly) Object.assign(nelly, structuredClone(initialState.stores.find((store) => store.id === 'store-pueblo')));
        loaded.products = loaded.products.filter((product) => product.storeId !== 'store-pueblo');
        loaded.products.push(...structuredClone(initialState.products.filter((product) => product.storeId === 'store-pueblo')));
        loaded.seedVersion = 3;
        dirty = true;
      }
      if (Number(stored.seedVersion || 0) < 4) {
        const cigaretteProducts = initialState.products.filter((product) => product.id.startsWith('nelly-lucky-'));
        cigaretteProducts.forEach((product) => {
          if (!loaded.products.some((item) => item.id === product.id)) loaded.products.push(structuredClone(product));
        });
        loaded.seedVersion = 4;
        dirty = true;
      }
      const legacyRecords = [...loaded.sessions, ...loaded.sales].filter((record) => !record.eventId);
      if (legacyRecords.length) {
        const legacyId = 'event-migrated';
        const hasOpenRegister = loaded.sessions.some((session) => !session.eventId && !session.closedAt);
        if (!loaded.events.some((event) => event.id === legacyId)) {
          loaded.events.push({
            id: legacyId,
            name: 'Evento anterior',
            openedAt: legacyRecords.map((record) => record.openedAt || record.createdAt).filter(Boolean).sort()[0] || new Date().toISOString(),
            closedAt: hasOpenRegister ? null : new Date().toISOString(),
            status: hasOpenRegister ? 'active' : 'closed',
          });
        }
        legacyRecords.forEach((record) => { record.eventId = legacyId; });
        dirty = true;
      }
      if (dirty) localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
      return loaded;
    }
  } catch (error) {
    console.warn('No se pudo leer la data guardada:', error);
  }
  return structuredClone(initialState);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  mutationNumber += 1;
  localDirty = true;
  if (syncReady) queueRemoteSave();
}

function setSyncStatus(text, mode = 'online') {
  const status = $('#sync-status');
  if (!status) return;
  status.dataset.mode = mode;
  const label = status.querySelector('[data-sync-label]');
  if (label) label.textContent = text;
}

function remoteState(value) {
  return {
    ...structuredClone(initialState),
    ...value,
    settings: { ...structuredClone(initialState.settings), ...(value?.settings || {}) },
    users: Array.isArray(value?.users) ? value.users : structuredClone(initialState.users),
    stores: Array.isArray(value?.stores) ? value.stores : structuredClone(initialState.stores),
    products: Array.isArray(value?.products) ? value.products : structuredClone(initialState.products),
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    sales: Array.isArray(value?.sales) ? value.sales : [],
    events: Array.isArray(value?.events) ? value.events : [],
  };
}

function applyRemoteState(payload, authenticatedUser = null) {
  state = remoteState(payload.state);
  remoteRevision = Number(payload.revision || 0);
  remoteBaseState = structuredClone(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const userId = authenticatedUser?.id || sessionStorage.getItem(SESSION_KEY);
  currentUser = state.users.find((user) => user.id === userId && user.active) || authenticatedUser || null;
  isAdmin = currentUser?.role === 'admin';
  if (!state.stores.some((store) => store.id === selectedStoreId)) selectedStoreId = state.stores[0]?.id || '';
}

async function apiRequest(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(path, { cache: 'no-store', ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `API ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function fetchSharedState() {
  return apiRequest('/api/state');
}

function mergeConcurrentState(baseValue, localValue, remoteValue) {
  const base = remoteState(baseValue);
  const local = remoteState(localValue);
  const remote = remoteState(remoteValue);
  const merged = structuredClone(remote);
  if (JSON.stringify(local.settings) !== JSON.stringify(base.settings)) merged.settings = structuredClone(local.settings);
  ['users', 'stores', 'products', 'sessions', 'sales', 'events'].forEach((key) => {
    const baseMap = new Map(base[key].map((item) => [item.id, item]));
    const localMap = new Map(local[key].map((item) => [item.id, item]));
    const mergedMap = new Map(remote[key].map((item) => [item.id, item]));
    baseMap.forEach((_item, id) => { if (!localMap.has(id)) mergedMap.delete(id); });
    localMap.forEach((item, id) => {
      if (!baseMap.has(id) || JSON.stringify(item) !== JSON.stringify(baseMap.get(id))) mergedMap.set(id, structuredClone(item));
    });
    merged[key] = [...mergedMap.values()];
  });
  return merged;
}

async function pushSharedState(snapshot, savedMutation) {
  let savedState = snapshot;
  let expectedRevision = remoteRevision;
  let payload;
  try {
    payload = await apiRequest('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: savedState, expectedRevision }),
    });
  } catch (error) {
    if (error.status !== 409 || !error.payload?.state) throw error;
    const latest = error.payload;
    savedState = mergeConcurrentState(remoteBaseState, snapshot, latest.state);
    expectedRevision = Number(latest.revision);
    payload = await apiRequest('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: savedState, expectedRevision }),
    });
    if (savedMutation === mutationNumber) state = remoteState(savedState);
    else state = mergeConcurrentState(snapshot, state, savedState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  }
  remoteRevision = Number(payload.revision || remoteRevision);
  remoteBaseState = remoteState(savedState);
  remoteEnabled = true;
  if (savedMutation === mutationNumber) localDirty = false;
  setSyncStatus('Base compartida conectada', 'online');
}

function queueRemoteSave() {
  const snapshot = structuredClone(state);
  const savedMutation = mutationNumber;
  pendingWrites += 1;
  setSyncStatus('Guardando en red…', 'saving');
  saveChain = saveChain
    .then(() => pushSharedState(snapshot, savedMutation))
    .catch((error) => {
      remoteEnabled = false;
      console.warn('No se pudo guardar en la base compartida:', error);
      setSyncStatus('Sin red · copia local', 'offline');
    })
    .finally(() => { pendingWrites -= 1; });
}

async function connectSharedState() {
  setSyncStatus('Conectando base…', 'saving');
  if (!authToken) {
    currentUser = null;
    isAdmin = false;
    syncReady = true;
    setSyncStatus('Servidor local · inicia sesión', 'online');
    return;
  }
  try {
    const payload = await fetchSharedState();
    applyRemoteState(payload);
    remoteEnabled = true;
    localDirty = false;
    setSyncStatus('Base compartida conectada', 'online');
  } catch (error) {
    if (error.status === 401) {
      authToken = '';
      currentUser = null;
      isAdmin = false;
      sessionStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      setSyncStatus('Sesión vencida · ingresa otra vez', 'offline');
    } else {
      console.warn('Base compartida no disponible; se usará copia local:', error);
      setSyncStatus('Sin red · copia local', 'offline');
    }
  } finally {
    syncReady = true;
  }
}

async function pollSharedState() {
  if (!syncReady || pendingWrites || document.hidden) return;
  if (localDirty) {
    queueRemoteSave();
    return;
  }
  try {
    const payload = await fetchSharedState();
    remoteEnabled = true;
    setSyncStatus('Base compartida conectada', 'online');
    if (Number(payload.revision || 0) <= remoteRevision) return;
    applyRemoteState(payload);
    renderAll();
    if (!currentUser) openLoginModal();
  } catch (error) {
    if (error.status === 401) {
      authToken = '';
      currentUser = null;
      isAdmin = false;
      sessionStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      renderAll();
      openLoginModal();
      return setSyncStatus('Sesión vencida · ingresa otra vez', 'offline');
    }
    if (remoteEnabled) console.warn('Se perdió conexión con la base compartida:', error);
    remoteEnabled = false;
    setSyncStatus('Sin red · copia local', 'offline');
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setModal(content) {
  const root = $('#modal-root');
  root.innerHTML = content;
  $$('[data-close-modal]', root).forEach((button) => button.addEventListener('click', closeModal));
  root.onclick = (event) => {
    if (event.target === root) closeModal();
  };
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function renderAll() {
  renderStoreSelect();
  renderEventStatus();
  renderCashStatus();
  renderCatalog();
  renderAdminState();
  renderCart();
  renderProductsTable();
  renderStores();
  renderHistory();
  renderEvents();
  renderUsers();
  renderSettings();
  $$('[data-current-store]').forEach((element) => { element.textContent = currentStore()?.name || 'Sin tienda'; });
}

function renderStoreSelect() {
  const select = $('#store-select');
  const stores = state.stores;
  if (!stores.some((store) => store.id === selectedStoreId)) selectedStoreId = stores[0]?.id || state.stores[0]?.id || '';
  select.innerHTML = stores.map((store) => `<option value="${store.id}" ${store.id === selectedStoreId ? 'selected' : ''}>${esc(store.name)}</option>`).join('');
  select.disabled = !currentUser;
}

function renderAdminState() {
  const button = $('#admin-session');
  button.classList.toggle('active', isAdmin);
  button.querySelector('strong').textContent = currentUser?.name || 'Sin sesión';
  button.querySelector('small').textContent = currentUser ? `${isAdmin ? 'Administrador' : 'Cajero'} · Cerrar sesión` : 'Iniciar sesión';
  $('#admin-nav-label').hidden = !isAdmin;
  $$('[data-admin-view]').forEach((item) => {
    item.hidden = !isAdmin;
    item.classList.toggle('unlocked', isAdmin);
    item.querySelector('small').textContent = '✓';
  });
  $$('[data-open-product]').forEach((button) => { button.hidden = !isAdmin; });
}

function renderEventStatus() {
  const event = currentEvent();
  const button = $('#event-status');
  button.classList.toggle('inactive', !event);
  button.lastElementChild.textContent = event ? event.name : 'Sin evento';
}

function renderCashStatus() {
  const button = $('#cash-status');
  const session = currentSession();
  button.classList.toggle('closed', !session);
  button.lastElementChild.textContent = session ? `Caja abierta · ${session.cashier}` : 'Caja cerrada';
  const canManage = currentUser?.role === 'cashier' || (currentUser?.role === 'admin' && Boolean(session));
  button.disabled = !canManage;
  button.title = session ? 'Cerrar caja central' : currentUser?.role === 'cashier' ? 'Abrir caja central' : 'Solo cajera puede abrir caja';
}

function renderEvents() {
  const event = currentEvent();
  const action = $('#event-primary-action');
  action.textContent = event ? 'Cerrar evento y cuadrar' : '＋ Iniciar evento';
  action.classList.toggle('danger-action', Boolean(event));

  if (!event) {
    $('#active-event-panel').innerHTML = `
      <div class="event-empty">
        <span>◇</span><div><h3>No hay evento activo</h3><p>Inicia evento antes de abrir cajas y registrar ventas.</p></div>
        <button class="primary-btn fit" data-start-event type="button">＋ Iniciar evento</button>
      </div>`;
  } else {
    const settlement = eventSettlement(event, state.stores, state.sessions, activeSales());
    $('#active-event-panel').innerHTML = `
      <div class="event-hero">
        <div><p class="eyebrow">Evento activo</p><h3>${esc(event.name)}</h3><p>Inició ${formatDate(event.openedAt)} · ${settlement.saleCount} ventas</p></div>
        <div class="event-total"><span>VENTA TOTAL</span><strong>${money(settlement.salesTotal)}</strong></div>
      </div>
      <div class="stats-grid event-stats">
        <div class="stat-card"><span>EFECTIVO</span><strong>${money(settlement.payments.EFECTIVO)}</strong></div>
        <div class="stat-card"><span>YAPE</span><strong>${money(settlement.payments.YAPE)}</strong></div>
        <div class="stat-card"><span>FONDO INICIAL</span><strong>${money(settlement.openingCash)}</strong></div>
        <div class="stat-card"><span>EFECTIVO ESPERADO</span><strong>${money(settlement.expectedCash)}</strong></div>
        <div class="stat-card ${settlement.openRegisters ? 'warning-stat' : ''}"><span>CAJA CENTRAL</span><strong>${settlement.openRegisters ? 'Abierta' : 'Cerrada'}</strong></div>
      </div>
      <div class="data-card event-stores-card">
        <div class="table-tools"><strong>Cuadre provisional por tienda</strong><span class="soft-label">Actualización automática</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Tienda</th><th>Venta total</th><th>Tickets</th><th>Efectivo</th><th>Yape</th><th>% del evento</th></tr></thead>
          <tbody>${settlement.stores.map((row) => `
            <tr><td><strong>${esc(row.storeName)}</strong></td><td><strong>${money(row.salesTotal)}</strong></td><td>${row.saleCount}</td><td>${money(row.payments.EFECTIVO)}</td><td>${money(row.payments.YAPE)}</td><td>${settlement.salesTotal ? ((row.salesTotal / settlement.salesTotal) * 100).toFixed(1) : '0.0'}%</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  $$('[data-start-event]').forEach((button) => button.addEventListener('click', openStartEventModal));
  const closedEvents = state.events.filter((item) => item.closedAt).sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
  $('#events-history-table').innerHTML = closedEvents.length ? closedEvents.map((item) => {
    const settlement = item.settlement || eventSettlement(item, state.stores, state.sessions, activeSales());
    return `<tr><td><strong>${esc(item.name)}</strong></td><td>${formatDate(item.openedAt)}</td><td>${formatDate(item.closedAt)}</td><td>${settlement.stores.length}</td><td>${settlement.saleCount}</td><td><strong>${money(settlement.salesTotal)}</strong></td><td><div class="row-actions"><button data-view-settlement="${item.id}" type="button" title="Ver cuadre">⌑</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state">Aún no existen eventos cerrados.</div></td></tr>';
  $$('[data-view-settlement]').forEach((button) => button.addEventListener('click', () => {
    const selected = state.events.find((item) => item.id === button.dataset.viewSettlement);
    if (selected) openSettlementModal(selected);
  }));
}

function renderUsers() {
  $('#users-count').textContent = `${state.users.length} usuario${state.users.length === 1 ? '' : 's'}`;
  $('#users-table').innerHTML = state.users.map((user) => {
    const isCashier = user.role === 'cashier';
    return `<tr>
      <td class="product-cell"><strong>${esc(user.name)}</strong><small>${isCashier ? 'Operador de caja' : 'Control total'}</small></td>
      <td><strong>${esc(user.username)}</strong></td><td><span class="badge ${isCashier ? '' : 'admin-badge'}">${isCashier ? 'Cajero' : 'Admin'}</span></td>
      <td>${isCashier ? 'Todos los locales' : 'Administración'}</td><td><span class="badge ${user.active ? '' : 'off'}">${user.active ? 'Activo' : 'Bloqueado'}</span></td>
      <td><div class="row-actions">${isCashier ? `<button data-toggle-user="${user.id}" type="button" title="${user.active ? 'Bloquear' : 'Activar'}">${user.active ? '◉' : '○'}</button><button data-edit-user="${user.id}" type="button" title="Editar">✎</button><button data-delete-user="${user.id}" type="button" title="Eliminar">×</button>` : ''}</div></td>
    </tr>`;
  }).join('');
  $$('[data-toggle-user]').forEach((button) => button.addEventListener('click', () => {
    const user = state.users.find((item) => item.id === button.dataset.toggleUser);
    if (state.sessions.some((session) => session.userId === user.id && !session.closedAt)) return showToast('Cierra caja del cajero antes de bloquearlo');
    user.active = !user.active;
    saveState();
    renderUsers();
  }));
  $$('[data-edit-user]').forEach((button) => button.addEventListener('click', () => openUserModal(button.dataset.editUser)));
  $$('[data-delete-user]').forEach((button) => button.addEventListener('click', () => deleteUser(button.dataset.deleteUser)));
}

function openUserModal(userId) {
  const user = state.users.find((item) => item.id === userId);
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>${user ? 'Editar cajero' : 'Nuevo cajero'}</h2><p>Acceso simple para abrir caja y vender.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="user-form">
      <div class="modal-body form-grid">
        <label class="field full">Nombre del cajero<input name="name" required maxlength="60" value="${esc(user?.name || '')}" placeholder="Ej. Flor" autofocus /></label>
        <label class="field">Usuario<input name="username" required maxlength="30" value="${esc(user?.username || '')}" placeholder="flor" autocomplete="off" /></label>
        <label class="field">Clave<input name="password" type="password" ${user ? '' : 'required'} maxlength="40" placeholder="${user ? 'Dejar vacío para conservar' : 'julio'}" autocomplete="new-password" /></label>
        <div class="event-start-info full"><span>⌂</span><div><strong>Acceso a todas las tiendas</strong><small>Cajero elige tienda antes de cada venta. Cada cobro genera ticket separado.</small></div></div>
        <p id="user-form-error" class="form-error full" hidden></p>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cancelar</button><button class="primary-btn" type="submit">${user ? 'Guardar cambios' : 'Crear cajero'}</button></div>
    </form>
  </div>`);
  $('#user-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const username = data.username.trim().toLowerCase();
    const duplicate = state.users.some((item) => item.id !== user?.id && item.username.toLowerCase() === username);
    if (duplicate) {
      $('#user-form-error').textContent = 'Usuario ya existe.';
      $('#user-form-error').hidden = false;
      return;
    }
    const next = { name: data.name.trim(), username, storeId: null };
    if (data.password) next.password = data.password;
    if (user) Object.assign(user, next);
    else state.users.push({ id: uid('user'), role: 'cashier', active: true, password: data.password, ...next });
    saveState();
    closeModal();
    renderAll();
    showToast(user ? 'Cajero actualizado' : 'Cajero creado');
  });
}

function deleteUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.role === 'admin') return;
  if (state.sessions.some((session) => session.userId === user.id && !session.closedAt)) return showToast('Cierra caja del cajero antes de eliminarlo');
  if (!window.confirm(`Eliminar acceso de “${user.name}”? Ventas anteriores se conservarán.`)) return;
  state.users = state.users.filter((item) => item.id !== userId);
  saveState();
  renderAll();
  showToast('Cajero eliminado');
}

function renderCatalog() {
  const products = storeProducts().filter((product) => product.active);
  const categories = ['Todos', ...new Set(products.map((product) => product.category))];
  if (!categories.includes(selectedCategory)) selectedCategory = 'Todos';
  $('#category-tabs').innerHTML = categories.map((category) => `<button class="category-tab ${selectedCategory === category ? 'active' : ''}" data-category="${esc(category)}" type="button">${esc(category)}</button>`).join('');
  $$('.category-tab').forEach((button) => button.addEventListener('click', () => {
    selectedCategory = button.dataset.category;
    renderCatalog();
  }));

  const query = $('#product-search').value.trim().toLowerCase();
  const filtered = products.filter((product) =>
    (selectedCategory === 'Todos' || product.category === selectedCategory)
    && `${product.name} ${product.sku}`.toLowerCase().includes(query),
  );
  $('#catalog-title').textContent = selectedCategory === 'Todos' ? 'Todos los productos' : selectedCategory;
  $('#catalog-count').textContent = `${filtered.length} producto${filtered.length === 1 ? '' : 's'} disponible${filtered.length === 1 ? '' : 's'}`;
  $('#product-grid').innerHTML = filtered.length ? filtered.map((product) => `
    <button class="product-card" type="button" data-product-id="${product.id}" style="--product-color:${product.color || '#dcecdf'}">
      <span class="product-category">${esc(product.category)}</span>
      <strong>${esc(product.name)}</strong>
      <footer><span class="price">${money(product.price)}</span><span class="plus-badge">＋</span></footer>
    </button>
  `).join('') : `
    <div class="empty-state">
      <span class="empty-icon">□</span>
      <strong>No hay productos aquí</strong>
      <p>Agrega uno nuevo o cambia el filtro.</p>
      <button class="primary-btn fit" data-open-product type="button">＋ Crear producto</button>
    </div>`;
  $$('.product-card').forEach((button) => button.addEventListener('click', () => {
    const product = state.products.find((item) => item.id === button.dataset.productId);
    if (!product) return;
    cart = addToCart(cart, product);
    renderCart();
  }));
  bindOpenProductButtons($('#view-pos'));
}

function renderCart() {
  const container = $('#cart-items');
  if (!cart.length) {
    container.innerHTML = '<div class="cart-empty"><span>♨</span><strong>Pedido vacío</strong><p>Toca un producto para agregarlo.</p></div>';
  } else {
    container.innerHTML = cart.map((item) => `
      <article class="cart-item">
        <div>
          <div class="cart-item-name">${esc(item.name)}</div>
          <div class="cart-item-price">${money(item.price)} c/u</div>
          <div class="qty-control">
            <button data-qty="-1" data-product-id="${item.productId}" type="button" aria-label="Quitar una unidad">−</button>
            <span>${item.qty}</span>
            <button data-qty="1" data-product-id="${item.productId}" type="button" aria-label="Agregar una unidad">＋</button>
          </div>
        </div>
        <div class="cart-line-total">${money(item.price * item.qty)}</div>
      </article>`).join('');
  }
  $$('[data-qty]', container).forEach((button) => button.addEventListener('click', () => {
    cart = updateCartQty(cart, button.dataset.productId, Number(button.dataset.qty));
    renderCart();
  }));
  const total = cartSubtotal(cart);
  $('#cart-subtotal').textContent = money(total);
  $('#cart-total').textContent = money(total);
  $('#checkout-total').textContent = money(total);
  $('#checkout-btn').disabled = cartCount(cart) === 0;
}

function renderProductsTable() {
  const query = $('#admin-product-search').value.trim().toLowerCase();
  const products = storeProducts().filter((product) => `${product.name} ${product.category} ${product.sku}`.toLowerCase().includes(query));
  $('#admin-product-count').textContent = `${products.length} producto${products.length === 1 ? '' : 's'}`;
  $('#products-table').innerHTML = products.length ? products.map((product) => `
    <tr>
      <td class="product-cell"><strong>${esc(product.name)}</strong><small>${money(product.price)}</small></td>
      <td>${esc(product.category)}</td>
      <td>${esc(product.sku || '—')}</td>
      <td><strong>${money(product.price)}</strong></td>
      <td><span class="badge ${product.active ? '' : 'off'}">${product.active ? 'Activo' : 'Oculto'}</span></td>
      <td><div class="row-actions">
        <button data-toggle-product="${product.id}" type="button" title="${product.active ? 'Ocultar' : 'Activar'}">${product.active ? '◉' : '○'}</button>
        <button data-edit-product="${product.id}" type="button" title="Editar">✎</button>
        <button data-delete-product="${product.id}" type="button" title="Eliminar">×</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No se encontraron productos.</div></td></tr>';

  $$('[data-toggle-product]').forEach((button) => button.addEventListener('click', () => {
    const product = state.products.find((item) => item.id === button.dataset.toggleProduct);
    product.active = !product.active;
    saveState();
    renderAll();
  }));
  $$('[data-edit-product]').forEach((button) => button.addEventListener('click', () => openProductModal(button.dataset.editProduct)));
  $$('[data-delete-product]').forEach((button) => button.addEventListener('click', () => deleteProduct(button.dataset.deleteProduct)));
}

function renderStores() {
  $('#stores-grid').innerHTML = state.stores.map((store) => {
    const products = state.products.filter((product) => product.storeId === store.id).length;
    const sales = activeSales().filter((sale) => sale.storeId === store.id);
    const total = sales.reduce((sum, sale) => sum + sale.total, 0);
    return `<article class="store-card" style="--store-color:${store.color}">
      <div class="store-card-head"><span class="store-icon">⌂</span><div><h3>${esc(store.name)}</h3><p>${esc(store.address || 'Sin dirección')}</p></div></div>
      <div class="store-metrics"><div><span>PRODUCTOS</span><strong>${products}</strong></div><div><span>VENTAS</span><strong>${money(total)}</strong></div></div>
      <div class="store-card-actions">
        <button data-enter-store="${store.id}" type="button">Usar tienda</button>
        <button data-edit-store="${store.id}" type="button">Editar</button>
        <button data-delete-store="${store.id}" type="button">Eliminar</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-enter-store]').forEach((button) => button.addEventListener('click', () => {
    switchStore(button.dataset.enterStore);
    switchView('pos');
  }));
  $$('[data-edit-store]').forEach((button) => button.addEventListener('click', () => openStoreModal(button.dataset.editStore)));
  $$('[data-delete-store]').forEach((button) => button.addEventListener('click', () => deleteStore(button.dataset.deleteStore)));
}

function renderHistory() {
  const sales = [...storeSales()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = sales.reduce((sum, sale) => sum + sale.total, 0);
  const cash = sales.filter((sale) => sale.payment === 'EFECTIVO').reduce((sum, sale) => sum + sale.total, 0);
  const yape = sales.filter((sale) => sale.payment === 'YAPE').reduce((sum, sale) => sum + sale.total, 0);
  $('#history-stats').innerHTML = `
    <div class="stat-card"><span>VENTAS REGISTRADAS</span><strong>${sales.length}</strong></div>
    <div class="stat-card"><span>VENTA ACUMULADA</span><strong>${money(total)}</strong></div>
    <div class="stat-card payment-stat cash-stat"><span>EFECTIVO</span><strong>${money(cash)}</strong><small>${total ? ((cash / total) * 100).toFixed(1) : '0.0'}% del total</small></div>
    <div class="stat-card payment-stat yape-stat"><span>YAPE</span><strong>${money(yape)}</strong><small>${total ? ((yape / total) * 100).toFixed(1) : '0.0'}% del total</small></div>`;
  $('#history-table').innerHTML = sales.length ? sales.map((sale) => `
    <tr>
      <td><strong>#${esc(sale.number)}</strong></td><td>${formatDate(sale.createdAt)}</td>
      <td>${esc(sale.customer || 'Cliente general')}</td><td><span class="badge">${esc(sale.payment)}</span></td>
      <td>${sale.items.reduce((sum, item) => sum + item.qty, 0)}</td><td><strong>${money(sale.total)}</strong></td>
      <td><div class="row-actions"><button data-reprint="${sale.id}" type="button" title="Imprimir">⌑</button></div></td>
    </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">Aún no hay ventas en esta tienda.</div></td></tr>';
  $$('[data-reprint]').forEach((button) => button.addEventListener('click', () => {
    const sale = state.sales.find((item) => item.id === button.dataset.reprint);
    if (sale) openTicketModal(sale);
  }));
}

function renderSettings() {
  const form = $('#settings-form');
  Object.entries(state.settings).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function switchView(view) {
  const titles = {
    pos: ['Punto de venta', 'Nueva venta'], events: ['Administración', 'Evento y cuadre'], users: ['Administración', 'Cajeros'], products: ['Administración', 'Productos'], stores: ['Administración', 'Tiendas'], history: ['Reportes', 'Historial'], settings: ['Configuración', 'Ajustes'],
  };
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#view-eyebrow').textContent = titles[view][0];
  $('#view-title').textContent = titles[view][1];
  $('.sidebar').classList.remove('open');
  if (view === 'products') renderProductsTable();
  if (view === 'history') renderHistory();
  if (view === 'events') renderEvents();
}

function requestView(view) {
  const adminViews = ['events', 'users', 'products', 'stores', 'settings'];
  if (adminViews.includes(view) && !isAdmin) return showToast('Acceso exclusivo para administrador');
  switchView(view);
}

function openLoginModal() {
  setModal(`<div class="modal login-screen">
    <section class="login-showcase">
      <div class="login-brand"><span class="brand-mark">M</span><span><strong>Mesa Clara</strong><small>Festival POS</small></span></div>
      <div><p class="eyebrow">Caja central del festival</p><h2>Una caja.<br/>Cada tienda, su ticket.</h2><p>Ventas separadas por negocio, vuelto automático y cuadre final consolidado.</p></div>
      <div class="login-stores">${state.stores.map((store) => `<span>⌂ ${esc(store.name)}</span>`).join('')}</div>
    </section>
    <section class="login-panel">
      <div class="login-heading"><div class="admin-symbol">♙</div><h2>Iniciar sesión</h2><p>Ingresa con cuenta Admin o Cajera.</p></div>
      <form id="login-form">
        <div class="login-fields">
          <label class="field">Usuario<input name="username" maxlength="30" autocomplete="username" required autofocus /></label>
          <label class="field">Clave<input name="password" type="password" maxlength="40" autocomplete="current-password" required /></label>
        </div>
        <p id="login-error" class="form-error" hidden>Usuario o clave incorrectos.</p>
        <button class="primary-btn login-submit" type="submit">Ingresar al sistema</button>
      </form>
      <div class="login-demos"><p><strong>Acceso privado</strong><span>Usa credenciales entregadas por administración.</span></p></div>
      <p class="login-security">🔒 Cerrar sesión no cierra caja central.</p>
    </section>
  </div>`);
  $('#modal-root').onclick = null;
  $('#modal-root').dataset.locked = 'true';
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Ingresando…';
    try {
      const payload = await apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: data.username, password: data.password }),
      });
      authToken = payload.token;
      sessionStorage.setItem(AUTH_KEY, authToken);
      sessionStorage.setItem(SESSION_KEY, payload.currentUser.id);
      applyRemoteState(payload, payload.currentUser);
      remoteEnabled = true;
      localDirty = false;
      currentUser = payload.currentUser;
      isAdmin = currentUser.role === 'admin';
      if (!state.stores.some((store) => store.id === selectedStoreId)) selectedStoreId = state.stores[0]?.id || '';
      delete $('#modal-root').dataset.locked;
      closeModal();
      cart = [];
      renderAll();
      switchView(isAdmin ? 'events' : 'pos');
      setSyncStatus('Base compartida conectada', 'online');
      showToast(`Sesión iniciada: ${currentUser.name}`);
    } catch (error) {
      console.warn('Inicio de sesión rechazado:', error);
      $('#login-error').hidden = false;
      $('#login-error').textContent = error.message || 'Usuario o clave incorrectos.';
      event.currentTarget.elements.password.select();
      submit.disabled = false;
      submit.textContent = 'Ingresar al sistema';
    }
  });
}

async function logoutUser() {
  if (!currentUser) return openLoginModal();
  try { await apiRequest('/api/logout', { method: 'POST' }); } catch {}
  currentUser = null;
  isAdmin = false;
  cart = [];
  authToken = '';
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  setSyncStatus('Servidor local · inicia sesión', 'online');
  renderAll();
  switchView('pos');
  openLoginModal();
}

function switchStore(storeId) {
  if (storeId === selectedStoreId) return;
  if (cart.length) {
    $('#store-select').value = selectedStoreId;
    return showToast('Cobra o limpia pedido antes de cambiar de tienda');
  }
  selectedStoreId = storeId;
  selectedCategory = 'Todos';
  $('#product-search').value = '';
  $('#customer-name').value = '';
  renderAll();
}

function bindOpenProductButtons(root = document) {
  $$('[data-open-product]', root).forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      if (!isAdmin) return showToast('Solo administrador puede crear productos');
      openProductModal();
    });
  });
}

function openProductModal(productId) {
  const product = state.products.find((item) => item.id === productId);
  const categories = [...new Set(storeProducts().map((item) => item.category))];
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>${product ? 'Editar producto' : 'Nuevo producto'}</h2><p>${esc(currentStore()?.name)}</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="product-form">
      <div class="modal-body form-grid">
        <label class="field full">Nombre<input name="name" required maxlength="80" value="${esc(product?.name || '')}" autofocus /></label>
        <label class="field">Categoría<input name="category" list="category-list" required maxlength="40" value="${esc(product?.category || '')}" /><datalist id="category-list">${categories.map((category) => `<option value="${esc(category)}">`).join('')}</datalist></label>
        <label class="field">Código / SKU<input name="sku" maxlength="30" value="${esc(product?.sku || '')}" /></label>
        <label class="field">Precio (S/)<input name="price" type="number" min="0.01" step="0.01" required value="${product?.price || ''}" /></label>
        <label class="field">Color<select name="color">${productColors.map((color, index) => `<option value="${color}" ${product?.color === color ? 'selected' : ''}>Color ${index + 1}</option>`).join('')}</select></label>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cancelar</button><button class="primary-btn" type="submit">${product ? 'Guardar cambios' : 'Crear producto'}</button></div>
    </form>
  </div>`);
  $('#product-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const next = { name: data.name.trim(), category: data.category.trim(), sku: data.sku.trim(), price: Number(data.price), color: data.color };
    if (product) Object.assign(product, next);
    else state.products.push({ id: uid('product'), storeId: selectedStoreId, active: true, ...next });
    saveState();
    closeModal();
    renderAll();
    showToast(product ? 'Producto actualizado' : 'Producto creado');
  });
}

function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || !window.confirm(`Eliminar “${product.name}”? Las ventas anteriores se conservarán.`)) return;
  state.products = state.products.filter((item) => item.id !== productId);
  cart = cart.filter((item) => item.productId !== productId);
  saveState();
  renderAll();
  showToast('Producto eliminado');
}

function openStoreModal(storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>${store ? 'Editar tienda' : 'Nueva tienda'}</h2><p>Cada tienda tiene catálogo y caja propios.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="store-form">
      <div class="modal-body form-grid">
        <label class="field full">Nombre de tienda<input name="name" required maxlength="80" value="${esc(store?.name || '')}" autofocus /></label>
        <label class="field full">Dirección<input name="address" maxlength="120" value="${esc(store?.address || '')}" /></label>
        <label class="field">Teléfono<input name="phone" maxlength="30" value="${esc(store?.phone || '')}" /></label>
        <label class="field">Color<select name="color">${palette.map((color, index) => `<option value="${color}" ${store?.color === color ? 'selected' : ''}>Color ${index + 1}</option>`).join('')}</select></label>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cancelar</button><button class="primary-btn" type="submit">${store ? 'Guardar cambios' : 'Crear tienda'}</button></div>
    </form>
  </div>`);
  $('#store-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const next = { name: data.name.trim(), address: data.address.trim(), phone: data.phone.trim(), color: data.color };
    if (store) Object.assign(store, next);
    else {
      const newStore = { id: uid('store'), ...next };
      state.stores.push(newStore);
      selectedStoreId = newStore.id;
      cart = [];
    }
    saveState();
    closeModal();
    renderAll();
    showToast(store ? 'Tienda actualizada' : 'Tienda creada');
  });
}

function deleteStore(storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  if (!store) return;
  if (state.stores.length === 1) return showToast('Debe existir al menos una tienda');
  if (currentEvent()) return showToast('No puedes eliminar tiendas durante un evento activo');
  if (state.sessions.some((session) => session.storeId === storeId && !session.closedAt)) return showToast('Cierra la caja antes de eliminar esta tienda');
  if (!window.confirm(`Eliminar “${store.name}” y sus productos? Ventas anteriores se conservarán.`)) return;
  state.stores = state.stores.filter((item) => item.id !== storeId);
  state.products = state.products.filter((item) => item.storeId !== storeId);
  if (selectedStoreId === storeId) selectedStoreId = state.stores[0].id;
  cart = [];
  saveState();
  renderAll();
  showToast('Tienda eliminada');
}

function openStartEventModal() {
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>Iniciar evento</h2><p>Agrupará ventas y cajas de todas las tiendas.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="start-event-form">
      <div class="modal-body">
        <label class="field">Nombre del evento<input name="name" required maxlength="80" placeholder="Ej. Festival Gastronómico 2026" autofocus /></label>
        <div class="event-start-info"><span>⌂</span><div><strong>${state.stores.length} tiendas incluidas</strong><small>${state.stores.map((store) => esc(store.name)).join(' · ')}</small></div></div>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cancelar</button><button class="primary-btn" type="submit">Iniciar evento</button></div>
    </form>
  </div>`);
  $('#start-event-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    state.events.push({ id: uid('event'), name, openedAt: new Date().toISOString(), closedAt: null, status: 'active' });
    saveState();
    closeModal();
    renderAll();
    switchView('events');
    showToast(`Evento “${name}” iniciado`);
  });
}

function openCloseEventModal() {
  const event = currentEvent();
  if (!event) return openStartEventModal();
  const settlement = eventSettlement(event, state.stores, state.sessions, activeSales());
  const openSessions = state.sessions.filter((session) => session.eventId === event.id && !session.closedAt);
  setModal(`<div class="modal wide">
    <div class="modal-head"><div><h2>Cerrar evento y generar cuadre</h2><p>${esc(event.name)}</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <div class="modal-body">
      ${openSessions.length ? `<div class="warning-box"><strong>No se puede cerrar.</strong> Caja central abierta por ${openSessions.map((session) => esc(session.cashier)).join(', ')}.</div>` : '<div class="success-box">Caja central cerrada. Cuadre listo para consolidar.</div>'}
      <div class="cash-summary settlement-summary">
        <div><span>VENTAS</span><strong>${settlement.saleCount}</strong></div><div><span>TOTAL VENDIDO</span><strong>${money(settlement.salesTotal)}</strong></div>
        <div><span>EFECTIVO ESPERADO</span><strong>${money(settlement.expectedCash)}</strong></div><div><span>EFECTIVO CONTADO</span><strong>${money(settlement.countedCash)}</strong></div>
        <div><span>YAPE</span><strong>${money(settlement.payments.YAPE)}</strong></div><div><span>DIFERENCIA</span><strong class="${settlement.difference ? 'negative-value' : ''}">${money(settlement.difference)}</strong></div>
      </div>
    </div>
    <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Volver</button><button id="confirm-event-close" class="primary-btn" type="button" ${openSessions.length ? 'disabled' : ''}>Cerrar y guardar cuadre</button></div>
  </div>`);
  $('#confirm-event-close').addEventListener('click', () => {
    if (settlement.openRegisters) return;
    event.closedAt = new Date().toISOString();
    event.status = 'closed';
    event.settlement = settlement;
    cart = [];
    saveState();
    closeModal();
    renderAll();
    switchView('events');
    openSettlementModal(event);
    showToast('Evento cerrado. Cuadre guardado');
  });
}

function settlementMarkup(event) {
  const settlement = event.settlement || eventSettlement(event, state.stores, state.sessions, activeSales());
  return `<section class="settlement-report">
    <header><p class="eyebrow">Cuadre final de evento</p><h3>${esc(event.name)}</h3><p>${formatDate(event.openedAt)} → ${event.closedAt ? formatDate(event.closedAt) : 'En curso'}</p></header>
    <div class="settlement-kpis"><div><span>VENTAS</span><strong>${settlement.saleCount}</strong></div><div><span>TOTAL</span><strong>${money(settlement.salesTotal)}</strong></div><div><span>DIFERENCIA</span><strong>${money(settlement.difference)}</strong></div></div>
    <div class="table-wrap"><table><thead><tr><th>Tienda</th><th>Tickets</th><th>Total</th><th>Efectivo</th><th>Yape</th></tr></thead><tbody>
      ${settlement.stores.map((row) => `<tr><td><strong>${esc(row.storeName)}</strong></td><td>${row.saleCount}</td><td>${money(row.salesTotal)}</td><td>${money(row.payments.EFECTIVO)}</td><td>${money(row.payments.YAPE)}</td></tr>`).join('')}
    </tbody></table></div>
    <footer><div><span>Fondo inicial</span><strong>${money(settlement.openingCash)}</strong></div><div><span>Efectivo esperado</span><strong>${money(settlement.expectedCash)}</strong></div><div><span>Efectivo contado</span><strong>${money(settlement.countedCash)}</strong></div><div><span>Diferencia final</span><strong>${money(settlement.difference)}</strong></div></footer>
  </section>`;
}

function openSettlementModal(event) {
  setModal(`<div class="modal wide settlement-modal">
    <div class="modal-head"><div><h2>Cuadre terminado</h2><p>Consolidado global y por tienda.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <div class="modal-body">${settlementMarkup(event)}</div>
    <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cerrar</button><button id="export-settlement" class="secondary-btn" type="button">↓ Exportar Excel</button><button id="print-settlement" class="primary-btn" type="button">Imprimir cuadre</button></div>
  </div>`);
  $('#export-settlement').addEventListener('click', () => exportSettlement(event));
  $('#print-settlement').addEventListener('click', () => {
    $('#print-area').innerHTML = settlementMarkup(event);
    window.print();
  });
}

async function exportSettlement(event) {
  const settlement = event.settlement || eventSettlement(event, state.stores, state.sessions, activeSales());
  const button = $('#export-settlement');
  button.disabled = true;
  button.textContent = 'Generando Excel…';
  try {
    const { buildSettlementWorkbook, downloadWorkbook } = await import('../lib/excel-report.js');
    const sales = activeSales().filter((sale) => sale.eventId === event.id);
    const buffer = await buildSettlementWorkbook({ event, settlement, sales, businessName: state.settings.businessName });
    downloadWorkbook(buffer, `cuadre-${event.name}`);
    showToast('Excel del cuadre generado');
  } catch (error) {
    console.error('No se pudo generar Excel:', error);
    showToast('No se pudo generar Excel');
  } finally {
    button.disabled = false;
    button.textContent = '↓ Exportar Excel';
  }
}

function openCashModal() {
  if (!currentUser) return openLoginModal();
  if (!currentEvent()) {
    return showToast('Admin debe iniciar evento antes de abrir caja');
  }
  const session = currentSession();
  if (session) return openCloseCashModal(session);
  if (currentUser.role !== 'cashier') return showToast('Solo cajera puede abrir caja nueva');
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>Apertura de caja central</h2><p>${esc(currentEvent().name)} · ${esc(currentUser.name)}</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="open-cash-form">
      <div class="modal-body">
        <div class="warning-box">Registra el efectivo disponible antes de iniciar ventas.</div>
        <label class="field" style="margin-top:14px">Caja chica inicial (S/)<input name="openingAmount" type="number" min="0" step="0.01" value="0.00" required autofocus /></label>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cancelar</button><button class="primary-btn" type="submit">Abrir caja</button></div>
    </form>
  </div>`);
  $('#open-cash-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = Number(new FormData(event.currentTarget).get('openingAmount'));
    state.sessions.push({ id: uid('session'), eventId: currentEvent().id, scope: 'festival', userId: currentUser.id, cashier: currentUser.name, openingAmount: amount, openedAt: new Date().toISOString(), closedAt: null });
    saveState();
    closeModal();
    renderAll();
    showToast('Caja abierta. Lista para vender');
  });
}

function openCloseCashModal(session) {
  const summary = sessionSummary(session, activeSales());
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>Cierre de caja</h2><p>Abierta ${formatDate(session.openedAt)}</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="close-cash-form">
      <div class="modal-body">
        <div class="cash-summary">
          <div><span>VENTAS</span><strong>${summary.count}</strong></div><div><span>TOTAL VENDIDO</span><strong>${money(summary.salesTotal)}</strong></div>
          <div><span>EFECTIVO</span><strong>${money(summary.payments.EFECTIVO)}</strong></div><div><span>YAPE</span><strong>${money(summary.payments.YAPE)}</strong></div>
          <div><span>FONDO INICIAL</span><strong>${money(session.openingAmount)}</strong></div><div><span>EFECTIVO ESPERADO</span><strong>${money(summary.expectedCash)}</strong></div>
        </div>
        <label class="field" style="margin-top:14px">Efectivo contado (S/)<input name="closingAmount" type="number" min="0" step="0.01" value="${summary.expectedCash.toFixed(2)}" required /></label>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Seguir vendiendo</button><button class="primary-btn" type="submit">Cerrar caja</button></div>
    </form>
  </div>`);
  $('#close-cash-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const closingAmount = Number(new FormData(event.currentTarget).get('closingAmount'));
    Object.assign(session, { closedAt: new Date().toISOString(), closingAmount, difference: closingAmount - summary.expectedCash, closedByUserId: currentUser.id, closedBy: currentUser.name });
    saveState();
    closeModal();
    renderAll();
    showToast(`Caja cerrada · Diferencia ${money(session.difference)}`);
  });
}

function openCheckoutModal() {
  if (!cart.length) return;
  if (currentUser?.role !== 'cashier') return showToast('Solo cajera puede registrar ventas');
  if (!currentSession()) {
    showToast('Abre caja antes de cobrar');
    return openCashModal();
  }
  paymentMethod = 'EFECTIVO';
  const total = cartSubtotal(cart);
  setModal(`<div class="modal">
    <div class="modal-head"><div><h2>Cobrar pedido</h2><p>${cartCount(cart)} unidad${cartCount(cart) === 1 ? '' : 'es'} · ${esc(currentStore()?.name)}</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <form id="checkout-form">
      <div class="modal-body">
        <div class="checkout-total-card"><span>TOTAL A COBRAR</span><strong>${money(total)}</strong></div>
        <div class="payment-tabs">
          <button class="payment-tab active" data-payment="EFECTIVO" type="button">💵 Efectivo</button>
          <button class="payment-tab" data-payment="YAPE" type="button">▣ Yape</button>
        </div>
        <div id="cash-fields">
          <label class="field">Efectivo recibido (S/)<input id="received-input" name="received" type="number" min="${total.toFixed(2)}" step="0.01" value="${total.toFixed(2)}" required /></label>
          <div class="change-line"><span>Vuelto</span><strong id="change-value">${money(0)}</strong></div>
        </div>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-close-modal type="button">Cancelar</button><button class="primary-btn" type="submit">Confirmar venta</button></div>
    </form>
  </div>`);
  $$('.payment-tab').forEach((button) => button.addEventListener('click', () => {
    paymentMethod = button.dataset.payment;
    $$('.payment-tab').forEach((item) => item.classList.toggle('active', item === button));
    $('#cash-fields').style.display = paymentMethod === 'EFECTIVO' ? 'block' : 'none';
    $('#received-input').required = paymentMethod === 'EFECTIVO';
  }));
  $('#received-input').addEventListener('input', (event) => { $('#change-value').textContent = money(calculateChange(total, event.target.value)); });
  $('#checkout-form').addEventListener('submit', completeSale);
}

function completeSale(event) {
  event.preventDefault();
  const total = cartSubtotal(cart);
  const received = paymentMethod === 'EFECTIVO' ? Number(new FormData(event.currentTarget).get('received')) : total;
  if (paymentMethod === 'EFECTIVO' && received < total) return showToast('Efectivo recibido insuficiente');
  const store = currentStore();
  const sale = {
    id: uid('sale'),
    number: String(Math.max(0, ...state.sales.map((item) => Number(item.number) || 0)) + 1).padStart(5, '0'),
    eventId: currentEvent().id,
    storeId: selectedStoreId,
    store: { name: store.name, address: store.address, phone: store.phone },
    business: { ...state.settings },
    sessionId: currentSession().id,
    userId: currentUser.id,
    cashier: currentUser.name,
    customer: $('#customer-name').value.trim(),
    items: cart.map((item) => ({ ...item })),
    subtotal: total,
    total,
    payment: paymentMethod,
    received,
    change: calculateChange(total, received),
    createdAt: new Date().toISOString(),
  };
  state.sales.push(sale);
  saveState();
  cart = [];
  $('#customer-name').value = '';
  renderAll();
  openTicketModal(sale);
  showToast(`Venta #${sale.number} registrada`);
}

function ticketMarkup(sale, copy = 'customer', includeActions = false) {
  const isCustomer = copy === 'customer';
  const label = isCustomer ? 'TICKET CLIENTE' : `TICKET · ${sale.store.name.toUpperCase()}`;
  return `<section class="ticket-preview">
    <header>
      <h3>${esc(sale.business.businessName)}</h3>
      <div>${esc(sale.store.name)}</div>
      <small>${esc(sale.store.address || '')}</small>
      <div class="ticket-copy">${esc(label)}</div>
      ${isCustomer ? '<small>Comprobante interno de venta</small>' : '<small>Copia tienda / cocina</small>'}
    </header>
    <div class="ticket-rule"></div>
    <div class="ticket-row"><span>Venta</span><strong>#${esc(sale.number)}</strong></div>
    <div class="ticket-row"><span>Fecha</span><span>${formatDate(sale.createdAt)}</span></div>
    <div class="ticket-row"><span>Cajero</span><span>${esc(sale.cashier)}</span></div>
    <div class="ticket-row"><span>Cliente</span><span>${esc(sale.customer || 'Cliente general')}</span></div>
    <div class="ticket-rule"></div>
    ${sale.items.map((item) => `<div class="ticket-row"><span>${item.qty} × ${esc(item.name)}</span><strong>${money(item.qty * item.price)}</strong></div>`).join('')}
    <div class="ticket-rule"></div>
    <div class="ticket-row total"><span>TOTAL</span><strong>${money(sale.total)}</strong></div>
    <div class="ticket-row"><span>Pago</span><span>${esc(sale.payment)}</span></div>
    ${sale.payment === 'EFECTIVO' ? `<div class="ticket-row"><span>Recibido</span><span>${money(sale.received)}</span></div><div class="ticket-row"><span>Vuelto</span><span>${money(sale.change)}</span></div>` : ''}
    <footer class="ticket-footer"><strong>${isCustomer ? esc(sale.business.receiptFooter) : `PEDIDO #${esc(sale.number)}`}</strong><small>${isCustomer ? `RUC ${esc(sale.business.ruc || '—')}` : 'Verificar productos antes de entregar'}</small></footer>
    ${includeActions ? `<div class="ticket-actions"><button class="secondary-btn" data-print-copy="customer" type="button">Imprimir cliente</button><button class="primary-btn" data-print-copy="store" type="button">Imprimir tienda</button></div>` : ''}
  </section>`;
}

function openTicketModal(sale) {
  setModal(`<div class="modal wide">
    <div class="modal-head"><div><h2>Venta completada</h2><p>Elige la copia que deseas imprimir.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
    <div class="modal-body ticket-choice">
      <div>${ticketMarkup(sale, 'customer')}</div>
      <div>${ticketMarkup(sale, 'store')}</div>
    </div>
    <div class="modal-actions">
      <button class="secondary-btn" data-close-modal type="button">Cerrar</button>
      <button class="secondary-btn" data-print-ticket="customer" type="button">Imprimir cliente</button>
      <button class="secondary-btn" data-print-ticket="store" type="button">Imprimir tienda</button>
      <button class="primary-btn" data-print-ticket="both" type="button">Imprimir ambos</button>
    </div>
  </div>`);
  $$('[data-print-ticket]').forEach((button) => button.addEventListener('click', () => printTicket(sale, button.dataset.printTicket)));
}

function printTicket(sale, copy) {
  const content = copy === 'both'
    ? `${ticketMarkup(sale, 'customer')}<div style="break-after:page"></div>${ticketMarkup(sale, 'store')}`
    : ticketMarkup(sale, copy);
  $('#print-area').innerHTML = content;
  window.print();
}

async function exportSales() {
  const sales = storeSales();
  if (!sales.length) return showToast('No hay ventas para exportar');
  const button = $('#export-sales');
  button.disabled = true;
  button.textContent = 'Generando Excel…';
  try {
    const { buildSalesWorkbook, downloadWorkbook } = await import('../lib/excel-report.js');
    const buffer = await buildSalesWorkbook({
      sales,
      storeName: currentStore()?.name,
      eventName: currentEvent()?.name,
      businessName: state.settings.businessName,
    });
    downloadWorkbook(buffer, `ventas-${currentStore()?.name || 'festival'}`);
    showToast('Excel generado correctamente');
  } catch (error) {
    console.error('No se pudo generar Excel:', error);
    showToast('No se pudo generar Excel');
  } finally {
    button.disabled = false;
    button.textContent = '↓ Exportar Excel';
  }
}

function bindEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => requestView(button.dataset.view)));
  $('#menu-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  $('#admin-session').addEventListener('click', logoutUser);
  $('#event-status').addEventListener('click', () => requestView('events'));
  $('#event-primary-action').addEventListener('click', () => currentEvent() ? openCloseEventModal() : openStartEventModal());
  $('#store-select').addEventListener('change', (event) => switchStore(event.target.value));
  $('#cash-status').addEventListener('click', openCashModal);
  $('#product-search').addEventListener('input', renderCatalog);
  $('#admin-product-search').addEventListener('input', renderProductsTable);
  $('#clear-cart').addEventListener('click', () => { cart = []; renderCart(); });
  $('#checkout-btn').addEventListener('click', openCheckoutModal);
  $('#new-store-btn').addEventListener('click', () => openStoreModal());
  $('#new-user-btn').addEventListener('click', () => openUserModal());
  $('#export-sales').addEventListener('click', exportSales);
  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.settings = { ...state.settings, ...Object.fromEntries(new FormData(event.currentTarget)) };
    saveState();
    renderAll();
    showToast('Ajustes guardados');
  });
  bindOpenProductButtons();
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      switchView('pos');
      $('#product-search').focus();
    }
    if (event.key === 'F2') { event.preventDefault(); openCheckoutModal(); }
    if (event.key === 'Escape' && $('#modal-root').innerHTML && !$('#modal-root').dataset.locked) closeModal();
  });
}

async function initializeApp() {
  bindEvents();
  await connectSharedState();
  renderAll();
  if (!currentUser) openLoginModal();
  window.setInterval(pollSharedState, 1200);
  window.addEventListener('focus', pollSharedState);
}

initializeApp();
