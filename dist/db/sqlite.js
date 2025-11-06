"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.addToWhitelist = addToWhitelist;
exports.removeFromWhitelist = removeFromWhitelist;
exports.isAllowedChat = isAllowedChat;
exports.getWhitelistStats = getWhitelistStats;
exports.closeDb = closeDb;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const env_1 = require("../config/env");
const logger_1 = require("../logger");
sqlite3_1.default.verbose();
let db = null;
function ensureDataDir() {
    const dir = path_1.default.resolve(env_1.paths.dataDir);
    try {
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true, mode: 0o755 });
            logger_1.logger.info('📁 데이터 디렉토리 생성 완료', { dbDir: dir, service: 'db' });
        }
        const testFile = path_1.default.join(dir, '.write-test');
        fs_1.default.writeFileSync(testFile, 'test');
        fs_1.default.unlinkSync(testFile);
        logger_1.logger.info('✅ 데이터 디렉토리 쓰기 권한 확인 완료', { service: 'db' });
    }
    catch (error) {
        logger_1.logger.error('❌ 데이터 디렉토리 접근 실패', {
            error: error.message,
            dbDir: dir,
            service: 'db',
        });
        throw error;
    }
}
function getDb() {
    if (db)
        return db;
    ensureDataDir();
    const dbPath = path_1.default.resolve(env_1.paths.dbPath);
    logger_1.logger.info('🔄 SQLite 데이터베이스 초기화 시작', { dbPath, service: 'db' });
    db = new sqlite3_1.default.Database(dbPath, sqlite3_1.default.OPEN_READWRITE | sqlite3_1.default.OPEN_CREATE, (err) => {
        if (err) {
            logger_1.logger.error('❌ SQLite 데이터베이스 연결 실패', {
                error: err.message,
                dbPath,
                service: 'db',
            });
            throw err;
        }
        else {
            logger_1.logger.info('✅ SQLite 데이터베이스 연결 성공', { dbPath, service: 'db' });
        }
    });
    db.on('error', (err) => {
        logger_1.logger.error('❌ SQLite 데이터베이스 런타임 오류', {
            error: err.message,
            service: 'db',
        });
    });
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS whitelist (
        chat_id INTEGER PRIMARY KEY,
        chat_title TEXT,
        chat_type TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        added_by INTEGER
      )`);
    });
    return db;
}
async function addToWhitelist(chatId, chatTitle, chatType, addedBy) {
    const database = getDb();
    return new Promise((resolve, reject) => {
        database.run(`INSERT OR REPLACE INTO whitelist (chat_id, chat_title, chat_type, added_by) VALUES (?, ?, ?, ?)`, [chatId, chatTitle, chatType, addedBy ?? null], function (err) {
            if (err)
                reject(err);
            else
                resolve(this.changes > 0);
        });
    });
}
async function removeFromWhitelist(chatId) {
    const database = getDb();
    return new Promise((resolve, reject) => {
        database.run(`DELETE FROM whitelist WHERE chat_id = ?`, [chatId], function (err) {
            if (err)
                reject(err);
            else
                resolve(this.changes > 0);
        });
    });
}
async function isAllowedChat(chatId) {
    const database = getDb();
    return new Promise((resolve, reject) => {
        database.get(`SELECT chat_id FROM whitelist WHERE chat_id = ?`, [chatId], (err, row) => {
            if (err)
                reject(err);
            else
                resolve(!!row);
        });
    });
}
async function getWhitelistStats() {
    const database = getDb();
    return new Promise((resolve, reject) => {
        database.all(`SELECT chat_id, chat_title, chat_type, added_at, added_by FROM whitelist ORDER BY added_at DESC`, (err, rows) => {
            if (err)
                reject(err);
            else
                resolve(rows);
        });
    });
}
function closeDb() {
    return new Promise((resolve, reject) => {
        if (!db)
            return resolve();
        db.close((err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
//# sourceMappingURL=sqlite.js.map