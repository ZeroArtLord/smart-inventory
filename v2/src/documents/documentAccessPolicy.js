import { DOCUMENT_TYPES } from './documentTypes.js';

const TEAM_OPERATIONAL_TYPES = new Set([
  DOCUMENT_TYPES.ENTRY,
  DOCUMENT_TYPES.SUPPLY
]);

export function isTeamOperationalDocument(document) {
  return TEAM_OPERATIONAL_TYPES.has(normalizeType(document?.type));
}

export function canActorAccessOperationalDocument(
  document,
  { ownerId = null, roleCode = null } = {}
) {
  if (!document) return false;

  const type = normalizeType(document.type);
  const role = String(roleCode || '').trim().toUpperCase();

  // El bypass de supervisión pertenece exclusivamente a la cuenta DIOS.
  // ADMIN puede tener muchos permisos, pero no hereda esta visibilidad por
  // accidente solo por tener wildcard.
  if (TEAM_OPERATIONAL_TYPES.has(type) && role === 'GOD') {
    return true;
  }

  const actorOwnerId = String(ownerId || '').trim();
  const documentOwnerId = String(document.ownerId || '').trim();

  // Fail closed: un documento operativo sin dueño no se filtra hacia otro
  // almacenista. GOD sí puede recuperarlo porque el bypass anterior ya aplicó.
  return Boolean(
    actorOwnerId &&
    documentOwnerId &&
    actorOwnerId === documentOwnerId
  );
}

export function filterOperationalDocumentsForActor(documents = [], actor = {}) {
  return (Array.isArray(documents) ? documents : [])
    .filter(document => canActorAccessOperationalDocument(document, actor));
}

function normalizeType(value) {
  return String(value || '').trim().toUpperCase();
}
