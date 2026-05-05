import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();
const PROPERTY_KEY_PREFIX = 'status-inline-v1';
const DEFAULT_STATUS = 'readyForAcceptanceTest';
const VALID_STATUSES = new Set([
  'readyForAcceptanceTest',
  'inAcceptanceTest',
  'notAccepted',
  'acceptedForRelease',
]);

// Each macro instance on a page gets its own property key derived from the
// macro's localId. base64url keeps it within Confluence's allowed key charset.
const getPropertyKey = (localId) => {
  const encodedLocalId = Buffer.from(localId).toString('base64url');
  return `${PROPERTY_KEY_PREFIX}-${encodedLocalId}`;
};

const toStatusPayload = (value) => ({
  status: VALID_STATUSES.has(value?.status) ? value.status : DEFAULT_STATUS,
  statusChangedAt: value?.statusChangedAt || null,
});

// Look up an existing content property by key on a page using the v2 API.
// v2 returns a list; we match the requested key client-side. Returns the
// property object (with id and version) or null when no property exists yet.
const findProperty = async (contentId, key) => {
  const response = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/pages/${contentId}/properties?key=${key}`);

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to list page properties: ${response.status} ${details}`);
  }

  const data = await response.json();
  const match = (data.results || []).find((property) => property.key === key);
  return match || null;
};

resolver.define('getStatus', async (req) => {
  const contentId = req.payload?.contentId;
  const localId = req.payload?.localId;

  if (!contentId) {
    throw new Error('Missing contentId for status lookup');
  }

  if (!localId) {
    throw new Error('Missing localId for status lookup');
  }

  const property = await findProperty(contentId, getPropertyKey(localId));

  if (!property) {
    return toStatusPayload();
  }

  return toStatusPayload(property.value);
});

resolver.define('setStatus', async (req) => {
  const contentId = req.payload?.contentId;
  const localId = req.payload?.localId;
  const status = req.payload?.status;

  if (!contentId) {
    throw new Error('Missing contentId for status update');
  }

  if (!localId) {
    throw new Error('Missing localId for status update');
  }

  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unsupported status value: ${status}`);
  }

  const key = getPropertyKey(localId);
  const statusChangedAt = new Date().toISOString();
  const value = { status, statusChangedAt };

  // v2 distinguishes create vs update: POST when no property exists, PUT
  // (with the next version number) when updating an existing one.
  const existing = await findProperty(contentId, key);

  let response;
  if (existing) {
    const nextVersion = (existing.version?.number || 1) + 1;
    response = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/pages/${contentId}/properties/${existing.id}`, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          value,
          version: { number: nextVersion },
        }),
      });
  } else {
    response = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/pages/${contentId}/properties`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, value }),
      });
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to save status property: ${response.status} ${details}`);
  }

  return { status, statusChangedAt };
});

export const handler = resolver.getDefinitions();
