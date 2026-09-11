import assert from 'node:assert/strict';
import test from 'node:test';
import { SQL } from '../../../test-support/database.mjs';
import { runDatabaseTransaction, verifyDatabaseIntegrity } from './sqlite-transaction.ts';

function rowCount(db, table) {
  const result = db.exec(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

test('runDatabaseTransaction commits a valid mutation and returns its value', () => {
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const value = runDatabaseTransaction(db, (transaction) => {
      transaction.run("INSERT INTO records (value) VALUES ('kept')");
      return 'result';
    });

    assert.equal(value, 'result');
    assert.equal(rowCount(db, 'records'), 1);
    verifyDatabaseIntegrity(db);
  } finally {
    db.close();
  }
});

test('runDatabaseTransaction rolls back when the mutation fails', () => {
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');

    assert.throws(
      () => runDatabaseTransaction(db, (transaction) => {
        transaction.run("INSERT INTO records (value) VALUES ('discarded')");
        throw new Error('stop');
      }),
      /stop/,
    );
    assert.equal(rowCount(db, 'records'), 0);
  } finally {
    db.close();
  }
});

test('runDatabaseTransaction rejects foreign-key violations before commit', () => {
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE parents (id INTEGER PRIMARY KEY)');
    db.run('CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))');

    assert.throws(
      () => runDatabaseTransaction(db, (transaction) => {
        transaction.run('INSERT INTO children (parent_id) VALUES (99)');
      }),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(rowCount(db, 'children'), 0);
  } finally {
    db.close();
  }
});
