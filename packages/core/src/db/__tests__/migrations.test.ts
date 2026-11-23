import {
  CURRENT_SCHEMA_VERSION,
  migrateSchema,
  UnsupportedSchemaVersionError,
  type MigrationDatabase,
} from '../migrations';

function createDatabase(initialVersion: number): {
  adapter: MigrationDatabase;
  executed: string[];
  getVersion: () => number;
} {
  let version = initialVersion;
  const executed: string[] = [];
  return {
    adapter: {
      execute(sql) {
        executed.push(sql);
        const nextVersion = sql.match(/^PRAGMA user_version = (\d+);$/)?.[1];
        if (nextVersion) version = Number(nextVersion);
      },
      all<T>(sql) {
        if (sql === 'PRAGMA user_version;') {
          return [{ user_version: version }] as T[];
        }
        return [] as T[];
      },
    },
    executed,
    getVersion: () => version,
  };
}

describe('migrateSchema', () => {
  it('creates the schema and records its version for a fresh database', () => {
    const database = createDatabase(0);

    migrateSchema(database.adapter);

    expect(database.getVersion()).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.executed).toContain('PRAGMA user_version = 1;');
    expect(database.executed).toContain(
      'ALTER TABLE transactions ADD COLUMN transfer_role TEXT;',
    );
  });

  it('rejects a database created by a newer app before changing it', () => {
    const database = createDatabase(CURRENT_SCHEMA_VERSION + 1);

    expect(() => migrateSchema(database.adapter)).toThrow(UnsupportedSchemaVersionError);
    expect(database.executed).toEqual([]);
  });
});
