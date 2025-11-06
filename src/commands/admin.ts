import TelegramBot = require('node-telegram-bot-api');
import { isAdmin, isAdminGroup, bot, syncBotCommands } from '../services/telegram';
import { addToWhitelist, removeFromWhitelist, getWhitelistStats } from '../db/sqlite';
import { logger } from '../logger';

async function fetchCurrentGroupInfo(chatId: number) {
  try {
    const chatInfo = await bot.getChat(chatId);
    return {
      id: chatInfo.id,
      title: chatInfo.title || '개인 채팅',
      type: chatInfo.type,
      accessible: true,
    };
  } catch (error: any) {
    logger.warn('그룹 정보 조회 실패', { chatId, error: error.message, service: 'bot' });
    return {
      id: chatId,
      title: null,
      type: 'unknown',
      accessible: false,
      error: error.message,
    };
  }
}

export function registerAdminCommands(bot: TelegramBot) {
  // /whitelist_add
  bot.onText(/\/whitelist_add (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdminGroup(chatId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
      return;
    }
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자만 사용할 수 있습니다.');
      return;
    }

    try {
      const targetText = match?.[1];
      if (!targetText) {
        bot.sendMessage(chatId, '❌ 올바른 그룹 ID를 입력하세요. 예: /whitelist_add -1001234567890');
        return;
      }
      const targetChatId = parseInt(targetText, 10);
      if (Number.isNaN(targetChatId)) {
        bot.sendMessage(chatId, '❌ 올바른 그룹 ID를 입력하세요. 예: /whitelist_add -1001234567890');
        return;
      }

      let chatInfo;
      try {
        chatInfo = await bot.getChat(targetChatId);
      } catch (error) {
        bot.sendMessage(chatId, '❌ 해당 그룹을 찾을 수 없습니다. 봇이 그룹에 추가되어 있는지 확인하세요.');
        return;
      }

      const success = await addToWhitelist(targetChatId, chatInfo.title || null, chatInfo.type || null, userId);
      if (success) {
        bot.sendMessage(chatId, `✅ 그룹 "${chatInfo.title}" (ID: ${targetChatId})이 화이트리스트에 추가되었습니다.`);
        logger.info('📝 그룹이 화이트리스트에 추가됨', {
          chatId: targetChatId,
          chatTitle: chatInfo.title,
          addedBy: userId,
          addedByUsername: msg.from.username,
          service: 'admin',
        });
      } else {
        bot.sendMessage(chatId, `⚠️ 그룹 "${chatInfo.title}"은 이미 화이트리스트에 등록되어 있습니다.`);
      }
    } catch (error: any) {
      logger.error('❌ 화이트리스트 추가 실패', { error: error.message, chatId, service: 'admin' });
      bot.sendMessage(chatId, '❌ 화이트리스트 추가 중 오류가 발생했습니다.');
    }
  });

  // /whitelist_remove
  bot.onText(/\/whitelist_remove (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdminGroup(chatId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
      return;
    }
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자만 사용할 수 있습니다.');
      return;
    }

    try {
      const targetText = match?.[1];
      if (!targetText) {
        bot.sendMessage(chatId, '❌ 올바른 그룹 ID를 입력하세요. 예: /whitelist_remove -1001234567890');
        return;
      }
      const targetChatId = parseInt(targetText, 10);
      if (Number.isNaN(targetChatId)) {
        bot.sendMessage(chatId, '❌ 올바른 그룹 ID를 입력하세요. 예: /whitelist_remove -1001234567890');
        return;
      }

      const success = await removeFromWhitelist(targetChatId);
      if (success) {
        bot.sendMessage(chatId, `✅ 그룹 (ID: ${targetChatId})이 화이트리스트에서 제거되었습니다.`);
        logger.info('📝 그룹이 화이트리스트에서 제거됨', {
          chatId: targetChatId,
          removedBy: userId,
          removedByUsername: msg.from.username,
          service: 'admin',
        });
      } else {
        bot.sendMessage(chatId, `⚠️ 그룹 (ID: ${targetChatId})은 화이트리스트에 등록되어 있지 않습니다.`);
      }
    } catch (error: any) {
      logger.error('❌ 화이트리스트 제거 실패', { error: error.message, chatId, service: 'admin' });
      bot.sendMessage(chatId, '❌ 화이트리스트 제거 중 오류가 발생했습니다.');
    }
  });

  // /whitelist_list
  bot.onText(/\/whitelist_list/, async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdminGroup(chatId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
      return;
    }
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자만 사용할 수 있습니다.');
      return;
    }

    try {
      const stats = await getWhitelistStats();
      if (stats.length === 0) {
        bot.sendMessage(chatId, '📋 화이트리스트가 비어있습니다.');
        return;
      }

      let message = '📋 화이트리스트 목록:\n\n';
      for (let index = 0; index < stats.length; index++) {
        const row = stats[index];
        const addedDate = new Date(row.added_at).toLocaleDateString('ko-KR');
        const currentInfo = await fetchCurrentGroupInfo(row.chat_id);
        message += `${index + 1}. `;
        if (currentInfo.accessible && currentInfo.title) {
          message += `${currentInfo.title}\n`;
          if (row.chat_title && row.chat_title !== currentInfo.title) {
            message += `   📝 저장된 이름: ${row.chat_title}\n`;
          }
        } else {
          message += `ID: ${row.chat_id}\n`;
          if (row.chat_title) {
            message += `   📝 저장된 이름: ${row.chat_title}\n`;
          }
          message += `   ⚠️ 현재 접근 불가\n`;
        }
        message += `   📅 등록일: ${addedDate}\n`;
      }
      bot.sendMessage(chatId, message);
    } catch (error: any) {
      logger.error('❌ 화이트리스트 조회 실패', { error: error.message, chatId, service: 'admin' });
      bot.sendMessage(chatId, '❌ 화이트리스트 조회 중 오류가 발생했습니다.');
    }
  });

  // /sync_commands
  bot.onText(/\/sync_commands/, async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAdminGroup(chatId) || !isAdmin(userId)) {
      bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹의 관리자만 사용할 수 있습니다.');
      return;
    }
    await syncBotCommands();
    bot.sendMessage(chatId, '✅ 봇 명령어 동기화 완료');
  });
}