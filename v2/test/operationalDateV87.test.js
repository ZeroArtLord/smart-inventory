import test from 'node:test';
import assert from 'node:assert/strict';

import {
  todayOperationalDate,
  normalizeOperationalDate,
  operationalDateToEffectiveAt,
  resolveDocumentOperationalDate,
  resolveDocumentEffectiveAt
} from '../src/documents/operationalDate.js';

test('V8.7 obtiene hoy como fecha operativa local YYYY-MM-DD', () => {
  const local = new Date(2026, 8, 14, 23, 45, 0, 0);
  assert.equal(todayOperationalDate(local), '2026-09-14');
});

test('V8.7 acepta hoy y pasado, pero rechaza futuro', () => {
  assert.equal(
    normalizeOperationalDate('2026-09-12', { today: '2026-09-14' }),
    '2026-09-12'
  );
  assert.equal(
    normalizeOperationalDate('2026-09-14', { today: '2026-09-14' }),
    '2026-09-14'
  );
  assert.throws(
    () => normalizeOperationalDate('2026-09-15', { today: '2026-09-14' }),
    /futur/i
  );
});

test('V8.7 rechaza formato y fechas de calendario imposibles', () => {
  assert.throws(
    () => normalizeOperationalDate('12/09/2026', { today: '2026-09-14' }),
    /fecha|formato/i
  );
  assert.throws(
    () => normalizeOperationalDate('2026-02-30', { today: '2026-09-14' }),
    /fecha|inválida|invalida/i
  );
});

test('V8.7 convierte el día operativo a mediodía UTC estable', () => {
  assert.equal(
    operationalDateToEffectiveAt('2026-09-12'),
    '2026-09-12T12:00:00.000Z'
  );
});

test('V8.7 resuelve effectiveAt operativo y conserva el instante fallback cuando no hay fecha', () => {
  assert.equal(
    resolveDocumentEffectiveAt({
      metadata: { operationalDate: '2026-09-12' }
    }, new Date('2026-09-14T18:00:00.000Z')),
    '2026-09-12T12:00:00.000Z'
  );

  assert.equal(
    resolveDocumentEffectiveAt({}, new Date('2026-09-14T18:00:00.000Z')),
    '2026-09-14T18:00:00.000Z'
  );
});

test('V8.7 resuelve metadata.operationalDate y conserva fallback legacy', () => {
  assert.equal(
    resolveDocumentOperationalDate({
      metadata: { operationalDate: '2026-09-12' },
      closedAt: '2026-09-14T18:20:00.000Z'
    }),
    '2026-09-12'
  );

  assert.equal(
    resolveDocumentOperationalDate({
      closedAt: '2026-09-13T18:20:00.000Z',
      updatedAt: '2026-09-14T10:00:00.000Z'
    }),
    '2026-09-13'
  );

  assert.equal(
    resolveDocumentOperationalDate({
      updatedAt: '2026-09-11T23:59:59.000Z',
      createdAt: '2026-09-10T10:00:00.000Z'
    }),
    '2026-09-11'
  );

  assert.equal(resolveDocumentOperationalDate({}), null);
});
