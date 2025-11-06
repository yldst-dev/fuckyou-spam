"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const env_1 = require("./config/env");
const koreanTimeFormat = winston_1.default.format.timestamp({
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
const fileLogFormat = winston_1.default.format.combine(koreanTimeFormat, winston_1.default.format.errors({ stack: true }), winston_1.default.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `[${timestamp}] [${(level || '').toUpperCase()}] [${service || 'app'}] ${message}${metaStr}`;
}));
const consoleLogFormat = winston_1.default.format.combine(koreanTimeFormat, winston_1.default.format.colorize({ all: true }), winston_1.default.format.printf(({ timestamp, level, message, service }) => {
    return `[${timestamp}] [${level}] [${service || 'app'}] ${message}`;
}));
exports.logger = winston_1.default.createLogger({
    level: 'info',
    transports: [
        new winston_1.default.transports.Console({
            format: consoleLogFormat,
        }),
        new winston_1.default.transports.File({
            filename: `${env_1.paths.logsDir}/combined.log`,
            format: fileLogFormat,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 3,
        }),
        new winston_1.default.transports.File({
            filename: `${env_1.paths.logsDir}/error.log`,
            level: 'error',
            format: fileLogFormat,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 3,
        }),
    ],
});
//# sourceMappingURL=logger.js.map