// IDs ordenables por tiempo y suficientemente únicos para trabajo offline.
// No dependen de conexión ni del servidor.

export function createLocalId(prefix = 'evt') {
  const time = Date.now().toString(36);
  const random = getRandomHex(12);
  return `${prefix}_${time}_${random}`;
}

function getRandomHex(bytes) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
}
