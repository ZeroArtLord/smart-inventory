function calendarDate(value, label = 'Fecha operativa') {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label} inválida: usa YYYY-MM-DD`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`${label} inválida`);
  }

  return text;
}

export function todayOperationalDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Fecha actual inválida');
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeOperationalDate(
  value,
  { today = todayOperationalDate() } = {}
) {
  const date = calendarDate(value);
  const todayDate = calendarDate(today, 'Fecha actual');

  if (date > todayDate) {
    throw new Error('La fecha operativa no puede ser futura');
  }

  return date;
}

export function operationalDateToEffectiveAt(value) {
  const date = calendarDate(value);
  return `${date}T12:00:00.000Z`;
}

export function resolveDocumentOperationalDate(document = {}) {
  const explicit = String(
    document?.metadata?.operationalDate ?? ''
  ).trim();

  if (explicit) {
    return calendarDate(explicit);
  }

  for (const value of [
    document?.closedAt,
    document?.updatedAt,
    document?.createdAt
  ]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return null;
}
