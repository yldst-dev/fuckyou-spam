"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractUrlsFromText = extractUrlsFromText;
exports.hasTelegramGroupLink = hasTelegramGroupLink;
exports.isGroupMember = isGroupMember;
exports.calcPriority = calcPriority;
const telegram_1 = require("../services/telegram");
const logger_1 = require("../logger");
function extractUrlsFromText(text) {
    if (!text)
        return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches || [];
}
function hasTelegramGroupLink(text) {
    if (!text)
        return false;
    const telegramLinkRegex = /(https?:\/\/)?(t\.me\/|telegram\.me\/|telegram\.dog\/)[A-Za-z0-9_]+/gi;
    return telegramLinkRegex.test(text);
}
async function isGroupMember(chatId, userId) {
    try {
        const member = await telegram_1.bot.getChatMember(chatId, userId);
        return !['left', 'kicked'].includes(member.status);
    }
    catch (error) {
        logger_1.logger.warn('⚠️ 사용자 멤버십 확인 실패', { chatId, userId, error: error.message, service: 'bot' });
        return false;
    }
}
function calcPriority({ text, isMember }) {
    let priority = 1;
    const hasTgLink = hasTelegramGroupLink(text);
    const urls = extractUrlsFromText(text);
    if (hasTgLink)
        priority += 20;
    if (urls.length > 0)
        priority += 5;
    if (!isMember)
        priority += 10;
    return priority;
}
//# sourceMappingURL=message.js.map