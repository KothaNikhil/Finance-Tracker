import { CREATE_TABLES_SQL } from './schema';

export const CURRENT_SCHEMA_VERSION = 2;

export interface MigrationDatabase {
  execute(sql: string): void;
  all<T>(sql: string): T[];
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly databaseVersion: number, readonly supportedVersion: number) {
    super(
      `This database uses schema version ${databaseVersion}, but this app supports up to ${supportedVersion}. Update the app before continuing.`,
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

function hasColumn(database: MigrationDatabase, table: string, column: string): boolean {
  const columns = database.all<{ name: string }>(`PRAGMA table_info(${table});`);
  return columns.some((entry) => entry.name === column);
}

function addColumn(
  database: MigrationDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(database, table, column)) {
    database.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function migrateSchema(database: MigrationDatabase): void {
  const version = Number(database.all<{ user_version: number }>('PRAGMA user_version;')[0]?.user_version ?? 0);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version, CURRENT_SCHEMA_VERSION);
  }
  if (version === CURRENT_SCHEMA_VERSION) return;

  database.execute(CREATE_TABLES_SQL);

  addColumn(database, 'transactions', 'transfer_role', 'TEXT');
  addColumn(database, 'transactions', 'loan_id', 'INTEGER');
  addColumn(database, 'transactions', 'import_id', 'INTEGER');
  addColumn(database, 'transactions', 'linked_import_id', 'INTEGER');
  addColumn(database, 'transactions', 'note', 'TEXT');
  addColumn(database, 'transactions', 'original_direction', 'TEXT');
  addColumn(database, 'imports', 'card_last4', 'TEXT');
  addColumn(database, 'imports', 'statement_month', 'TEXT');
  addColumn(database, 'imports', 'total_due_paise', 'INTEGER');
  addColumn(database, 'imports', 'batch_key', 'TEXT');
  addColumn(database, 'loan_allocations', 'part', 'TEXT');

  database.execute('CREATE INDEX IF NOT EXISTS idx_transactions_loan ON transactions(loan_id);');
  database.execute('CREATE INDEX IF NOT EXISTS idx_transactions_import ON transactions(import_id);');
  database.execute(
    'CREATE INDEX IF NOT EXISTS idx_transactions_linked_import ON transactions(linked_import_id);',
  );
  database.execute('CREATE INDEX IF NOT EXISTS idx_imports_batch ON imports(batch_key);');
  database.execute(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
}
