function normalize(value) {
  return String(value ?? '').trim();
}

function documentFingerprint(document = {}) {
  return [
    normalize(document.id),
    normalize(document.type).toUpperCase(),
    normalize(document.status).toUpperCase(),
    normalize(document.ownerId),
    normalize(document.createdAt),
    normalize(document.updatedAt),
    normalize(document.closedAt),
    normalize(document.metadata?.correctionDraftId)
  ].join('~');
}

function memberFingerprint(member = {}) {
  return [
    normalize(member.externalAuthId),
    normalize(member.userId),
    normalize(member.displayName),
    normalize(member.email),
    normalize(member.roleCode),
    normalize(member.active)
  ].join('~');
}

export function buildOperationalDomRenderKey({
  type = '',
  actor = {},
  drafts = [],
  history = [],
  members = []
} = {}) {
  const actorKey = [
    normalize(actor.ownerId),
    normalize(actor.roleCode).toUpperCase()
  ].join('~');

  const draftKey = (Array.isArray(drafts) ? drafts : [])
    .map(documentFingerprint)
    .join('|');

  const historyKey = (Array.isArray(history) ? history : [])
    .map(documentFingerprint)
    .join('|');

  const memberKey = (Array.isArray(members) ? members : [])
    .map(memberFingerprint)
    .sort()
    .join('|');

  return [
    'v83.1',
    normalize(type).toUpperCase(),
    actorKey,
    draftKey,
    historyKey,
    memberKey
  ].join('::');
}

export function shouldRefreshOperationalDom({
  nextKey = '',
  draftKey = '',
  historyKey = '',
  hasHistoryList = false
} = {}) {
  const normalizedNext = normalize(nextKey);
  if (!normalizedNext) return true;

  if (normalize(draftKey) !== normalizedNext) {
    return true;
  }

  if (
    hasHistoryList &&
    normalize(historyKey) !== normalizedNext
  ) {
    return true;
  }

  return false;
}
