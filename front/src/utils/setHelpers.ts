/**
 * Small helpers to work immutably with Set<T>
 */
export function toggleSetItem<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);

  if (next.has(item)) next.delete(item);
  else next.add(item);

  return next;
}

export function addSetItem<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);

  next.add(item);

  return next;
}

export function removeSetItem<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);

  next.delete(item);

  return next;
}

export default toggleSetItem;
