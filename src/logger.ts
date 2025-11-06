import winston from 'winston';
import { paths } from './config/env';

const koreanTimeFormat = winston.format.timestamp({
  format: () => {
    return new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  },
});

const fileLogFormat = winston.format.combine(
  koreanTimeFormat,
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `[${timestamp}] [${(level || '').toUpperCase()}] [${service || 'app'}] ${message}${metaStr}`;
  })
);

const consoleLogFormat = winston.format.combine(
  koreanTimeFormat,
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, service }) => {
    return `[${timestamp}] [${level}] [${service || 'app'}] ${message}`;
  })
);

export const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({
      format: consoleLogFormat,
    }),
    new winston.transports.File({
      filename: `${paths.logsDir}/combined.log`,
      format: fileLogFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: `${paths.logsDir}/error.log`,
      level: 'error',
      format: fileLogFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});