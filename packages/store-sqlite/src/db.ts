import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type OpenPeachDb = Database.Database;

export function openPeachDb(path: string): OpenPeachDb {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

export function openPeachReadonlyDb(path: string): OpenPeachDb {
  const db = new Database(path, {
    fileMustExist: true,
    readonly: true,
  });
  db.pragma("foreign_keys = ON");

  return db;
}
