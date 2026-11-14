import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The resolver talks to Confluence only through api.asApp().requestConfluence().
// Replace that call with a mock so every test can script Confluence's answers
// and inspect the requests the resolver sends. `route` stays the real helper.
const { requestConfluence } = vi.hoisted(() => ({ requestConfluence: vi.fn() }));

vi.mock('@forge/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, asApp: () => ({ requestConfluence }) },
  };
});

const { getStatus, setStatus } = await import('../src/resolvers/index.js');

const NOW = '2026-11-14T10:00:00.000Z';
const PAGE_ID = '12345';
const LOCAL_ID = 'macro-local-id';
const PROPERTY_KEY = `status-inline-v1-${Buffer.from(LOCAL_ID).toString('base64url')}`;

// Minimal stand-in for the fetch-style Response that requestConfluence returns.
const jsonResponse = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// Scripts a fake Confluence: permission checks answer according to canRead /
// canUpdate, and the property list returns `property` (or nothing).
const fakeConfluence = ({ canRead = true, canUpdate = true, property = null } = {}) => {
  requestConfluence.mockImplementation(async (url, init = {}) => {
    const path = url.value;
    const method = init.method ?? 'GET';

    if (path.endsWith('/permission/check')) {
      const { operation } = JSON.parse(init.body);
      return jsonResponse(200, { hasPermission: operation === 'read' ? canRead : canUpdate });
    }
    if (method === 'GET' && path.includes('/properties?key=')) {
      return jsonResponse(200, { results: property ? [property] : [] });
    }
    if (method === 'POST' || method === 'PUT') {
      return jsonResponse(200, { id: '99', ...JSON.parse(init.body) });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
};

// "METHOD path" for every request sent, which keeps assertions readable.
const sentRequests = () =>
  requestConfluence.mock.calls.map(([url, init = {}]) => `${init.method ?? 'GET'} ${url.value}`);

const writeRequests = () =>
  requestConfluence.mock.calls.filter(([, init = {}]) => ['POST', 'PUT'].includes(init.method) && !init.body.includes('"operation"'));

const bodyOf = ([, init]) => JSON.parse(init.body);

const savedProperty = (value, versionNumber = 3) => ({
  id: '777',
  key: PROPERTY_KEY,
  value,
  version: { number: versionNumber },
});

// What Forge passes to a resolver function: the payload sent by the browser
// and the context Forge adds on its servers for the macro on a page.
const request = (payload = {}, context = {}) => ({
  payload,
  context: {
    accountId: 'user-1',
    localId: LOCAL_ID,
    extension: { type: 'macro', content: { id: PAGE_ID, type: 'page' } },
    ...context,
  },
});

beforeEach(() => {
  requestConfluence.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('page and macro IDs', () => {
  it('come from the Forge context, never from the payload', async () => {
    fakeConfluence({
      property: savedProperty({ status: 'notAccepted', statusChangedAt: '2026-11-01T08:00:00.000Z' }),
    });
    // A user could send any IDs from the browser console.
    const forged = { contentId: '666', localId: 'forged' };

    await getStatus(request(forged));
    await setStatus(request({ ...forged, status: 'inAcceptanceTest' }));

    const sent = sentRequests();
    expect(sent.every((line) => line.includes(PAGE_ID))).toBe(true);
    expect(sent.join('\n')).not.toMatch(/666|Zm9yZ2Vk/); // Zm9yZ2Vk = base64url('forged')
    expect(sent).toContain(`GET /wiki/api/v2/pages/${PAGE_ID}/properties?key=${PROPERTY_KEY}`);
  });

  it('are required before anything is sent to Confluence', async () => {
    fakeConfluence();

    await expect(getStatus(request({}, { extension: { type: 'macro' } }))).rejects.toThrow(
      /Missing page or macro ID/,
    );
    await expect(setStatus(request({ status: 'notAccepted' }, { localId: undefined }))).rejects.toThrow(
      /Missing page or macro ID/,
    );
    expect(requestConfluence).not.toHaveBeenCalled();
  });
});

describe('getStatus', () => {
  it('returns the status saved for this macro instance', async () => {
    fakeConfluence({
      property: savedProperty({ status: 'notAccepted', statusChangedAt: '2026-11-01T08:00:00.000Z' }),
    });

    await expect(getStatus(request())).resolves.toEqual({
      status: 'notAccepted',
      statusChangedAt: '2026-11-01T08:00:00.000Z',
    });
    expect(sentRequests()).toContain(`GET /wiki/api/v2/pages/${PAGE_ID}/properties?key=${PROPERTY_KEY}`);
  });

  it('saves the default status on first view by a user who can edit the page', async () => {
    fakeConfluence({ property: null });

    await expect(getStatus(request())).resolves.toEqual({
      status: 'readyForAcceptanceTest',
      statusChangedAt: NOW,
    });

    const writes = writeRequests();
    expect(writes).toHaveLength(1);
    expect(bodyOf(writes[0])).toEqual({
      key: PROPERTY_KEY,
      value: { status: 'readyForAcceptanceTest', statusChangedAt: NOW },
    });
  });

  it('shows the default status without saving it for users who cannot edit', async () => {
    fakeConfluence({ property: null, canUpdate: false });

    await expect(getStatus(request())).resolves.toEqual({
      status: 'readyForAcceptanceTest',
      statusChangedAt: null,
    });
    expect(writeRequests()).toHaveLength(0);
  });

  it('refuses users who cannot view the page', async () => {
    fakeConfluence({ canRead: false });

    await expect(getStatus(request())).rejects.toThrow(/permission to view/);
    expect(sentRequests()).toHaveLength(1);
  });
});

describe('setStatus', () => {
  it('rejects unknown status values before calling Confluence', async () => {
    fakeConfluence();

    await expect(setStatus(request({ status: 'shipIt' }))).rejects.toThrow(/Unsupported status/);
    expect(requestConfluence).not.toHaveBeenCalled();
  });

  it('refuses users who cannot edit the page', async () => {
    fakeConfluence({ canUpdate: false });

    await expect(setStatus(request({ status: 'inAcceptanceTest' }))).rejects.toThrow(/permission to change/);
    expect(writeRequests()).toHaveLength(0);
  });

  it('updates an existing property with the next version number', async () => {
    fakeConfluence({
      property: savedProperty({ status: 'readyForAcceptanceTest', statusChangedAt: '2026-11-01T08:00:00.000Z' }, 3),
    });

    await expect(setStatus(request({ status: 'inAcceptanceTest' }))).resolves.toEqual({
      status: 'inAcceptanceTest',
      statusChangedAt: NOW,
    });

    const writes = writeRequests();
    expect(writes).toHaveLength(1);
    expect(writes[0][1].method).toBe('PUT');
    expect(writes[0][0].value).toBe(`/wiki/api/v2/pages/${PAGE_ID}/properties/777`);
    expect(bodyOf(writes[0])).toEqual({
      key: PROPERTY_KEY,
      value: { status: 'inAcceptanceTest', statusChangedAt: NOW },
      version: { number: 4 },
    });
  });

  it('creates the property when the macro has none yet', async () => {
    fakeConfluence({ property: null });

    await setStatus(request({ status: 'acceptedForRelease' }));

    const writes = writeRequests();
    expect(writes).toHaveLength(1);
    expect(writes[0][1].method).toBe('POST');
    expect(writes[0][0].value).toBe(`/wiki/api/v2/pages/${PAGE_ID}/properties`);
  });
});
