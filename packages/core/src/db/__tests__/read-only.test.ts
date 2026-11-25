import {
  ReadOnlyError,
  assertWritable,
  configureDatabaseProvider,
  getDb,
  isReadOnly,
  isReadOnlyError,
  setReadOnly,
  subscribeReadOnly,
  type FinanceDatabase,
} from '../runtime';

function fakeDb() {
  const calls: string[] = [];
  const db = {
    marker: 'raw',
    select: () => {
      calls.push('select');
      return 'rows';
    },
    insert: () => {
      calls.push('insert');
      return 'inserted';
    },
    update: () => calls.push('update'),
    delete: () => calls.push('delete'),
    transaction: () => calls.push('transaction'),
    run: () => calls.push('run'),
  };
  configureDatabaseProvider(() => ({
    db: db as unknown as FinanceDatabase,
    getMeta: () => null,
    setMeta: () => undefined,
    deleteMeta: () => undefined,
  }));
  return { db, calls };
}

afterEach(() => setReadOnly(false));

describe('view only guard', () => {
  it('lets reads and writes through while editing', () => {
    const { calls } = fakeDb();
    const db = getDb() as unknown as ReturnType<typeof fakeDb>['db'];

    expect(db.select()).toBe('rows');
    expect(db.insert()).toBe('inserted');
    expect(db.marker).toBe('raw');
    expect(calls).toEqual(['select', 'insert']);
  });

  it('blocks every write entry point in view only, but not reads', () => {
    const { calls } = fakeDb();
    const db = getDb() as unknown as ReturnType<typeof fakeDb>['db'];
    setReadOnly(true);

    expect(db.select()).toBe('rows');
    for (const write of [db.insert, db.update, db.delete, db.transaction, db.run]) {
      expect(() => write()).toThrow(ReadOnlyError);
    }
    expect(() => assertWritable()).toThrow('View only. Take over to edit.');
    expect(calls).toEqual(['select']);
  });

  it('checks at call time, so a handle taken before view only is still guarded', () => {
    fakeDb();
    const db = getDb() as unknown as ReturnType<typeof fakeDb>['db'];
    setReadOnly(true);
    expect(() => db.insert()).toThrow(ReadOnlyError);
    setReadOnly(false);
    expect(db.insert()).toBe('inserted');
  });

  it('notifies subscribers only on a change', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeReadOnly(listener);
    setReadOnly(true);
    setReadOnly(true);
    expect(isReadOnly()).toBe(true);
    setReadOnly(false);
    unsubscribe();
    setReadOnly(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('recognises the error by name too', () => {
    const copied = new Error('x');
    copied.name = 'ReadOnlyError';
    expect(isReadOnlyError(copied)).toBe(true);
    expect(isReadOnlyError(new Error('x'))).toBe(false);
  });
});
