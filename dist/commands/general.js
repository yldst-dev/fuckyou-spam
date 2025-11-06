"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGeneralCommands = registerGeneralCommands;
const logger_1 = require("../logger");
const sqlite_1 = require("../db/sqlite");
function registerGeneralCommands(bot, getStatus) {
    // /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const isAllowed = await (0, sqlite_1.isAllowedChat)(chatId);
        const message = `👋 안녕하세요! 스팸 감지 봇입니다.\n\n이 봇은 그룹 메시지를 분석하여 스팸을 자동으로 삭제합니다.\n\n현재 그룹 상태: ${isAllowed ? '✅ 활성화' : '❌ 비활성화'}\n\n명령어 목록은 /help 를 입력하세요.`;
        bot.sendMessage(chatId, message);
    });
    // /help
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const isAllowed = await (0, sqlite_1.isAllowedChat)(chatId);
        let helpMessage = '**일반 명령어:**\n';
        helpMessage += '/start - 봇 소개 및 사용법 안내\n';
        helpMessage += '/help - 도움말 및 명령어 목록\n';
        helpMessage += '/status - 봇 상태 및 큐 대기 메시지 수 확인\n';
        helpMessage += '/chatid - 현재 그룹의 채팅 ID 확인\n';
        helpMessage += '/ping - 봇 응답 속도 측정\n\n';
        if (msg.chat.type !== 'private') {
            helpMessage += isAllowed ? '✅ 이 그룹은 스팸 감지가 활성화되어 있습니다.' : '❌ 이 그룹은 스팸 감지가 비활성화되어 있습니다.';
        }
        bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });
    // /status
    bot.onText(/\/status/, (msg) => {
        const chatId = msg.chat.id;
        const { highPriority, normalPriority } = getStatus();
        const message = `📊 **봇 상태**\n\n🧵 대기 중인 메시지:\n- 높은 우선순위: ${highPriority}개\n- 일반 우선순위: ${normalPriority}개`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    // /chatid
    bot.onText(/\/chatid/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🆔 현재 채팅 ID: ${chatId}`);
    });
    // /ping
    bot.onText(/\/ping/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const start = Date.now();
            const sentMessage = await bot.sendMessage(chatId, '🏓 Pong 측정 중...');
            const responseTime = Date.now() - start;
            await bot.editMessageText(`🏓 **Pong!**\n\n⚡ 응답 속도: **${responseTime}ms**\n📡 상태: ${responseTime < 100 ? '🟢 매우 빠름' : responseTime < 300 ? '🟡 보통' : '🔴 느림'}`, { chat_id: chatId, message_id: sentMessage.message_id, parse_mode: 'Markdown' });
            logger_1.logger.info('🏓 Ping 명령어 실행', { chatId, responseTime, service: 'bot' });
        }
        catch (error) {
            logger_1.logger.error('❌ Ping 명령어 실행 실패', { error: error.message, chatId, service: 'bot' });
            bot.sendMessage(chatId, '❌ Ping 측정에 실패했습니다.');
        }
    });
}
//# sourceMappingURL=general.js.map