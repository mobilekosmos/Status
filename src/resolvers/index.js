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

// Confluence keeps page and blog post properties under different v2 paths.
// Each route is spelled out in full because `route` must see the literal
// path to escape the IDs safely.
const PROPERTY_ROUTES = {
  page: {
    list: (contentId, key) => route`/wiki/api/v2/pages/${contentId}/properties?key=${key}`,
    create: (contentId) => route`/wiki/api/v2/pages/${contentId}/properties`,
    update: (contentId, propertyId) =>
      route`/wiki/api/v2/pages/${contentId}/properties/${propertyId}`,
  },
  blogpost: {
    list: (contentId, key) => route`/wiki/api/v2/blogposts/${contentId}/properties?key=${key}`,
    create: (contentId) => route`/wiki/api/v2/blogposts/${contentId}/properties`,
    update: (contentId, propertyId) =>
      route`/wiki/api/v2/blogposts/${contentId}/properties/${propertyId}`,
  },
};

// Which page or blog post and which macro instance a call is about. The IDs
// come from the context Forge attaches to the call, not from the invoke()
// payload, which the user can change in the browser. Atlassian's docs say not
// every context field is guaranteed to be secure, so the permission checks
// below are still what authorize each call:
// https://developer.atlassian.com/platform/forge/app-context-security/
const getMacroContext = (context) => {
  const content = context?.extension?.content;
  const localId = context?.localId;

  if (!content?.id || !localId) {
    throw new Error('Missing page or macro ID in the Forge context.');
  }

  // If Forge ever leaves out the type, keep the old behaviour (page).
  const routes = PROPERTY_ROUTES[content.type ?? 'page'];
  if (!routes) {
    throw new Error('The Status macro only works on pages and blog posts.');
  }

  return { contentId: content.id, localId, routes };
};

// Confluence's error body only helps when debugging, so it goes to the app
// logs (`forge logs`). Users get a short message instead of raw JSON.
const logFailedResponse = async (response, message) => {
  const details = await response.text();
  console.error(`${message} Confluence answered HTTP ${response.status}: ${details}`);
};

const requestFailed = async (response, message) => {
  await logFailedResponse(response, message);
  return new Error(message);
};

// We keep all data calls on asApp for better UX (no repeated user-consent
// prompts), then explicitly verify the acting user's permissions using the
// product permission API before reads/writes.
const hasContentPermission = async ({ contentId, accountId, operation }) => {
  if (!accountId) {
    throw new Error('Missing user accountId in resolver context.');
  }

  const response = await api
    .asApp()
    .requestConfluence(route`/wiki/rest/api/content/${contentId}/permission/check`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: {
          type: 'user',
          identifier: accountId,
        },
        operation,
      }),
    });

  if (!response.ok) {
    throw await requestFailed(response, 'Could not check your permissions for this page.');
  }

  const result = await response.json();
  return Boolean(result?.hasPermission);
};

const checkUserContentPermission = async ({ errorMessage, ...permission }) => {
  if (!(await hasContentPermission(permission))) {
    throw new Error(errorMessage);
  }
};

// Look up an existing content property by key using the v2 API.
// v2 returns a list; we match the requested key client-side. Returns the
// property object (with id and version) or null when no property exists yet.
// `failureMessage` is what the user sees if Confluence can't answer.
const findProperty = async (routes, contentId, key, failureMessage = 'Could not load the status.') => {
  const response = await api.asApp().requestConfluence(routes.list(contentId, key));

  if (!response.ok) {
    throw await requestFailed(response, failureMessage);
  }

  const data = await response.json();
  const match = (data.results || []).find((property) => property.key === key);
  return match || null;
};

// The handlers are exported so the unit tests can call them directly.
export const getStatus = async (req) => {
  const { contentId, localId, routes } = getMacroContext(req.context);
  const accountId = req.context?.accountId;

  await checkUserContentPermission({
    contentId,
    accountId,
    operation: 'read',
    errorMessage: 'You do not have permission to view this page status.',
  });

  const key = getPropertyKey(localId);
  const property = await findProperty(routes, contentId, key);

  if (!property) {
    const statusChangedAt = new Date().toISOString();
    const initialValue = { status: DEFAULT_STATUS, statusChangedAt };

    // Save the default status on first view so its "since" date starts now.
    // Only users who may edit the page can do that; everyone else simply
    // sees the default. Viewing must keep working even if saving fails, so
    // failures are logged instead of passed on.
    try {
      const canEdit = await hasContentPermission({ contentId, accountId, operation: 'update' });

      if (canEdit) {
        const createResponse = await api.asApp().requestConfluence(routes.create(contentId), {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key, value: initialValue }),
        });

        if (createResponse.ok) {
          return toStatusPayload(initialValue);
        }

        // A concurrent request may have already created the property.
        if (createResponse.status === 409) {
          const concurrentProperty = await findProperty(routes, contentId, key);
          if (concurrentProperty) {
            return toStatusPayload(concurrentProperty.value);
          }
        }

        await logFailedResponse(createResponse, 'Could not save the initial status.');
      }
    } catch (error) {
      console.error('Could not save the initial status.', error);
    }

    return toStatusPayload();
  }

  return toStatusPayload(property.value);
};

export const setStatus = async (req) => {
  const { contentId, localId, routes } = getMacroContext(req.context);
  const status = req.payload?.status;
  const accountId = req.context?.accountId;

  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unsupported status value: ${status}`);
  }

  await checkUserContentPermission({
    contentId,
    accountId,
    operation: 'update',
    errorMessage: 'You do not have permission to change this page status.',
  });

  const key = getPropertyKey(localId);
  const existing = await findProperty(routes, contentId, key, 'Could not save the status.');

  // Picking the status the macro already has must not reset its "since"
  // date. This happens when the page was opened before someone else changed
  // the status.
  if (existing?.value?.status === status && existing.value.statusChangedAt) {
    return toStatusPayload(existing.value);
  }

  const statusChangedAt = new Date().toISOString();
  const value = { status, statusChangedAt };

  // v2 distinguishes create vs update: POST when no property exists, PUT
  // (with the next version number) when updating an existing one.
  let response;
  if (existing) {
    const nextVersion = (existing.version?.number || 1) + 1;
    response = await api.asApp().requestConfluence(routes.update(contentId, existing.id), {
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
    response = await api.asApp().requestConfluence(routes.create(contentId), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, value }),
    });
  }

  if (!response.ok) {
    // Confluence refuses the write when someone else saved between our
    // lookup and our write, because our version number is then out of date.
    // Look again to tell that case apart from other failures.
    const current = await findProperty(routes, contentId, key, 'Could not save the status.').catch(
      () => null,
    );

    // They chose the same status: that is what this user wanted, too.
    if (current?.value?.status === status && current.value.statusChangedAt) {
      return toStatusPayload(current.value);
    }

    // They chose a different one: say so instead of a vague failure.
    if (current && current.version?.number !== existing?.version?.number) {
      await logFailedResponse(response, 'Could not save the status.');
      throw new Error('Someone else just changed the status. Reload the page to see it.');
    }

    throw await requestFailed(response, 'Could not save the status.');
  }

  return { status, statusChangedAt };
};

resolver.define('getStatus', getStatus);
resolver.define('setStatus', setStatus);

export const handler = resolver.getDefinitions();
