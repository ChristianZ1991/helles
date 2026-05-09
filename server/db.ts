import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db: DatabaseSync | null = null;

function needsMessagesMigration(database: DatabaseSync): boolean {
  try {
    const rows = database.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (rows.length === 0) return false;
    return !rows.some((r) => r.name === "sender_label");
  } catch {
    return true;
  }
}

export function getDb(dataDir: string): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "helles.sqlite");
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  if (needsMessagesMigration(db)) {
    db.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_label TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  `);
  return db;
}

export function clearAllMessages(database: DatabaseSync): void {
  database.prepare("DELETE FROM messages").run();
}

export function closeDb(): void {
  db?.close();
  db = null;
}
