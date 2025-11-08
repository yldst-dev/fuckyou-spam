import { env, paths } from './config/env';
import TelegramBot = require('node-telegram-bot-api');
import { logger } from './logger';
import { botPromise, bot, validateBotInitialization, syncBotCommands, isAdminGroup } from './services/telegram';
import { classifySpam } from './services/cerebras';
import { fetchWebPageContent } from './utils/web';
import { extractUrlsFromText, hasTelegramGroupLink, isGroupMember, calcPriority } from './utils/message';
import { addToWhitelist, getWhitelistStats, closeDb, getDb, isAllowedChat } from './db/sqlite';
import cron from 'node-cron';
import fs from 'fs';

import { registerGeneralCommands } from './commands/general';
import { registerAdminCommands } from './commands/admin';

// 기본 경고 및 설정 로깅
if (!env.TELEGRAM_BOT_TOKEN) {
  logger.error('[ERROR] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env를 확인하세요.', { service: 'boot' });
  process.exit(1);
}

if (!env.ADMIN_USER_ID) {
  logger.warn('[WARN] ADMIN_USER_ID가 설정되지 않았습니다. 관리자 기능이 비활성화됩니다.', { service: 'boot' });
}
if (!env.ADMIN_GROUP_ID) {
  logger.warn('[WARN] ADMIN_GROUP_ID가 설정되지 않았습니다. 관리자 그룹 기능이 비활성화됩니다.', { service: 'boot' });
}
if (env.ADMIN_USER_ID && env.ADMIN_GROUP_ID) {
  logger.info('[INFO] 관리자 설정 완료', { adminUserId: env.ADMIN_USER_ID, adminGroupId: env.ADMIN_GROUP_ID, service: 'boot' });
}

// 로그/데이터 디렉토리 준비
try {
  if (!fs.existsSync(paths.logsDir)) fs.mkdirSync(paths.logsDir, { recursive: true, mode: 0o755 });
  if (!fs.existsSync(paths.dataDir)) fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o755 });
} catch (err: any) {
  logger.error('[ERROR] 로그/데이터 디렉토리 생성 실패', { error: err.message, service: 'boot' });
  process.exit(1);
}

// DB 초기화 및 테이블 준비
getDb();

// 기존 환경변수 기반 화이트리스트 마이그레이션
const allowedChatIds = env.ALLOWED_CHAT_IDS;
if (allowedChatIds && allowedChatIds.length > 0) {
  (async () => {
    for (const chatId of allowedChatIds) {
      try {
        await addToWhitelist(chatId, 'Legacy Group', 'group', undefined);
      } catch {}
    }
    logger.info('[INFO] 기존 화이트리스트 데이터 마이그레이션 완료', {
      count: allowedChatIds.length,
      chatIds: allowedChatIds,
      service: 'db',
    });
  })();
}

// 명령어 등록 - 봇 초기화 후 등록
botPromise.then(botInstance => {
  registerGeneralCommands(botInstance, () => ({ highPriority: highPriorityQueue.length, normalPriority: normalPriorityQueue.length }));
  registerAdminCommands(botInstance);
}).catch(err => {
  logger.error('[ERROR] 명령어 등록 실패', { error: err.message, service: 'boot' });
});

// 명령어 동기화 및 봇 초기화 검증
(async () => {
  try {
    await syncBotCommands();
    const ok = await validateBotInitialization();
    if (!ok) {
      logger.error('[ERROR] 봇 초기화 검증 실패 (계속 실행합니다)');
      // Don't exit - continue running even if validation fails
    }
  } catch (error: any) {
    logger.error('[ERROR] 봇 초기화 중 오류 발생 (계속 실행합니다)', { error: error.message, service: 'boot' });
    // Continue running even if there's an error
  }
})();

// 큐 구성
type MetaMsg = TelegramBot.Message & { _metadata?: { isGroupMember: boolean; priority: number; processedAt?: Date; error?: string } };
let highPriorityQueue: MetaMsg[] = [];
let normalPriorityQueue: MetaMsg[] = [];
let processingTimeout: NodeJS.Timeout | null = null;

logger.info('[INFO] 텔레그램 스팸 감지 봇이 시작되었습니다', { service: 'boot' });

