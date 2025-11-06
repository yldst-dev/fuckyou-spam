import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { paths } from '../config/env';
import { logger } from '../logger';

sqlite3.verbose();

let db: sqlite3.Database | null = null;

function ensureDataDir() {
  const dir = path.resolve(paths.dataDir);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      logger.info('📁 데이터 디렉토리 생성 완료', { dbDir: dir, service: 'db' });
    }
    const testFile = path.join(dir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    logger.info('✅ 데이터 디렉토리 쓰기 권한 확인 완료', { service: 'db' });
  } catch (error: any) {
    logger.error('❌ 데이터 디렉토리 접근 실패', {
      error: error.message,
      dbDir: dir,
      service: 'db',
    });
    throw error;
  }
}

export function getDb(): sqlite3.Database {
  if (db) return db;
  ensureDataDir();
  const dbPath = path.resolve(paths.dbPath);
  logger.info('🔄 SQLite 데이터베이스 초기화 시작', { dbPath, service: 'db' });

  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      logger.error('❌ SQLite 데이터베이스 연결 실패', {
        error: err.message,
        dbPath,
        service: 'db',
      });
      throw err;
    } else {
      logger.info('✅ SQLite 데이터베이스 연결 성공', { dbPath, service: 'db' });
    }
  });

  db.on('error', (err) => {
    logger.error('❌ SQLite 데이터베이스 런타임 오류', {
      error: err.message,
      service: 'db',
    });
  });

  db.serialize(() => {
    db!.run(
      `CREATE TABLE IF NOT EXISTS whitelist (
        chat_id INTEGER PRIMARY KEY,
        chat_title TEXT,
        chat_type TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        added_by INTEGER
      )`
    );
  });

  return db;
}

export async function addToWhitelist(
  chatId: number,
  chatTitle: string | null,
  chatType: string | null,
  addedBy?: number
): Promise<boolean> {
  const database = getDb();
  return new Promise((resolve, reject) => {
    database.run(
      `INSERT OR REPLACE INTO whitelist (chat_id, chat_title, chat_type, added_by) VALUES (?, ?, ?, ?)`,
      [chatId, chatTitle, chatType, addedBy ?? null],
      function (err) {
        if (err) reject(err);
        else resolve((this as any).changes > 0);
      }
    );
  });
}

export async function removeFromWhitelist(chatId: number): Promise<boolean> {
  const database = getDb();
  return new Promise((resolve, reject) => {
    database.run(`DELETE FROM whitelist WHERE chat_id = ?`, [chatId], function (err) {
      if (err) reject(err);
      else resolve((this as any).changes > 0);
    });
  });
}

export async function isAllowedChat(chatId: number): Promise<boolean> {
  const database = getDb();
  return new Promise((resolve, reject) => {
    database.get(`SELECT chat_id FROM whitelist WHERE chat_id = ?`, [chatId], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

export interface WhitelistRow {
  chat_id: number;
  chat_title: string | null;
  chat_type: string | null;
  added_at: string;
  added_by: number | null;
}

export async function getWhitelistStats(): Promise<WhitelistRow[]> {
  const database = getDb();
  return new Promise((resolve, reject) => {
    database.all(
      `SELECT chat_id, chat_title, chat_type, added_at, added_by FROM whitelist ORDER BY added_at DESC`,
      (err, rows: WhitelistRow[]) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

export function closeDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}