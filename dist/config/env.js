"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paths = exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function parseIntMaybe(value) {
    if (!value)
        return undefined;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? undefined : n;
}
exports.env = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    CEREBRAS_MODEL: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    BOT_USERNAME: process.env.BOT_USERNAME,
    ADMIN_USER_ID: parseIntMaybe(process.env.ADMIN_USER_ID),
    ADMIN_GROUP_ID: (() => {
        const v = parseIntMaybe(process.env.ADMIN_GROUP_ID);
        if (v && v > 0)
            return -v; // ensure negative for telegram groups
        return v;
    })(),
    ALLOWED_CHAT_IDS: process.env.ALLOWED_CHAT_IDS
        ? process.env.ALLOWED_CHAT_IDS.split(',')
            .map((id) => id.trim())
            .filter((id) => id !== '')
            .map((id) => parseInt(id, 10))
            .filter((id) => !Number.isNaN(id))
        : undefined,
    NODE_ENV: process.env.NODE_ENV || 'development',
};
exports.paths = {
    logsDir: 'logs',
    dataDir: 'data',
    dbPath: 'data/whitelist.db',
};
//# sourceMappingURL=env.js.map