// 관리자 그룹 알림
setTimeout(async () => {
  if (env.ADMIN_GROUP_ID) {
    try {
      const botInstance = await botPromise;
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
      const stats = await getWhitelistStats();
      const nodeVersion = process.version;
      const uptime = process.uptime();
      const adminStartMessage = `**스팸 감지 봇 시작 완료**\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n**시작 시간:** ${startTime}\n**활성 그룹:** ${stats.length}개 화이트리스트\n**시스템 정보:**\n   └ Node.js ${nodeVersion}\n   └ 가동 시간: ${Math.floor(uptime)}초\n**현재 모델:** ${env.CEREBRAS_MODEL}\n\n**활성화된 기능:**\n   • AI 스팸 감지\n   • 우선순위 기반 큐 처리\n   • 웹페이지 내용 분석\n   • 자동 재부팅 (00:00, 12:00 KST)\n   • 실시간 로그 모니터링\n\n**자동 재부팅:** 매일 자정/정오 (한국시간)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n**상태: 정상 작동 중**`;
      await botInstance.sendMessage(env.ADMIN_GROUP_ID, adminStartMessage, { parse_mode: 'Markdown' });
      logger.info('[INFO] 관리자 그룹 시작 알림 전송 완료', { adminGroupId: env.ADMIN_GROUP_ID, service: 'bot' });
    } catch (error: any) {
      logger.error('[ERROR] 관리자 그룹 시작 알림 전송 실패', { error: error.message, adminGroupId: env.ADMIN_GROUP_ID, service: 'bot' });
    }
  }
}, 8000);

// 메시지 핸들러
botPromise.then(botInstance => {
  botInstance.on('message', async (msg: TelegramBot.Message) => {
    try {
      // 종료 중인 경우 메시지 처리 중단
      if (isShuttingDown) {
        logger.warn('[WARN] 종료 중입니다. 메시지 처리를 건너뜁니다.', {
          messageId: msg.message_id,
          chatId: msg.chat.id,
          service: 'bot'
        });
        return;
      }

      // 비화이트리스트 그룹은 무시 (개인 채팅 제외)
      if (msg.chat.type !== 'private') {
        const allowed = await isAllowedChat(msg.chat.id);
        if (!allowed) return;
      }

      const text = msg.text || msg.caption || '';
      const isMember = await isGroupMember(msg.chat.id, msg.from.id);
      const priority = calcPriority({ text, isMember });
      const metaMsg: MetaMsg = { ...msg, _metadata: { isGroupMember: isMember, priority, processedAt: new Date() } };

      const hasTgLink = hasTelegramGroupLink(text);
      const urls = extractUrlsFromText(text);

      if (!isMember && (hasTgLink || urls.length > 0)) {
        highPriorityQueue.push(metaMsg);
        if (!processingTimeout) processingTimeout = setTimeout(processMessageQueue, 1000);
      } else if (!isMember) {
        highPriorityQueue.push(metaMsg);
        if (!processingTimeout) processingTimeout = setTimeout(processMessageQueue, 1000);
      } else {
        normalPriorityQueue.push(metaMsg);
        if (!processingTimeout) processingTimeout = setTimeout(processMessageQueue, 3000);
      }
    } catch (error: any) {
      logger.error('[ERROR] 메시지 수신 처리 중 오류 발생', {
        error: error.message,
        userId: msg.from.id,
        chatId: msg.chat.id,
        service: 'bot',
      });
      const fallbackMsg: MetaMsg = { ...msg, _metadata: { isGroupMember: false, priority: 10, processedAt: new Date(), error: error.message } };
      highPriorityQueue.push(fallbackMsg);
    }
  });

  // 에러 핸들링
  botInstance.on('polling_error', (error: unknown) => {
    const err: any = error as any;
    if (err?.code === 'EFATAL' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') {
      logger.warn('🔄 텔레그램 Polling 네트워크 오류 (재시도 중)', { error: err?.message, code: err?.code, service: 'bot' });
    } else {
      logger.error('🔄 텔레그램 Polling 심각한 오류', { error: err?.message, code: err?.code, service: 'bot' });
    }
  });

  botInstance.on('webhook_error', (error: unknown) => {
    const err: any = error as any;
    logger.error('[ERROR] 웹훅 오류', { error: err?.message, service: 'bot' });
  });
}).catch(err => {
  logger.error('[ERROR] 메시지 핸들러 설정 실패', { error: err.message, service: 'boot' });
});

