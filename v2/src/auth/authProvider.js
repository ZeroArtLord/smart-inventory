let tokenProvider = null;

export function setAuthTokenProvider(provider) {
  if (provider !== null && typeof provider !== 'function') {
    throw new Error('El proveedor de token debe ser una función');
  }

  tokenProvider = provider;
}

export function clearAuthTokenProvider() {
  tokenProvider = null;
}

export async function getAuthToken({ required = false } = {}) {
  if (!tokenProvider) {
    if (required) {
      throw new Error('Proveedor de autenticación no configurado');
    }
    return null;
  }

  const token = await tokenProvider();
  const normalized = String(token || '').trim();

  if (!normalized && required) {
    throw new Error('No se pudo obtener un token de autenticación');
  }

  return normalized || null;
}
