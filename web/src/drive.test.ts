import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveAccessMissingError, DriveReconnectRequiredError, GoogleDriveSyncPort } from './drive';

function jsonResponse(data: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('GoogleDriveSyncPort', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds the live file and retains its current revision and ETag', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'live', name: 'finance-live.db' }] }))
      .mockResolvedValueOnce(jsonResponse(
        { id: 'live', name: 'finance-live.db', headRevisionId: 'revision-4', modifiedTime: '2026-03-01T10:00:00Z' },
        { ETag: '"etag-4"' },
      ));

    const live = await new GoogleDriveSyncPort('drive-token').findLiveFile();

    expect(live).toEqual({
      id: 'live',
      name: 'finance-live.db',
      revisionId: 'revision-4',
      modifiedTime: '2026-03-01T10:00:00Z',
      etag: '"etag-4"',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain('finance-live.db');
  });

  it('requires a Drive reconnect after an expired access token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));

    await expect(new GoogleDriveSyncPort('expired').listSnapshots()).rejects.toBeInstanceOf(
      DriveReconnectRequiredError,
    );
  });

  it('reports a missing Drive scope separately from an expired token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }),
      { status: 403 },
    ));

    await expect(new GoogleDriveSyncPort('no-scope').listSnapshots()).rejects.toBeInstanceOf(
      DriveAccessMissingError,
    );
  });

  it('streams download progress for the loading screen', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3, 4]), {
      headers: { 'Content-Length': '4' },
    }));
    const progress = vi.fn();

    const bytes = await new GoogleDriveSyncPort('drive-token', { onDownloadProgress: progress }).download('live');

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(progress).toHaveBeenCalledWith(0, 4);
    expect(progress).toHaveBeenLastCalledWith(4, 4);
  });

  it('uploads an export into the Finance Tracker Drive folder', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'export', name: 'Finance-Tracker.xlsx' }));

    await expect(
      new GoogleDriveSyncPort('drive-token').uploadFile(
        'Finance-Tracker.xlsx',
        Uint8Array.from([1, 2, 3]),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).resolves.toEqual({ id: 'export', name: 'Finance-Tracker.xlsx' });
    expect(String(fetchMock.mock.calls[1][0])).toContain('uploadType=multipart');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
  });

  it('snapshots duplicate live files before deleting them', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder', name: 'Finance Tracker' }] }))
      .mockResolvedValueOnce(jsonResponse({
        files: [
          { id: 'older', name: 'finance-live.db', modifiedTime: '2026-03-01T09:00:00Z' },
          { id: 'canonical', name: 'finance-live.db', modifiedTime: '2026-03-01T10:00:00Z' },
        ],
      }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3])))
      .mockResolvedValueOnce(jsonResponse({
        id: 'snapshot',
        name: 'Finance-Tracker-backup-duplicate-older.db',
        modifiedTime: '2026-03-01T10:01:00Z',
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(
        { id: 'canonical', name: 'finance-live.db', headRevisionId: 'revision-4' },
        { ETag: '"etag-4"' },
      ));

    await expect(new GoogleDriveSyncPort('drive-token').findLiveFile()).resolves.toMatchObject({
      id: 'canonical',
      revisionId: 'revision-4',
    });

    const calls = fetchMock.mock.calls;
    expect(String(calls[2][0])).toContain('older?alt=media');
    expect(String(calls[3][0])).toContain('uploadType=multipart');
    expect(calls[3][1]?.method).toBe('POST');
    expect(String(calls[4][0])).toContain('/older');
    expect(calls[4][1]?.method).toBe('DELETE');
  });
});
