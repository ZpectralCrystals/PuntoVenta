const COLLECTIONS = ['users', 'stores', 'products', 'sessions', 'sales', 'events'];

export function mergeOfflineState(base, local, remote) {
  const merged = structuredClone(remote);
  if (JSON.stringify(local.settings) !== JSON.stringify(base.settings)) merged.settings = structuredClone(local.settings);

  for (const key of COLLECTIONS) {
    const baseMap = new Map(base[key].map((item) => [item.id, item]));
    const localMap = new Map(local[key].map((item) => [item.id, item]));
    const mergedMap = new Map(remote[key].map((item) => [item.id, item]));
    baseMap.forEach((_item, id) => { if (!localMap.has(id)) mergedMap.delete(id); });
    localMap.forEach((item, id) => {
      if (!baseMap.has(id) || JSON.stringify(item) !== JSON.stringify(baseMap.get(id))) mergedMap.set(id, structuredClone(item));
    });
    merged[key] = [...mergedMap.values()];
  }
  return merged;
}
