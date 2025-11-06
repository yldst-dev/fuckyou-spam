import dotenv from 'dotenv';

dotenv.config();

export interface AppEnv {
  TELEGRAM_BOT_TOKEN: string;
  CEREBRAS_API_KEY?: string;
  CEREBRAS_MODEL?: string;
  BOT_USERNAME?: string;
  ADMIN_USER_ID?: number;
  ADMIN_GROUP_ID?: number;
  ALLOWED_CHAT_IDS?: number[];
  NODE_ENV: string;
}

function parseIntMaybe(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export const env: AppEnv = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
  CEREBRAS_MODEL: process.env.CEREBRAS_MODEL || 'llama-4-scout-17b-16e-instruct',
  BOT_USERNAME: process.env.BOT_USERNAME,
  ADMIN_USER_ID: parseIntMaybe(process.env.ADMIN_USER_ID),
  ADMIN_GROUP_ID: (() => {
    const v = parseIntMaybe(process.env.ADMIN_GROUP_ID);
    if (v && v > 0) return -v; // ensure negative for telegram groups
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

export const paths = {
  logsDir: 'logs',
  dataDir: 'data',
  dbPath: 'data/whitelist.db',
};