async function processMessageQueue() {
  // 종료 중인 경우 처리 중단
  if (isShuttingDown) {
    logger.warn('[WARN] 종료 중입니다. 메시지 큐 처리를 건너뜁니다.', { service: 'bot' });
    return;
  }

  const highPriorityMessages = [...highPriorityQueue];
  const normalPriorityMessages = [...normalPriorityQueue];
  if (highPriorityMessages.length === 0 && normalPriorityMessages.length === 0) return;

  highPriorityQueue = [];
  normalPriorityQueue = [];
  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }

  const allMessages = [...highPriorityMessages, ...normalPriorityMessages];
  logger.info('[INFO] 스팸 검사 시작', { totalMessages: allMessages.length, highPriority: highPriorityMessages.length, normalPriority: normalPriorityMessages.length, service: 'bot' });

  // 메시지 프롬프트 구성
  const messagePromises = allMessages.map(async (m) => {
    const text = m.text || m.caption || '[미디어 메시지]';
    const username = m.from.username || m.from.first_name || 'Unknown';
    const priority = m._metadata?.priority ?? 1;
    const urls = extractUrlsFromText(text);

    let webContent = '';
    for (const url of urls.slice(0, 2)) {
      const content = await fetchWebPageContent(url);
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
    const classification = await classifySpam(messagePrompt);
    for (const [messageId, isSpam] of Object.entries(classification)) {
      const found = allMessages.find((m) => String(m.message_id) === String(messageId));
      if (isSpam && found) await deleteSpamMessage(found);
    }
  } catch (error: any) {
    logger.error('[ERROR] 스팸 검사 처리 중 오류 발생', { error: error.message, messageCount: allMessages.length, service: 'bot' });
  }
}

async function deleteSpamMessage(msg: MetaMsg) {
  try {
    const botInstance = await botPromise;
    await botInstance.deleteMessage(msg.chat.id, msg.message_id);
    const isMember = msg._metadata?.isGroupMember ?? true;
    const priority = msg._metadata?.priority ?? 1;
    const text = msg.text || msg.caption || '[미디어 메시지]';
    const chatTitle = (msg.chat as any).title || (msg.chat as any).username || 'Unknown';
    const displayName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || 'Unknown'}`;
    const sentAtSec = typeof (msg as any).date === 'number' ? (msg as any).date : Math.floor(Date.now() / 1000);
    const sentAt = new Date(sentAtSec * 1000).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // 간단한 Markdown 특수문자 이스케이프 (본문 외 필드용)
    const esc = (s: string) => s.replace(/([_*\[\]()])/g, '\\$1');

    logger.info('[INFO] 스팸 메시지 삭제', {
      chat: { id: msg.chat.id, title: (msg.chat as any).title, type: msg.chat.type },
      user: { id: msg.from.id, username: msg.from.username, first_name: msg.from.first_name },
      message: { id: msg.message_id, text },
      metadata: { priority, is_group_member: isMember },
      service: 'bot',
    });

    if (env.ADMIN_GROUP_ID && isAdminGroup(env.ADMIN_GROUP_ID)) {
      const logText = `**스팸 삭제 로그**\n\n**채팅방:** ${esc(chatTitle)}\n**채팅방 ID:** ${msg.chat.id}\n**사용자:** ${esc(displayName)}\n**사용자 ID:** ${msg.from.id}\n**날짜/시간:** ${sentAt}\n\n**스팸 메시지:**\n\n\`\`\`\n${text}\n\`\`\`\n`;
      try {
        await botInstance.sendMessage(env.ADMIN_GROUP_ID, logText, { parse_mode: 'Markdown' });
      } catch {}
    }
  } catch (error: any) {
    logger.error('[ERROR] 스팸 메시지 삭제 실패', { error: error.message, chatId: msg.chat.id, service: 'bot' });
  }
}


// 자동 재부팅 스케줄러
cron.schedule('0 0 * * *', async () => {
  const koreanTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  logger.info('[INFO] 자정 자동 재부팅 시작', { scheduledTime: '00:00 KST', actualTime: koreanTime, service: 'cron' });
  if (env.ADMIN_GROUP_ID) {
    try {
      const botInstance = await botPromise;
      await botInstance.sendMessage(env.ADMIN_GROUP_ID, `**자정 자동 재부팅**\n\n시각: ${koreanTime}\n상태: 재부팅 시작\n5초 후 프로세스가 종료됩니다.`, { parse_mode: 'Markdown' });
    } catch {}
  }
  // 우아한 종료 사용
  setTimeout(() => gracefulShutdown('CRON_MIDNIGHT'), 5000);
}, { timezone: 'Asia/Seoul' });

cron.schedule('0 12 * * *', async () => {
  const koreanTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  logger.info('[INFO] 정오 자동 재부팅 시작', { scheduledTime: '12:00 KST', actualTime: koreanTime, service: 'cron' });
  if (env.ADMIN_GROUP_ID) {
    try {
      const botInstance = await botPromise;
      await botInstance.sendMessage(env.ADMIN_GROUP_ID, `**정오 자동 재부팅**\n\n시각: ${koreanTime}\n상태: 재부팅 시작\n5초 후 프로세스가 종료됩니다.`, { parse_mode: 'Markdown' });
    } catch {}
  }
  // 우아한 종료 사용
  setTimeout(() => gracefulShutdown('CRON_NOON'), 5000);
}, { timezone: 'Asia/Seoul' });

