import { GoogleDriveSyncPort } from '../sync-port';

function jsonResponse(data: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('GoogleDriveSyncPort', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the live revision and ETag from Drive metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          files: [{ id: 'live', name: 'finance-live.db', modifiedTime: '2026-03-01T10:00:00Z' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'live',
            name: 'finance-live.db',
            headRevisionId: 'revision-4',
            modifiedTime: '2026-03-01T10:00:00Z',
          },
          { ETag: '"etag-4"' },
        ),
      );

    await expect(new GoogleDriveSyncPort('drive-token').findLiveFile()).resolves.toEqual({
      id: 'live',
      name: 'finance-live.db',
      revisionId: 'revision-4',
      modifiedTime: '2026-03-01T10:00:00Z',
      etag: '"etag-4"',
    });
  });

  it('uses the fetched ETag when updating a live file', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          files: [{ id: 'live', name: 'finance-live.db', modifiedTime: '2026-03-01T10:00:00Z' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'live',
            name: 'finance-live.db',
            headRevisionId: 'revision-4',
            modifiedTime: '2026-03-01T10:00:00Z',
          },
          { ETag: '"etag-4"' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'live',
          name: 'finance-live.db',
          headRevisionId: 'revision-5',
          modifiedTime: '2026-03-01T10:01:00Z',
        }),
      );

    const port = new GoogleDriveSyncPort('drive-token');
    const saved = await port.updateLive(
      {
        id: 'live',
        name: 'finance-live.db',
        revisionId: 'revision-4',
        modifiedTime: '2026-03-01T10:00:00Z',
      },
      Uint8Array.from([1, 2, 3]),
    );

    expect(saved.revisionId).toBe('revision-5');
    const [url, options] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toContain('uploadType=multipart');
    expect(options.method).toBe('PATCH');
    expect(options.headers).toMatchObject({ 'If-Match': '"etag-4"' });
    expect(options.body).toContain('AQID');
  });

  it('keeps both legacy phone backups and new sync snapshots discoverable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            { id: 'legacy', name: 'FinanceTracker-backup-2026-01-01-0000.db' },
            { id: 'snapshot', name: 'Finance-Tracker-backup-2026-01-02.db' },
            { id: 'live', name: 'finance-live.db' },
          ],
        }),
      );

    await expect(new GoogleDriveSyncPort('drive-token').listSnapshots()).resolves.toEqual([
      {
        id: 'legacy',
        name: 'FinanceTracker-backup-2026-01-01-0000.db',
        modifiedTime: new Date(0).toISOString(),
      },
      {
        id: 'snapshot',
        name: 'Finance-Tracker-backup-2026-01-02.db',
        modifiedTime: new Date(0).toISOString(),
      },
    ]);
  });

  it('reads the edit lock when Drive sends no ETag (Drive API v3)', async () => {
    const lock = {
      deviceId: 'web-1',
      deviceLabel: 'Chrome on Windows',
      platform: 'web',
      acquiredAt: '2026-11-25T10:32:00.000Z',
      refreshedAt: '2026-11-25T10:32:00.000Z',
      expiresAt: '2026-11-25T10:35:00.000Z',
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'lock', name: 'finance-session.json' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'lock', version: '3' }))
      .mockResolvedValueOnce(new Response(JSON.stringify(lock)));

    await expect(new GoogleDriveSyncPort('drive-token').readLock()).resolves.toEqual({
      id: 'lock',
      version: '3',
      lock,
    });
  });
});
