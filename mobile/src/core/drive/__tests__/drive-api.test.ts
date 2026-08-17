import {
  BACKUP_FOLDER_NAME,
  buildListUrl,
  buildMultipartRelatedBody,
  bytesToBase64,
  createFileMetaBody,
  createFolderBody,
  DRIVE_FILES_URL,
  DRIVE_UPLOAD_URL,
  escapeQueryValue,
  folderChildrenQuery,
  folderSearchQuery,
  mediaDownloadUrl,
  mediaUpdateUrl,
  multipartRelatedContentType,
  multipartUploadUrl,
  parseFileId,
  parseFileList,
  pickLatestBackup,
  shouldRestoreFromDrive,
} from '../drive-api';

describe('query building', () => {
  it('escapes single quotes and backslashes in query values', () => {
    expect(escapeQueryValue("O'Brien")).toBe("O\\'Brien");
    expect(escapeQueryValue('a\\b')).toBe('a\\\\b');
  });

  it('builds a folder search query for our backup folder', () => {
    expect(folderSearchQuery()).toBe(
      "mimeType='application/vnd.google-apps.folder' and name='Finance Tracker' and trashed=false",
    );
  });

  it("lists a folder's children by parent id", () => {
    expect(folderChildrenQuery('abc123')).toBe("'abc123' in parents and trashed=false");
  });
});

describe('shouldRestoreFromDrive', () => {
  it('restores on a fresh install (no local timestamp)', () => {
    expect(shouldRestoreFromDrive(null, '2026-08-17T10:00:00.000Z')).toBe(true);
  });

  it('restores when the Drive backup is newer than local data', () => {
    expect(shouldRestoreFromDrive('2026-08-17T09:00:00.000Z', '2026-08-17T10:00:00.000Z')).toBe(true);
  });

  it('keeps local when it is newer or the same age as the backup', () => {
    expect(shouldRestoreFromDrive('2026-08-17T11:00:00.000Z', '2026-08-17T10:00:00.000Z')).toBe(false);
    expect(shouldRestoreFromDrive('2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z')).toBe(false);
  });

  it('never restores when the Drive timestamp is missing or unparseable', () => {
    expect(shouldRestoreFromDrive('2026-08-17T09:00:00.000Z', undefined)).toBe(false);
    expect(shouldRestoreFromDrive('2026-08-17T09:00:00.000Z', 'not-a-date')).toBe(false);
  });

  it('restores when local timestamp is corrupt but a valid backup exists', () => {
    expect(shouldRestoreFromDrive('garbage', '2026-08-17T10:00:00.000Z')).toBe(true);
  });
});

describe('buildListUrl', () => {
  it('url-encodes the query and defaults fields + spaces', () => {
    const url = buildListUrl(folderChildrenQuery('id1'));
    expect(url.startsWith(`${DRIVE_FILES_URL}?`)).toBe(true);
    // encodeURIComponent leaves single quotes unescaped (Drive accepts them literally).
    expect(url).toContain("q='id1'%20in%20parents%20and%20trashed%3Dfalse");
    expect(url).toContain('fields=files(id%2Cname%2CmodifiedTime)');
    expect(url).toContain('spaces=drive');
  });

  it('adds orderBy and pageSize when given', () => {
    const url = buildListUrl('q', { orderBy: 'modifiedTime desc', pageSize: 50, fields: 'files(id)' });
    expect(url).toContain('orderBy=modifiedTime%20desc');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('fields=files(id)');
  });
});

describe('bodies and upload/download urls', () => {
  it('creates a folder body with the folder MIME type', () => {
    expect(createFolderBody()).toEqual({
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    });
  });

  it('creates a file metadata body parented to the folder', () => {
    expect(createFileMetaBody('backup.db', 'folder1')).toEqual({
      name: 'backup.db',
      parents: ['folder1'],
    });
  });

  it('builds media update (upload) and download urls', () => {
    expect(mediaUpdateUrl('f 1')).toBe(`${DRIVE_UPLOAD_URL}/f%201?uploadType=media`);
    expect(mediaDownloadUrl('f 1')).toBe(`${DRIVE_FILES_URL}/f%201?alt=media`);
  });
});

