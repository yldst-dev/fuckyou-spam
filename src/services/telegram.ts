import TelegramBot = require('node-telegram-bot-api');
import { env } from '../config/env';
import { logger } from '../logger';

export const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

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
    logger.info('🔄 봇 명령어 동기화 시작...', { service: 'bot' });

    await bot.setMyCommands(generalCommands);
    logger.info('✅ 일반 사용자 명령어 동기화 완료', {
      commandCount: generalCommands.length,
      service: 'bot',
    });

    if (env.ADMIN_USER_ID) {
      await bot.setMyCommands(adminCommands, {
        scope: { type: 'chat', chat_id: env.ADMIN_USER_ID },
      });
      logger.info('✅ 관리자 개인 채팅 명령어 동기화 완료', {
        adminUserId: env.ADMIN_USER_ID,
        service: 'bot',
      });
    }

    if (env.ADMIN_GROUP_ID) {
      await bot.setMyCommands(adminCommands, {
        scope: { type: 'chat', chat_id: env.ADMIN_GROUP_ID },
      });
      logger.info('✅ 관리자 그룹 명령어 동기화 완료', {
        adminGroupId: env.ADMIN_GROUP_ID,
        service: 'bot',
      });
    }
  } catch (error: any) {
    logger.error('❌ 봇 명령어 동기화 실패', { error: error.message, service: 'bot' });
  }
}

export async function validateBotInitialization(): Promise<boolean> {
  try {
    const botInfo = await bot.getMe();
    logger.info('✅ 봇 정보 확인 완료', {
      botName: botInfo.first_name,
      botUsername: botInfo.username,
      botId: botInfo.id,
      service: 'bot',
    });
    if (env.BOT_USERNAME && env.BOT_USERNAME !== botInfo.username) {
      logger.warn('⚠️ 환경변수 BOT_USERNAME과 실제 봇 사용자명이 일치하지 않습니다', {
        envUsername: env.BOT_USERNAME,
        actualUsername: botInfo.username,
        service: 'bot',
      });
    }
    return true;
  } catch (error: any) {
    logger.error('❌ 봇 초기화 검증 실패', { error: error.message, service: 'bot' });
    return false;
  }
}

export function isAdmin(userId: number): boolean {
  return !!env.ADMIN_USER_ID && userId === env.ADMIN_USER_ID;
}

export function isAdminGroup(chatId: number): boolean {
  return !!env.ADMIN_GROUP_ID && chatId === env.ADMIN_GROUP_ID;
}