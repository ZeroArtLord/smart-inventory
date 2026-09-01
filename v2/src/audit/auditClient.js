import { apiRequest } from '../api/apiClient.js';

export async function listAuditEvents({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const data = await apiRequest(
    `/api/v1/audit?limit=${encodeURIComponent(safeLimit)}`
  );

  return Array.isArray(data.events) ? data.events : [];
}
