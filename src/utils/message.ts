import { bot } from '../services/telegram';
import { logger } from '../logger';

export function extractUrlsFromText(text?: string): string[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

export function hasTelegramGroupLink(text?: string): boolean {
  if (!text) return false;
  const telegramLinkRegex = /(https?:\/\/)?(t\.me\/|telegram\.me\/|telegram\.dog\/)[A-Za-z0-9_]+/gi;
  return telegramLinkRegex.test(text);
}

export async function isGroupMember(chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return !['left', 'kicked'].includes(member.status as any);
  } catch (error: any) {
    logger.warn('⚠️ 사용자 멤버십 확인 실패', { chatId, userId, error: error.message, service: 'bot' });
    return false;
  }
}

export function calcPriority({ text, isMember }: { text?: string; isMember: boolean }): number {
  let priority = 1;
  const hasTgLink = hasTelegramGroupLink(text);
  const urls = extractUrlsFromText(text);
  if (hasTgLink) priority += 20;
  if (urls.length > 0) priority += 5;
  if (!isMember) priority += 10;
  return priority;
}