import { getAuthToken } from '../auth/authProvider.js';
import {
  getSyncConfig,
  buildApiUrl
} from '../sync/syncSettings.js';

export async function apiRequest(path, {
  method = 'GET',
  body = undefined,
  headers = {}
} = {}) {
  const config = await getSyncConfig();

  if (!config.workspaceId) {
    throw createApiError(
      'WORKSPACE_REQUIRED',
      'La identidad del servidor todavía no está preparada.'
    );
  }

  const execute = async ({
    forceRefresh = false
  } = {}) => {
    const requestHeaders = {
      'x-workspace-id': config.workspaceId,
      ...headers
    };

    if (config.authMode === 'firebase') {
      const token = await getAuthToken({
        required: true,
        forceRefresh
      });
      requestHeaders.authorization =
        `Bearer ${token}`;
    } else {
      if (!config.serverUserId) {
        throw createApiError(
          'DEV_IDENTITY_REQUIRED',
          'La identidad DEV todavía no está preparada.'
        );
      }
      requestHeaders['x-user-id'] =
        config.serverUserId;
    }

    if (body !== undefined) {
      requestHeaders['content-type'] =
        'application/json';
    }

    const response = await fetch(
      buildApiUrl(config.apiBaseUrl, path),
      {
        method,
        headers: requestHeaders,
        ...(body !== undefined
          ? { body: JSON.stringify(body) }
          : {})
      }
    );

    const data = await readJson(response);

    return {
      response,
      data
    };
  };

  let result = await execute();

  if (
    config.authMode === 'firebase' &&
    result.response.status === 401 &&
    result.data?.code ===
      'AUTH_TOKEN_INVALID'
  ) {
    result = await execute({
      forceRefresh: true
    });
  }

  const {
    response,
    data
  } = result;

  if (!response.ok || data?.ok === false) {
    const error = createApiError(
      data?.code || 'API_REQUEST_FAILED',
      data?.message ||
        `Error HTTP ${response.status}`
    );
    error.status = response.status;
    error.details = data?.details || null;
    throw error;
  }

  return data;
}

function createApiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return {
      ok: false,
      code: 'INVALID_SERVER_RESPONSE',
      message: `Respuesta inválida del servidor (${response.status})`
    };
  }
}
