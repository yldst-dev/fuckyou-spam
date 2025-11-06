"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const logger_1 = require("./logger");
const telegram_1 = require("./services/telegram");
const cerebras_1 = require("./services/cerebras");
const web_1 = require("./utils/web");
const message_1 = require("./utils/message");
const sqlite_1 = require("./db/sqlite");
const node_cron_1 = __importDefault(require("node-cron"));
const fs_1 = __importDefault(require("fs"));
const general_1 = require("./commands/general");
const admin_1 = require("./commands/admin");
// 기본 경고 및 설정 로깅
if (!env_1.env.TELEGRAM_BOT_TOKEN) {
    logger_1.logger.error('❌ TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env를 확인하세요.', { service: 'boot' });
    process.exit(1);
}
if (!env_1.env.ADMIN_USER_ID) {
    logger_1.logger.warn('⚠️ ADMIN_USER_ID가 설정되지 않았습니다. 관리자 기능이 비활성화됩니다.', { service: 'boot' });
}
if (!env_1.env.ADMIN_GROUP_ID) {
    logger_1.logger.warn('⚠️ ADMIN_GROUP_ID가 설정되지 않았습니다. 관리자 그룹 기능이 비활성화됩니다.', { service: 'boot' });
}
if (env_1.env.ADMIN_USER_ID && env_1.env.ADMIN_GROUP_ID) {
    logger_1.logger.info('✅ 관리자 설정 완료', { adminUserId: env_1.env.ADMIN_USER_ID, adminGroupId: env_1.env.ADMIN_GROUP_ID, service: 'boot' });
}
// 로그/데이터 디렉토리 준비
try {
    if (!fs_1.default.existsSync(env_1.paths.logsDir))
        fs_1.default.mkdirSync(env_1.paths.logsDir, { recursive: true, mode: 0o755 });
    if (!fs_1.default.existsSync(env_1.paths.dataDir))
        fs_1.default.mkdirSync(env_1.paths.dataDir, { recursive: true, mode: 0o755 });
}
catch (err) {
    logger_1.logger.error('❌ 로그/데이터 디렉토리 생성 실패', { error: err.message, service: 'boot' });
    process.exit(1);
}
// DB 초기화 및 테이블 준비
(0, sqlite_1.getDb)();
// 기존 환경변수 기반 화이트리스트 마이그레이션
const allowedChatIds = env_1.env.ALLOWED_CHAT_IDS;
if (allowedChatIds && allowedChatIds.length > 0) {
    (async () => {
        for (const chatId of allowedChatIds) {
            try {
                await (0, sqlite_1.addToWhitelist)(chatId, 'Legacy Group', 'group', undefined);
            }
            catch { }
        }
        logger_1.logger.info('✅ 기존 화이트리스트 데이터 마이그레이션 완료', {
            count: allowedChatIds.length,
            chatIds: allowedChatIds,
            service: 'db',
        });
    })();
}
// 명령어 등록
(0, general_1.registerGeneralCommands)(telegram_1.bot, () => ({ highPriority: highPriorityQueue.length, normalPriority: normalPriorityQueue.length }));
(0, admin_1.registerAdminCommands)(telegram_1.bot);
// 명령어 동기화 및 봇 초기화 검증
(async () => {
    await (0, telegram_1.syncBotCommands)();
    const ok = await (0, telegram_1.validateBotInitialization)();
    if (!ok) {
        logger_1.logger.error('💥 봇 초기화 검증 실패로 인한 종료');
        process.exit(1);
    }
})();
let highPriorityQueue = [];
let normalPriorityQueue = [];
let processingTimeout = null;
logger_1.logger.info('🚀 텔레그램 스팸 감지 봇이 시작되었습니다', { service: 'boot' });
// 관리자 그룹 알림
setTimeout(async () => {
    if (env_1.env.ADMIN_GROUP_ID) {
        try {
            const startTime = new Date().toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });
            const stats = await (0, sqlite_1.getWhitelistStats)();
            const nodeVersion = process.version;
            const uptime = process.uptime();
            const adminStartMessage = `🚀 **스팸 감지 봇 시작 완료**\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⏰ **시작 시간:** ${startTime}\n🏠 **활성 그룹:** ${stats.length}개 화이트리스트\n🤖 **시스템 정보:**\n   └ Node.js ${nodeVersion}\n   └ 가동 시간: ${Math.floor(uptime)}초\n\n📋 **활성화된 기능:**\n   ✅ AI 스팸 감지 (Cerebras Llama-4-Scout)\n   ✅ 우선순위 기반 큐 처리\n   ✅ 웹페이지 내용 분석\n   ✅ 자동 재부팅 (00:00, 12:00 KST)\n   ✅ 실시간 로그 모니터링\n\n🔄 **자동 재부팅:** 매일 자정/정오 (한국시간)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🟢 **상태: 정상 작동 중**`;
            await telegram_1.bot.sendMessage(env_1.env.ADMIN_GROUP_ID, adminStartMessage, { parse_mode: 'Markdown' });
            logger_1.logger.info('✅ 관리자 그룹 시작 알림 전송 완료', { adminGroupId: env_1.env.ADMIN_GROUP_ID, service: 'bot' });
        }
        catch (error) {
            logger_1.logger.error('❌ 관리자 그룹 시작 알림 전송 실패', { error: error.message, adminGroupId: env_1.env.ADMIN_GROUP_ID, service: 'bot' });
        }
    }
}, 5000);
// 메시지 핸들러
telegram_1.bot.on('message', async (msg) => {
    try {
        // 비화이트리스트 그룹은 무시 (개인 채팅 제외)
        if (msg.chat.type !== 'private') {
            const allowed = await (0, sqlite_1.isAllowedChat)(msg.chat.id);
            if (!allowed)
                return;
        }
        const text = msg.text || msg.caption || '';
        const isMember = await (0, message_1.isGroupMember)(msg.chat.id, msg.from.id);
        const priority = (0, message_1.calcPriority)({ text, isMember });
        const metaMsg = { ...msg, _metadata: { isGroupMember: isMember, priority, processedAt: new Date() } };
        const hasTgLink = (0, message_1.hasTelegramGroupLink)(text);
        const urls = (0, message_1.extractUrlsFromText)(text);
        if (!isMember && (hasTgLink || urls.length > 0)) {
            highPriorityQueue.push(metaMsg);
            if (!processingTimeout)
                processingTimeout = setTimeout(processMessageQueue, 1000);
        }
        else if (!isMember) {
            highPriorityQueue.push(metaMsg);
            if (!processingTimeout)
                processingTimeout = setTimeout(processMessageQueue, 1000);
        }
        else {
            normalPriorityQueue.push(metaMsg);
            if (!processingTimeout)
                processingTimeout = setTimeout(processMessageQueue, 3000);
        }
    }
    catch (error) {
        logger_1.logger.error('💥 메시지 수신 처리 중 오류 발생', {
            error: error.message,
            userId: msg.from.id,
            chatId: msg.chat.id,
            service: 'bot',
        });
        const fallbackMsg = { ...msg, _metadata: { isGroupMember: false, priority: 10, processedAt: new Date(), error: error.message } };
        highPriorityQueue.push(fallbackMsg);
    }
});
async function processMessageQueue() {
    const highPriorityMessages = [...highPriorityQueue];
    const normalPriorityMessages = [...normalPriorityQueue];
    if (highPriorityMessages.length === 0 && normalPriorityMessages.length === 0)
        return;
    highPriorityQueue = [];
    normalPriorityQueue = [];
    if (processingTimeout) {
        clearTimeout(processingTimeout);
        processingTimeout = null;
    }
    const allMessages = [...highPriorityMessages, ...normalPriorityMessages];
    logger_1.logger.info('🔍 스팸 검사 시작', { totalMessages: allMessages.length, highPriority: highPriorityMessages.length, normalPriority: normalPriorityMessages.length, service: 'bot' });
    // 메시지 프롬프트 구성
    const messagePromises = allMessages.map(async (m) => {
        const text = m.text || m.caption || '[미디어 메시지]';
        const username = m.from.username || m.from.first_name || 'Unknown';
        const priority = m._metadata?.priority ?? 1;
        const urls = (0, message_1.extractUrlsFromText)(text);
        let webContent = '';
        for (const url of urls.slice(0, 2)) {
            const content = await (0, web_1.fetchWebPageContent)(url);
            if (content) {
                webContent += `\n웹페이지 정보 (${url}):\n`;
                webContent += `제목: ${content.title}\n`;
                webContent += `사이트: ${content.siteName}\n`;
                webContent += `내용: ${content.content}\n`;
            }
        }
        return `${m.message_id}: [${username}] [우선순위: ${priority}] ${text}${webContent}`;
    });
    const messagePrompt = (await Promise.all(messagePromises)).join('\n\n');
    try {
        const classification = await (0, cerebras_1.classifySpam)(messagePrompt);
        for (const [messageId, isSpam] of Object.entries(classification)) {
            const found = allMessages.find((m) => String(m.message_id) === String(messageId));
            if (isSpam && found)
                await deleteSpamMessage(found);
        }
    }
    catch (error) {
        logger_1.logger.error('💥 스팸 검사 처리 중 오류 발생', { error: error.message, messageCount: allMessages.length, service: 'bot' });
    }
}
async function deleteSpamMessage(msg) {
    try {
        await telegram_1.bot.deleteMessage(msg.chat.id, msg.message_id);
        const isMember = msg._metadata?.isGroupMember ?? true;
        const priority = msg._metadata?.priority ?? 1;
        const text = msg.text || msg.caption || '[미디어 메시지]';
        logger_1.logger.info('🧹 스팸 메시지 삭제', {
            chat: { id: msg.chat.id, title: msg.chat.title, type: msg.chat.type },
            user: { id: msg.from.id, username: msg.from.username, first_name: msg.from.first_name },
            message: { id: msg.message_id, text },
            metadata: { priority, is_group_member: isMember },
            service: 'bot',
        });
        if (env_1.env.ADMIN_GROUP_ID && (0, telegram_1.isAdminGroup)(env_1.env.ADMIN_GROUP_ID)) {
            const logText = `🗑️ **스팸 삭제 로그**\n\n👤 사용자: @${msg.from.username || msg.from.first_name}\n💬 내용: ${text}\n🔢 메시지 ID: ${msg.message_id}\n🏷️ 우선순위: ${priority}`;
            try {
                await telegram_1.bot.sendMessage(env_1.env.ADMIN_GROUP_ID, logText, { parse_mode: 'Markdown' });
            }
            catch { }
        }
    }
    catch (error) {
        logger_1.logger.error('❌ 스팸 메시지 삭제 실패', { error: error.message, chatId: msg.chat.id, service: 'bot' });
    }
}
// 에러 핸들링
telegram_1.bot.on('polling_error', (error) => {
    const err = error;
    if (err?.code === 'EFATAL' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') {
        logger_1.logger.warn('🔄 텔레그램 Polling 네트워크 오류 (재시도 중)', { error: err?.message, code: err?.code, service: 'bot' });
    }
    else {
        logger_1.logger.error('🔄 텔레그램 Polling 심각한 오류', { error: err?.message, code: err?.code, service: 'bot' });
    }
});
telegram_1.bot.on('webhook_error', (error) => {
    const err = error;
    logger_1.logger.error('🔗 웹훅 오류', { error: err?.message, service: 'bot' });
});
// 자동 재부팅 스케줄러
node_cron_1.default.schedule('0 0 * * *', async () => {
    const koreanTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    logger_1.logger.info('🌙 자정 자동 재부팅 시작', { scheduledTime: '00:00 KST', actualTime: koreanTime, service: 'cron' });
    if (env_1.env.ADMIN_GROUP_ID) {
        try {
            await telegram_1.bot.sendMessage(env_1.env.ADMIN_GROUP_ID, `🌙 **자정 자동 재부팅**\n\n⏰ 시각: ${koreanTime}\n🔄 상태: 재부팅 시작\n💤 5초 후 프로세스가 종료됩니다.`, { parse_mode: 'Markdown' });
        }
        catch { }
    }
    setTimeout(async () => {
        try {
            await (0, sqlite_1.closeDb)();
        }
        catch { }
        process.exit(0);
    }, 5000);
}, { timezone: 'Asia/Seoul' });
node_cron_1.default.schedule('0 12 * * *', async () => {
    const koreanTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    logger_1.logger.info('☀️ 정오 자동 재부팅 시작', { scheduledTime: '12:00 KST', actualTime: koreanTime, service: 'cron' });
    if (env_1.env.ADMIN_GROUP_ID) {
        try {
            await telegram_1.bot.sendMessage(env_1.env.ADMIN_GROUP_ID, `☀️ **정오 자동 재부팅**\n\n⏰ 시각: ${koreanTime}\n🔄 상태: 재부팅 시작\n💤 5초 후 프로세스가 종료됩니다.`, { parse_mode: 'Markdown' });
        }
        catch { }
    }
    setTimeout(async () => {
        try {
            await (0, sqlite_1.closeDb)();
        }
        catch { }
        process.exit(0);
    }, 5000);
}, { timezone: 'Asia/Seoul' });
logger_1.logger.info('⏰ 자동 재부팅 스케줄러 시작', { midnightSchedule: '00:00 KST', noonSchedule: '12:00 KST', timezone: 'Asia/Seoul', service: 'cron' });
//# sourceMappingURL=index.js.map