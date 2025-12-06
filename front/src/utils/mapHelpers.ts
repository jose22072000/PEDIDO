/**
 * Helpers for immutable Map operations
 */
export function setMapValue<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);

  next.set(key, value);

  return next;
}

export function removeMapKey<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map);

  next.delete(key);

  return next;
}

export function toggleMapKey<K, V>(
  map: Map<K, V>,
  key: K,
  defaultValue: V,
): Map<K, V> {
  const next = new Map(map);

  if (next.has(key)) next.delete(key);
  else next.set(key, defaultValue);

  return next;
}

export default setMapValue;
