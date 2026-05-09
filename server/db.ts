import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  // Pure in-memory database — message ciphertext never touches disk.
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      sender_label TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_messages_created ON messages(created_at);
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
