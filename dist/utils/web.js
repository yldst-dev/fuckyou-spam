"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWebPageContent = fetchWebPageContent;
const axios_1 = __importDefault(require("axios"));
const jsdom_1 = require("jsdom");
const readability_1 = require("@mozilla/readability");
const logger_1 = require("../logger");
async function fetchWebPageContent(url) {
    try {
        const { data } = await axios_1.default.get(url, { timeout: 5000 });
        const dom = new jsdom_1.JSDOM(data, { url });
        const reader = new readability_1.Readability(dom.window.document);
        const article = reader.parse();
        return {
            title: article?.title || null,
            siteName: (dom.window.document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) || null,
            content: article?.textContent || null,
        };
    }
    catch (error) {
        logger_1.logger.warn('⚠️ 웹페이지 내용 분석 실패', { url, error: error.message, service: 'web' });
        return null;
    }
}
//# sourceMappingURL=web.js.map