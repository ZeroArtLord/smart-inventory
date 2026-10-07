import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOperationalDomRenderKey,
  shouldRefreshOperationalDom
} from '../src/ui/operationalDomRenderGuard.js';

const actor = {
  ownerId: 'god-user',
  roleCode: 'GOD'
};

const drafts = [{
  id: 'supply-1',
  type: 'SUPPLY',
  status: 'DRAFT',
  ownerId: 'warehouse-a',
  updatedAt: '2026-09-11T14:00:00.000Z'
}];

const history = [{
  id: 'supply-closed-1',
  type: 'SUPPLY',
  status: 'CLOSED',
  ownerId: 'warehouse-a',
  closedAt: '2026-09-11T13:00:00.000Z'
}];

const members = [{
  externalAuthId: 'warehouse-a',
  displayName: 'Depósito',
  email: 'deposito@example.com'
}];

test('V8.3.1 no vuelve a renderizar cuando sus listas ya tienen la misma firma', () => {
  const key = buildOperationalDomRenderKey({
    type: 'SUPPLY',
    actor,
    drafts,
    history,
    members
  });

  assert.equal(
    shouldRefreshOperationalDom({
      nextKey: key,
      draftKey: key,
      historyKey: key,
      hasHistoryList: true
    }),
    false
  );
});

test('V8.3.1 vuelve a decorar cuando app.js reemplaza el DOM y desaparece la marca', () => {
  const key = buildOperationalDomRenderKey({
    type: 'SUPPLY',
    actor,
    drafts,
    history,
    members
  });

  assert.equal(
    shouldRefreshOperationalDom({
      nextKey: key,
      draftKey: '',
      historyKey: '',
      hasHistoryList: true
    }),
    true
  );
});

test('la firma cambia cuando cambia el documento o el responsable visible', () => {
  const baseKey = buildOperationalDomRenderKey({
    type: 'SUPPLY',
    actor,
    drafts,
    history,
    members
  });

  const changedDocumentKey = buildOperationalDomRenderKey({
    type: 'SUPPLY',
    actor,
    drafts: [{ ...drafts[0], updatedAt: '2026-09-11T14:05:00.000Z' }],
    history,
    members
  });

  const changedMemberKey = buildOperationalDomRenderKey({
    type: 'SUPPLY',
    actor,
    drafts,
    history,
    members: [{ ...members[0], displayName: 'Almacén Central' }]
  });

  assert.notEqual(changedDocumentKey, baseKey);
  assert.notEqual(changedMemberKey, baseKey);
});
