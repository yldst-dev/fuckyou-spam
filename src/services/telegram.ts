import TelegramBot = require('node-telegram-bot-api');
import { env } from '../config/env';
import { logger } from '../logger';

// Create bot instance with polling but catch errors
export const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

// Setup polling error handler immediately
bot.on('polling_error', (error: any) => {
  if (error.code === 'EFATAL' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    logger.warn('[WARN] 텔레그램 Polling 네트워크 오류 (자동 재시도)', {
      error: error.message,
      code: error.code,
      service: 'bot'
    });
    // Don't exit - let node-telegram-bot-api handle retry
  } else {
    logger.error('[ERROR] 텔레그램 Polling 오류', {
      error: error.message,
      code: error.code,
      service: 'bot'
    });
  }
});

// Export bot promise that resolves when initialization is complete
export const botPromise = new Promise<TelegramBot>((resolve, reject) => {
  // Test bot connection
  bot.getMe()
    .then((botInfo) => {
      logger.info('[INFO] 봇 초기화 성공', {
        botName: botInfo.first_name,
        botUsername: botInfo.username,
        botId: botInfo.id,
        service: 'bot'
      });
      resolve(bot);
    })
    .catch((err: any) => {
      logger.error('[ERROR] 봇 초기화 실패', { error: err.message, service: 'bot' });
      reject(err);
    });
});

const generalCommands = [
  { command: 'start', description: '봇 소개 및 시작' },
  { command: 'help', description: '도움말' },
  { command: 'status', description: '봇 상태 확인' },
  { command: 'chatid', description: '현재 그룹 ID 확인' },
  { command: 'ping', description: '응답 속도 측정' },
];

const adminCommands = [
  { command: 'start', description: '봇 소개 및 시작' },
  { command: 'help', description: '도움말' },
  { command: 'status', description: '봇 상태 확인' },
  { command: 'chatid', description: '현재 그룹 ID 확인' },
  { command: 'ping', description: '응답 속도 측정' },
  { command: 'whitelist_add', description: '그룹을 화이트리스트에 추가' },
  { command: 'whitelist_remove', description: '그룹을 화이트리스트에서 제거' },
  { command: 'whitelist_list', description: '화이트리스트 목록 확인' },
  { command: 'sync_commands', description: '봇 명령어 동기화' },
];

export async function syncBotCommands() {
  try {
    const bot = await botPromise;
    logger.info('[INFO] 봇 명령어 동기화 시작...', { service: 'bot' });

    // First try without scope (default commands for all users)
    await bot.setMyCommands(generalCommands);
    logger.info('[INFO] 일반 사용자 명령어 동기화 완료', {
      commandCount: generalCommands.length,
      service: 'bot',
    });

    // Set admin commands for admin user
    if (env.ADMIN_USER_ID) {
      try {
        await bot.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: env.ADMIN_USER_ID },
        });
        logger.info('[INFO] 관리자 개인 채팅 명령어 동기화 완료', {
          adminUserId: env.ADMIN_USER_ID,
          service: 'bot',
        });
      } catch (adminError: any) {
        logger.warn('[WARN] 관리자 개인 채팅 명령어 동기화 실패 (무시)', {
          error: adminError.message,
          adminUserId: env.ADMIN_USER_ID,
          service: 'bot',
        });
      }
    }

    // Set admin commands for admin group
    if (env.ADMIN_GROUP_ID) {
      try {
        await bot.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: env.ADMIN_GROUP_ID },
        });
        logger.info('[INFO] 관리자 그룹 명령어 동기화 완료', {
          adminGroupId: env.ADMIN_GROUP_ID,
          service: 'bot',
        });
      } catch (adminError: any) {
        logger.warn('[WARN] 관리자 그룹 명령어 동기화 실패 (무시)', {
          error: adminError.message,
          adminGroupId: env.ADMIN_GROUP_ID,
          service: 'bot',
        });
      }
    }
  } catch (error: any) {
    logger.error('[ERROR] 봇 명령어 동기화 실패', { error: error.message, service: 'bot' });
    throw error;
  }
}

export async function validateBotInitialization(): Promise<boolean> {
  try {
    const bot = await botPromise;
    const botInfo = await bot.getMe();
    logger.info('[INFO] 봇 정보 확인 완료', {
      botName: botInfo.first_name,
      botUsername: botInfo.username,
      botId: botInfo.id,
      service: 'bot',
    });
    if (env.BOT_USERNAME && env.BOT_USERNAME !== botInfo.username) {
      logger.warn('[WARN] 환경변수 BOT_USERNAME과 실제 봇 사용자명이 일치하지 않습니다', {
        envUsername: env.BOT_USERNAME,
        actualUsername: botInfo.username,
        service: 'bot',
      });
    }
    return true;
  } catch (error: any) {
    logger.error('[ERROR] 봇 초기화 검증 실패', { error: error.message, code: error.code, service: 'bot' });
    return false;
  }
}

export function isAdmin(userId: number): boolean {
  return !!env.ADMIN_USER_ID && userId === env.ADMIN_USER_ID;
}

export function isAdminGroup(chatId: number): boolean {
  return !!env.ADMIN_GROUP_ID && chatId === env.ADMIN_GROUP_ID;
}