describe('response parsing', () => {
  it('parses a file id from a create response', () => {
    expect(parseFileId({ id: 'x' })).toBe('x');
    expect(parseFileId({})).toBeNull();
    expect(parseFileId(null)).toBeNull();
    expect(parseFileId('nope')).toBeNull();
  });

  it('parses a file list and skips malformed entries', () => {
    const json = {
      files: [
        { id: 'a', name: 'one.db', modifiedTime: '2026-08-16T08:15:00.000Z' },
        { id: 'b', name: 'two.db' },
        { id: 3, name: 'bad-id' },
        { name: 'no-id' },
        null,
      ],
    };
    expect(parseFileList(json)).toEqual([
      { id: 'a', name: 'one.db', modifiedTime: '2026-08-16T08:15:00.000Z' },
      { id: 'b', name: 'two.db', modifiedTime: undefined },
    ]);
  });

  it('returns [] for non-list responses', () => {
    expect(parseFileList(null)).toEqual([]);
    expect(parseFileList({})).toEqual([]);
    expect(parseFileList({ files: 'x' })).toEqual([]);
  });
});

describe('bytesToBase64', () => {
  const enc = (s: string) => bytesToBase64(new Uint8Array([...s].map((c) => c.charCodeAt(0))));

  it('encodes the empty array', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });

  it('encodes with correct padding for each length mod 3', () => {
    expect(enc('Man')).toBe('TWFu'); // 3 bytes, no padding
    expect(enc('Ma')).toBe('TWE='); // 2 bytes, one pad
    expect(enc('M')).toBe('TQ=='); // 1 byte, two pads
  });

  it('encodes high bytes correctly', () => {
    expect(bytesToBase64(new Uint8Array([255, 254, 253]))).toBe('//79');
    expect(bytesToBase64(new Uint8Array([0, 0, 0]))).toBe('AAAA');
  });

  it('matches the canonical base64 encoding for arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 42, 99, 250]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('multipart upload', () => {
  it('builds the upload url and content-type', () => {
    expect(multipartUploadUrl()).toBe(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,parents`);
    expect(multipartRelatedContentType('BND')).toBe('multipart/related; boundary=BND');
  });

  it('builds a related body with metadata (incl. parents) then a base64 media part', () => {
    const body = buildMultipartRelatedBody(
      createFileMetaBody('backup.db', 'folder1'),
      'QUJD',
      'application/x-sqlite3',
      'BND',
    );
    expect(body).toBe(
      [
        '--BND',
        'Content-Type: application/json; charset=UTF-8',
        '',
        '{"name":"backup.db","parents":["folder1"]}',
        '--BND',
        'Content-Type: application/x-sqlite3',
        'Content-Transfer-Encoding: base64',
        '',
        'QUJD',
        '--BND--',
      ].join('\r\n'),
    );
  });
});

describe('pickLatestBackup', () => {
  it('returns null for an empty list', () => {
    expect(pickLatestBackup([])).toBeNull();
  });

  it('picks the newest by modifiedTime', () => {
    const files = [
      { id: 'a', name: 'a.db', modifiedTime: '2026-08-14T00:00:00.000Z' },
      { id: 'c', name: 'c.db', modifiedTime: '2026-08-16T00:00:00.000Z' },
      { id: 'b', name: 'b.db', modifiedTime: '2026-08-15T00:00:00.000Z' },
    ];
    expect(pickLatestBackup(files)?.id).toBe('c');
  });

  it('falls back to filename (which embeds the timestamp) when modifiedTime is missing', () => {
    const files = [
      { id: 'a', name: 'FinanceTracker-backup-2026-08-14-0800.db' },
      { id: 'b', name: 'FinanceTracker-backup-2026-08-16-0900.db' },
    ];
    expect(pickLatestBackup(files)?.id).toBe('b');
  });
});