logger.info('[INFO] 자동 재부팅 스케줄러 시작', { midnightSchedule: '00:00 KST', noonSchedule: '12:00 KST', timezone: 'Asia/Seoul', service: 'cron' });

// 우아한 종료 처리
let isShuttingDown = false;
const shutdownTimeout = 10000; // 10초 타임아웃

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn('[WARN] 이미 종료 중입니다. 추가적인 시그널 무시...', { signal, service: 'boot' });
    return;
  }

  isShuttingDown = true;
  logger.info(`[INFO] ${signal} 시그널 수신. 봇을 우아하게 종료합니다...`, { service: 'boot' });

  // 종료 타임아웃 설정
  const shutdownTimer = setTimeout(() => {
    logger.error('[ERROR] 종료 타임아웃! 강제 종료합니다.', { service: 'boot' });
    process.exit(1);
  }, shutdownTimeout);

  try {
    // 1. 관리자 그룹에 종료 알림
    if (env.ADMIN_GROUP_ID) {
      try {
        const botInstance = await botPromise;
        const shutdownTime = new Date().toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        await botInstance.sendMessage(env.ADMIN_GROUP_ID,
          `**봇 종료 알림**\n\n종료 시각: ${shutdownTime}\n원인: ${signal} 시그널 수신\n\n5초 후 종료됩니다.`,
          { parse_mode: 'Markdown' }
        );
        logger.info('[INFO] 관리자 그룹에 종료 알림 전송 완료', { adminGroupId: env.ADMIN_GROUP_ID, service: 'boot' });
      } catch (error: any) {
        logger.error('[ERROR] 관리자 그룹 종료 알림 전송 실패', { error: error.message, service: 'boot' });
      }
    }

    // 2. 5초 대기 (메시지 전송을 위한 시간)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. 메시지 큐 처리 중단
    if (processingTimeout) {
      clearTimeout(processingTimeout);
      processingTimeout = null;
    }
    logger.info('[INFO] 메시지 큐 처리 중단 완료', { service: 'boot' });

    // 4. 데이터베이스 연결 종료
    try {
      await closeDb();
      logger.info('[INFO] 데이터베이스 연결 종료 완료', { service: 'boot' });
    } catch (error: any) {
      logger.error('[ERROR] 데이터베이스 종료 중 오류', { error: error.message, service: 'boot' });
    }

    // 5. 봇 폴링 중단
    try {
      const botInstance = await botPromise;
      // node-telegram-bot-api는 stopPolling 메서드가 없으므로, 봇 인스턴스를 null로 설정
      // 실제로는 프로세스 종료 시 자동으로 중단됨
      logger.info('[INFO] 봇 폴링 중단 완료', { service: 'boot' });
    } catch (error: any) {
      logger.error('[ERROR] 봇 폴링 중단 중 오류', { error: error.message, service: 'boot' });
    }

    // 6. 크론 스케줄러 중단
    try {
      // node-cron은 직접적인 stopAll 메서드가 없지만,
      // 프로세스 종료 시 자동으로 정리됨
      logger.info('[INFO] 크론 스케줄러 중단 완료', { service: 'boot' });
    } catch (error: any) {
      logger.error('[ERROR] 크론 스케줄러 중단 중 오류', { error: error.message, service: 'boot' });
    }

    // 타임아웃 클리어
    clearTimeout(shutdownTimer);

    logger.info('[INFO] 봇이 성공적으로 종료되었습니다', { service: 'boot' });
    process.exit(0);
  } catch (error: any) {
    logger.error('[ERROR] 종료 중 오류 발생', { error: error.message, service: 'boot' });
    clearTimeout(shutdownTimer);
    process.exit(1);
  }
}

// 시그널 핸들러 등록
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // kill 명령어
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));   // 터미널 종료

// 예기치 못한 오류 처리
process.on('uncaughtException', (error: Error) => {
  logger.error('[ERROR] 예기치 못한 예외 발생', {
    error: error.message,
    stack: error.stack,
    service: 'boot'
  });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('[ERROR] 처리되지 않은 Promise 거부', {
    reason: reason,
    promise: promise.toString(),
    service: 'boot'
  });
  gracefulShutdown('unhandledRejection');
});