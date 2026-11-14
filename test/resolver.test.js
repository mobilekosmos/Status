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
// `respond(method, path)` can replace the answer to specific requests.
const fakeConfluence = ({ canRead = true, canUpdate = true, property = null, respond } = {}) => {
  requestConfluence.mockImplementation(async (url, init = {}) => {
    const path = url.value;
    const method = init.method ?? 'GET';

    const customResponse = respond?.(method, path);
    if (customResponse) {
      return customResponse;
    }
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

let consoleError;

beforeEach(() => {
  requestConfluence.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  // Keep the test output clean; tests that expect logging assert on it.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe('content types', () => {
  it('uses the blog post endpoints when the macro is on a blog post', async () => {
    fakeConfluence({
      property: savedProperty({ status: 'notAccepted', statusChangedAt: '2026-11-01T08:00:00.000Z' }),
    });
    const onBlogPost = { extension: { type: 'macro', content: { id: PAGE_ID, type: 'blogpost' } } };

    await getStatus(request({}, onBlogPost));
    await setStatus(request({ status: 'acceptedForRelease' }, onBlogPost));

    expect(sentRequests()).toEqual([
      `POST /wiki/rest/api/content/${PAGE_ID}/permission/check`,
      `GET /wiki/api/v2/blogposts/${PAGE_ID}/properties?key=${PROPERTY_KEY}`,
      `POST /wiki/rest/api/content/${PAGE_ID}/permission/check`,
      `GET /wiki/api/v2/blogposts/${PAGE_ID}/properties?key=${PROPERTY_KEY}`,
      `PUT /wiki/api/v2/blogposts/${PAGE_ID}/properties/777`,
    ]);
  });

  it('treats a missing content type as a page, like before', async () => {
    fakeConfluence({ property: null, canUpdate: false });

    await getStatus(request({}, { extension: { type: 'macro', content: { id: PAGE_ID } } }));

    expect(sentRequests()).toContain(`GET /wiki/api/v2/pages/${PAGE_ID}/properties?key=${PROPERTY_KEY}`);
  });

  it('refuses places without content properties, such as a space', async () => {
    fakeConfluence();
    const inSpace = { extension: { type: 'macro', content: { id: '42', type: 'space' } } };

    await expect(getStatus(request({}, inSpace))).rejects.toThrow(/only works on pages and blog posts/);
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
    // Read-only viewers are normal, not an error worth logging.
    expect(consoleError).not.toHaveBeenCalled();
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

  it('keeps the "since" date when the chosen status is already saved', async () => {
    // Someone else set "not accepted" on 1 November; this user's page was
    // opened earlier and still showed the old status, so they pick it again.
    const saved = { status: 'notAccepted', statusChangedAt: '2026-11-01T08:00:00.000Z' };
    fakeConfluence({ property: savedProperty(saved) });

    await expect(setStatus(request({ status: 'notAccepted' }))).resolves.toEqual(saved);
    expect(writeRequests()).toHaveLength(0);
  });

  // Two editors pick a status at the same moment: both read version 3, the
  // other one's write lands first, so Confluence refuses this write.
  const collidingSave = (theirValue) => {
    let lookups = 0;
    fakeConfluence({
      property: savedProperty({ status: 'readyForAcceptanceTest', statusChangedAt: '2026-11-01T08:00:00.000Z' }, 3),
      respond: (method, path) => {
        if (method === 'PUT') {
          return jsonResponse(409, { message: 'Version conflict' });
        }
        if (method === 'GET' && path.includes('/properties?key=') && ++lookups > 1) {
          return jsonResponse(200, { results: [savedProperty(theirValue, 4)] });
        }
        return undefined;
      },
    });
  };

  it('succeeds when a colliding save chose the same status', async () => {
    const theirs = { status: 'notAccepted', statusChangedAt: '2026-11-14T09:59:59.000Z' };
    collidingSave(theirs);

    await expect(setStatus(request({ status: 'notAccepted' }))).resolves.toEqual(theirs);
  });

  it('says so when a colliding save chose a different status', async () => {
    collidingSave({ status: 'inAcceptanceTest', statusChangedAt: '2026-11-14T09:59:59.000Z' });

    await expect(setStatus(request({ status: 'notAccepted' }))).rejects.toThrow(
      'Someone else just changed the status. Reload the page to see it.',
    );
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

describe('failed Confluence requests', () => {
  it('pass on a short message and log what Confluence answered', async () => {
    fakeConfluence({
      respond: (method, path) =>
        path.includes('/properties?key=') ? jsonResponse(500, { message: 'Database on fire' }) : undefined,
    });

    const error = await getStatus(request()).catch((caught) => caught);

    expect(error.message).toBe('Could not load the status.');
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/HTTP 500.*Database on fire/));
  });

  it('pass on a short message when saving fails', async () => {
    fakeConfluence({
      property: savedProperty({ status: 'readyForAcceptanceTest', statusChangedAt: '2026-11-01T08:00:00.000Z' }),
      respond: (method) => (method === 'PUT' ? jsonResponse(409, { message: 'Version conflict' }) : undefined),
    });

    await expect(setStatus(request({ status: 'notAccepted' }))).rejects.toThrow(/^Could not save the status\.$/);
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/HTTP 409.*Version conflict/));
  });

  it('pass on "Could not save" when the lookup during a save fails', async () => {
    fakeConfluence({
      respond: (method, path) =>
        path.includes('/properties?key=') ? jsonResponse(503, { message: 'Try again later' }) : undefined,
    });

    await expect(setStatus(request({ status: 'notAccepted' }))).rejects.toThrow(/^Could not save the status\.$/);
  });

  it('do not break the first view when saving the default status fails', async () => {
    fakeConfluence({
      property: null,
      respond: (method, path) =>
        method === 'POST' && path.endsWith('/properties') ? jsonResponse(400, { message: 'Bad key' }) : undefined,
    });

    await expect(getStatus(request())).resolves.toEqual({
      status: 'readyForAcceptanceTest',
      statusChangedAt: null,
    });
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/initial status.*HTTP 400.*Bad key/));
  });
});
