export const DOCUMENT_TYPES = Object.freeze({
  COUNT: 'COUNT',
  ENTRY: 'ENTRY',
  SUPPLY: 'SUPPLY',
  ADJUSTMENT: 'ADJUSTMENT'
});

export const DOCUMENT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  CLOSED: 'CLOSED',
  VERIFIED: 'VERIFIED',
  READY_FOR_SAINT: 'READY_FOR_SAINT',
  SENT_TO_SAINT: 'SENT_TO_SAINT',
  SAINT_PENDING: 'SAINT_PENDING',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED'
});

export function assertDocumentType(type) {
  if (!Object.values(DOCUMENT_TYPES).includes(type)) {
    throw new Error('Tipo de documento inválido');
  }
  return type;
}

export function assertDocumentIsDraft(document) {
  if (!document) throw new Error('Documento no encontrado');
  if (document.status !== DOCUMENT_STATUS.DRAFT) {
    throw new Error('El documento ya no está en borrador');
  }
}
