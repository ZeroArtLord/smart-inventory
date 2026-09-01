export function initialEntityVersion() {
  return 1;
}

export function nextEntityVersion(entity) {
  const current = Number(entity?.version || 0);
  if (!Number.isInteger(current) || current < 1) {
    return 2;
  }
  return current + 1;
}

export function normalizeEntityVersion(value, fallback = 1) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    return fallback;
  }
  return version;
}
