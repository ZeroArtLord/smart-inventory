export function extractBearerToken(authorizationHeader) {
  const value = String(authorizationHeader || '').trim();
  if (!value) return null;

  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  return token || null;
}
