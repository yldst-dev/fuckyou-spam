require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const winston = require('winston');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const axios = require('axios');

// 한국시간 포매터
const koreanTimeFormat = winston.format.timestamp({
  format: () => {
    return new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }
});

// 파일용 로그 포맷 (시간이 최우선으로 표시)
const fileLogFormat = winston.format.combine(
  koreanTimeFormat,
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${message}${metaStr}`;
  })
);

// 콘솔용 로그 포맷 (컬러 적용)
const consoleLogFormat = winston.format.combine(
  koreanTimeFormat,
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, service }) => {
    return `[${timestamp}] [${level}] ${message}`;
  })
);

// 로거 설정
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'telegram-spam-bot' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: fileLogFormat
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      format: fileLogFormat
    }),
    new winston.transports.File({ 
      filename: 'logs/spam-actions.log',
      level: 'warn',
      format: fileLogFormat
    }),
    new winston.transports.Console({
      format: consoleLogFormat
    })
  ]
});

// 환경변수 검증
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'CEREBRAS_API_KEY', 'ALLOWED_CHAT_IDS'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// 허용된 채팅 ID 목록 파싱
const allowedChatIds = process.env.ALLOWED_CHAT_IDS.split(',')
  .map(id => id.trim())
  .filter(id => id !== '')
  .map(id => parseInt(id));

if (allowedChatIds.length === 0) {
  logger.error('ALLOWED_CHAT_IDS must contain at least one valid chat ID');
  process.exit(1);
}

logger.info(`✅ 허용된 채팅방 설정 완료`, { 
  count: allowedChatIds.length,
  chatIds: allowedChatIds 
});

// 채팅방이 허용된 목록에 있는지 확인하는 함수
function isAllowedChat(chatId) {
  return allowedChatIds.includes(chatId);
}

// Telegram Bot 및 Cerebras AI 초기화
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const cerebras = new Cerebras({
  apiKey: process.env.CEREBRAS_API_KEY
});

// 메시지 큐 (배치 처리용) - 우선순위별로 분리
let highPriorityQueue = []; // 우선순위 높은 메시지 (비멤버, 링크 포함)
let normalPriorityQueue = []; // 일반 메시지
let processingTimeout = null;

logger.info('🚀 텔레그램 스팸 감지 봇이 시작되었습니다');

// URL 추출 함수
function extractUrlsFromText(text) {
  if (!text) return [];
  
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

// 텔레그램 그룹 링크 감지 함수
function hasTelegramGroupLink(text) {
  if (!text) return false;
  
  const telegramLinkRegex = /(https?:\/\/)?(t\.me\/|telegram\.me\/|telegram\.dog\/)[A-Za-z0-9_]+/gi;
  return telegramLinkRegex.test(text);
}

// 사용자가 그룹 멤버인지 확인하는 함수
async function isGroupMember(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    // 멤버 상태가 'left', 'kicked', 'restricted'가 아닌 경우 멤버로 간주
    return !['left', 'kicked'].includes(member.status);
  } catch (error) {
    logger.warn(`⚠️ 사용자 멤버십 확인 실패 - 채팅방: ${chatId}, 사용자: ${userId}`, { error: error.message });
    // 확인 실패 시 보수적으로 멤버가 아닌 것으로 간주
    return false;
  }
}

// 메시지 우선순위 계산 함수
function calculateMessagePriority(msg, isGroupMemberResult) {
  let priority = 1; // 기본 우선순위
  
  const text = msg.text || msg.caption || '';
  const urls = extractUrlsFromText(text);
  const hasTgLink = hasTelegramGroupLink(text);
  
  // 그룹 멤버가 아닌 경우 우선순위 증가
  if (!isGroupMemberResult) {
    priority += 10;
    logger.info(`🔍 비멤버 메시지 감지 - 우선순위 증가`, { 
      user: msg.from.username || msg.from.first_name,
      userId: msg.from.id,
      priority: priority 
    });
  }
  
  // 텔레그램 그룹 링크가 있는 경우 최고 우선순위
  if (hasTgLink) {
    priority += 20;
    logger.warn(`🚨 텔레그램 그룹 링크 감지 - 최고 우선순위`, { 
      user: msg.from.username || msg.from.first_name,
      userId: msg.from.id,
      messagePreview: text.substring(0, 100),
      priority: priority 
    });
  }
  
  // 일반 URL이 있는 경우 우선순위 증가
  if (urls.length > 0) {
    priority += 5;
    logger.info(`🔗 URL 감지 - 우선순위 증가`, { 
      urlCount: urls.length,
      urls: urls,
      priority: priority 
    });
  }
  
  return priority;
}

// 웹페이지 내용 추출 함수
async function fetchWebPageContent(url) {
  try {
    logger.info(`📄 웹페이지 내용 추출 중`, { url: url });
    
    const timeout = parseInt(process.env.WEBPAGE_FETCH_TIMEOUT) || 10000;
    const maxContentLength = parseInt(process.env.WEBPAGE_CONTENT_MAX_LENGTH) || 1000;
    
    const response = await axios.get(url, {
      timeout: timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      maxRedirects: 5
    });

    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article) {
      return {
        title: article.title || '',
        content: article.textContent ? article.textContent.substring(0, maxContentLength) : '',
        siteName: article.siteName || '',
        excerpt: article.excerpt || ''
      };
    }

    return null;
  } catch (error) {
    logger.warn(`❌ 웹페이지 내용 추출 실패`, { url: url, error: error.message });
    return null;
  }
}

// 봇이 그룹에 추가되었을 때
bot.on('new_chat_members', (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;
  
  // 봇 자신이 추가되었는지 확인
  const botAdded = newMembers.some(member => member.username === process.env.BOT_USERNAME);
  
  if (botAdded) {
    logger.info(`🤖 봇이 그룹에 추가됨`, { 
      chatTitle: msg.chat.title, 
      chatId: chatId,
      chatType: msg.chat.type 
    });
    
    if (isAllowedChat(chatId)) {
      bot.sendMessage(chatId, '✅ 안녕하세요! 스팸 메시지 감지 봇입니다. 이 그룹은 허용된 그룹으로 등록되어 있어 스팸 메시지를 자동으로 감지하고 삭제합니다.');
      logger.info(`✅ 허용된 그룹에 봇 추가 완료`, { 
        chatTitle: msg.chat.title, 
        chatId: chatId 
      });
    } else {
      bot.sendMessage(chatId, '❌ 죄송합니다. 이 그룹은 허용된 그룹 목록에 없어 봇이 작동하지 않습니다. 관리자에게 문의하세요.');
      logger.warn(`🚫 허용되지 않은 그룹에 봇 추가됨 - 자동 퇴장 예정`, { 
        chatTitle: msg.chat.title, 
        chatId: chatId 
      });
      
      // 허용되지 않은 그룹에서 자동으로 나가기
      setTimeout(() => {
        bot.leaveChat(chatId).catch(err => {
          logger.error(`❌ 그룹 나가기 실패`, { error: err.message, chatId: chatId });
        });
      }, 5000);
    }
  }
});

// 메시지 수신 처리
bot.on('message', async (msg) => {
  // 봇 자신의 메시지나 명령어는 무시
  if (msg.from.is_bot || (msg.text && msg.text.startsWith('/'))) {
    return;
  }

  // 그룹 채팅만 처리
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return;
  }

  // 허용된 채팅방인지 확인
  if (!isAllowedChat(msg.chat.id)) {
    logger.debug(`🚫 허용되지 않은 그룹의 메시지 무시됨`, { 
      chatTitle: msg.chat.title, 
      chatId: msg.chat.id 
    });
    return;
  }

  try {
    // 사용자가 그룹 멤버인지 확인
    const isGroupMemberResult = await isGroupMember(msg.chat.id, msg.from.id);
    
    // 메시지 우선순위 계산
    const priority = calculateMessagePriority(msg, isGroupMemberResult);
    
    // 메시지 객체에 추가 정보 저장
    const enrichedMsg = {
      ...msg,
      _metadata: {
        isGroupMember: isGroupMemberResult,
        priority: priority,
        processedAt: new Date()
      }
    };
    
    // 우선순위에 따라 큐에 추가
    if (priority >= 10) { // 높은 우선순위 (비멤버 또는 링크 포함)
      highPriorityQueue.push(enrichedMsg);
      logger.info(`⚡ 높은 우선순위 메시지 큐 추가`, { 
        priority: priority,
        user: msg.from.username || msg.from.first_name,
        userId: msg.from.id,
        isGroupMember: isGroupMemberResult,
        queueSize: highPriorityQueue.length 
      });
      
      // 높은 우선순위 메시지는 즉시 처리하거나 더 빨리 처리
      if (highPriorityQueue.length >= 5) {
        processMessageQueue();
      } else if (!processingTimeout) {
        processingTimeout = setTimeout(processMessageQueue, 1000); // 1초 후 처리
      }
    } else { // 일반 우선순위
      normalPriorityQueue.push(enrichedMsg);
      
      // 일반 메시지는 기존과 동일한 방식으로 처리
      const totalMessages = highPriorityQueue.length + normalPriorityQueue.length;
      if (totalMessages >= 10) {
        processMessageQueue();
      } else if (!processingTimeout) {
        processingTimeout = setTimeout(processMessageQueue, 3000);
      }
    }
  } catch (error) {
    logger.error(`💥 메시지 수신 처리 중 오류 발생`, { 
      error: error.message,
      stack: error.stack,
      user: msg.from.username || msg.from.first_name,
      userId: msg.from.id,
      chatId: msg.chat.id 
    });
    
    // 오류 발생 시 기본 우선순위로 처리
    const fallbackMsg = {
      ...msg,
      _metadata: {
        isGroupMember: false, // 보수적으로 비멤버로 간주
        priority: 10,
        processedAt: new Date(),
        error: error.message
      }
    };
    highPriorityQueue.push(fallbackMsg);
  }
});

// 메시지 큐 배치 처리
async function processMessageQueue() {
  // 높은 우선순위 메시지를 먼저 처리
  const highPriorityMessages = [...highPriorityQueue];
  const normalPriorityMessages = [...normalPriorityQueue];
  
  if (highPriorityMessages.length === 0 && normalPriorityMessages.length === 0) return;

  // 큐 초기화
  highPriorityQueue = [];
  normalPriorityQueue = [];
  
  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }

  // 높은 우선순위 메시지를 먼저 처리하고, 그 다음 일반 메시지 처리
  const allMessages = [...highPriorityMessages, ...normalPriorityMessages];
  
  logger.info(`🔍 스팸 검사 시작`, { 
    totalMessages: allMessages.length,
    highPriority: highPriorityMessages.length,
    normalPriority: normalPriorityMessages.length 
  });

  try {
    // Cerebras AI에 전송할 메시지 데이터 구성
    const messageData = {};
    const messagePromises = allMessages.map(async (msg) => {
      const messageId = `msg_${msg.message_id}_${msg.chat.id}`;
      messageData[messageId] = msg;
      
      const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
      const text = msg.text || msg.caption || '[미디어 메시지]';
      
      // 메타데이터 추출
      const isGroupMemberResult = msg._metadata?.isGroupMember ?? true;
      const priority = msg._metadata?.priority ?? 1;
      
      // URL 추출 및 분석
      const urls = extractUrlsFromText(text);
      const hasTgLink = hasTelegramGroupLink(text);
      let webContent = '';
      let analysisInfo = '';
      
      // 멤버십 정보 추가
      if (!isGroupMemberResult) {
        analysisInfo += `\n[경고] 이 사용자는 그룹 멤버가 아닙니다.\n`;
      }
      
      // 텔레그램 링크 정보 추가
      if (hasTgLink) {
        analysisInfo += `\n[경고] 텔레그램 그룹/채널 초대 링크가 포함되어 있습니다.\n`;
      }
      
      // URL 분석
      if (urls.length > 0) {
        analysisInfo += `\n[정보] ${urls.length}개의 URL이 포함되어 있습니다.\n`;
        
        const maxUrls = parseInt(process.env.MAX_URLS_PER_MESSAGE) || 2;
        for (const url of urls.slice(0, maxUrls)) {
          const content = await fetchWebPageContent(url);
          if (content) {
            webContent += `\n웹페이지 정보 (${url}):\n`;
            webContent += `제목: ${content.title}\n`;
            webContent += `사이트: ${content.siteName}\n`;
            webContent += `내용: ${content.content}\n`;
          }
        }
      }
      
      return `${messageId}: [${username}] [우선순위: ${priority}] ${text}${analysisInfo}${webContent}`;
    });

    const messagePrompt = (await Promise.all(messagePromises)).join('\n\n');

    // Cerebras AI로 스팸 분류 요청
    const completionCreateResponse = await cerebras.chat.completions.create({
      messages: [
        {
          "role": "system",
          "content": "You are a bot that reads Telegram messages and classifies them as spam or not spam. Pay special attention to messages from non-group members and messages containing links.\n\nClassify as spam (true) if:\n1. Cryptocurrency (coin) promotions, NFT promotions, Web3 promotions\n2. Illegal advertisements (illegal websites, services, or products)\n3. Telegram group/channel invite links from non-members\n4. Suspicious promotional content from non-members\n5. Phishing or scam attempts\n\nBe MORE STRICT with messages that have:\n- [경고] 이 사용자는 그룹 멤버가 아닙니다\n- [경고] 텔레그램 그룹/채널 초대 링크가 포함되어 있습니다\n- High priority indicators\n\nFor messages from group members sharing legitimate news, information, or normal conversation, classify as not spam (false).\n\nReturn the result in JSON format like this:\n{\n  \"message_id_1\": false,\n  \"message_id_2\": true,\n  \"message_id_3\": false\n}\n\nWhen analyzing URLs, consider both the message context and webpage content. Non-members sharing promotional content or invite links should be treated with high suspicion."
        },
        {
          "role": "user",
          "content": messagePrompt
        }
      ],
      model: 'llama-4-scout-17b-16e-instruct',
      stream: false,
      max_completion_tokens: 2048,
      temperature: 0.2,
      top_p: 1,
      response_format: { type: "json_object" }
    });

    const classification = JSON.parse(completionCreateResponse.choices[0].message.content);
    logger.info(`✅ AI 스팸 분류 완료`, { 
      totalAnalyzed: Object.keys(classification).length,
      spamDetected: Object.values(classification).filter(isSpam => isSpam).length,
      classification: classification 
    });

    // 스팸으로 분류된 메시지 삭제
    for (const [messageId, isSpam] of Object.entries(classification)) {
      if (isSpam && messageData[messageId]) {
        await deleteSpamMessage(messageData[messageId]);
      }
    }

  } catch (error) {
    logger.error(`💥 스팸 검사 처리 중 오류 발생`, { 
      error: error.message,
      stack: error.stack,
      messageCount: allMessages.length 
    });
  }
}

// 스팸 메시지 삭제 및 로깅
async function deleteSpamMessage(msg) {
  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    
    // 상세 로그 기록
    const isGroupMemberResult = msg._metadata?.isGroupMember ?? true;
    const priority = msg._metadata?.priority ?? 1;
    const text = msg.text || msg.caption || '[미디어 메시지]';
    
    const logData = {
      action: 'spam_deleted',
      timestamp: new Date().toISOString(),
      chat: {
        id: msg.chat.id,
        title: msg.chat.title,
        type: msg.chat.type
      },
      user: {
        id: msg.from.id,
        username: msg.from.username,
        first_name: msg.from.first_name,
        last_name: msg.from.last_name,
        language_code: msg.from.language_code,
        is_group_member: isGroupMemberResult
      },
      message: {
        id: msg.message_id,
        date: new Date(msg.date * 1000).toISOString(),
        text: text,
        type: msg.text ? 'text' : (msg.photo ? 'photo' : msg.document ? 'document' : 'other'),
        priority: priority,
        contains_urls: extractUrlsFromText(text).length > 0,
        contains_telegram_links: hasTelegramGroupLink(text),
        urls: extractUrlsFromText(text)
      },
      analysis: {
        is_non_member: !isGroupMemberResult,
        has_telegram_links: hasTelegramGroupLink(text),
        url_count: extractUrlsFromText(text).length
      }
    };

    logger.warn(`🗑️ 스팸 메시지 삭제 완료`, {
      user: `${msg.from.username || msg.from.first_name} (ID: ${msg.from.id})`,
      chat: `${msg.chat.title} (ID: ${msg.chat.id})`,
      messageId: msg.message_id,
      isGroupMember: isGroupMemberResult,
      priority: priority,
      hasUrls: extractUrlsFromText(text).length > 0,
      hasTelegramLinks: hasTelegramGroupLink(text),
      messagePreview: text.substring(0, 100),
      urls: extractUrlsFromText(text),
      ...logData
    });
    
    // 한국시간으로 시각 포맷팅 함수
    const formatKoreanTime = (timestamp) => {
      return new Date(timestamp).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    };

    // 상세한 경고 메시지 작성
    const originalSentTime = formatKoreanTime(msg.date * 1000);
    const deletedTime = formatKoreanTime(new Date());
    const memberStatus = isGroupMemberResult ? '그룹 멤버' : '비멤버';
    
    const warningMessage = `🚨 **스팸 메시지 삭제 알림**

👤 **사용자 정보:**
• 이름: ${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}
• 사용자명: ${msg.from.username ? '@' + msg.from.username : '없음'}
• 사용자 ID: \`${msg.from.id}\`
• 멤버 상태: ${memberStatus}
• 언어: ${msg.from.language_code || '미설정'}

⏰ **시각 정보:**
• 전송 시각: ${originalSentTime}
• 삭제 시각: ${deletedTime}

⚡ 이 메시지는 AI에 의해 스팸으로 분류되어 자동 삭제되었습니다.`;
    
    // 경고 메시지 전송 (삭제하지 않음)
    await bot.sendMessage(msg.chat.id, warningMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error(`❌ 스팸 메시지 삭제 실패`, {
      user: `${msg.from.username || msg.from.first_name} (ID: ${msg.from.id})`,
      chat: `${msg.chat.title} (ID: ${msg.chat.id})`,
      messageId: msg.message_id,
      error: error.message,
      stack: error.stack
    });
  }
}

// 봇 명령어 처리
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.chat.type === 'private') {
    // 개인 메시지인 경우
    bot.sendMessage(chatId, '안녕하세요! 저는 스팸 메시지 감지 봇입니다.\n\n📋 사용법:\n- 허용된 그룹에 저를 추가하고 관리자 권한을 주세요\n- 메시지 삭제 권한이 필요합니다\n- 자동으로 스팸 메시지를 감지하고 삭제합니다\n\n⚠️ 보안상 허용된 그룹에서만 작동합니다.');
  } else if (isAllowedChat(chatId)) {
    // 허용된 그룹인 경우
    bot.sendMessage(chatId, '✅ 안녕하세요! 저는 스팸 메시지 감지 봇입니다.\n\n이 그룹은 허용된 그룹으로 등록되어 있어 자동으로 스팸 메시지를 감지하고 삭제합니다.\n\n📋 기능:\n- AI 기반 스팸 감지\n- 스마트 URL 분석\n- 자동 메시지 삭제');
  } else {
    // 허용되지 않은 그룹인 경우
    bot.sendMessage(chatId, '❌ 이 그룹은 허용된 그룹 목록에 없어 봇이 작동하지 않습니다.\n\n관리자에게 문의하여 그룹을 허용 목록에 추가해달라고 요청하세요.');
  }
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  
  const totalQueueSize = highPriorityQueue.length + normalPriorityQueue.length;
  
  if (msg.chat.type === 'private') {
    // 개인 메시지인 경우
    bot.sendMessage(chatId, `🤖 봇 상태: 정상 작동 중\n📊 큐 대기 메시지: ${totalQueueSize}개 (높은 우선순위: ${highPriorityQueue.length}개, 일반: ${normalPriorityQueue.length}개)\n🏠 허용된 그룹 수: ${allowedChatIds.length}개`);
  } else if (isAllowedChat(chatId)) {
    // 허용된 그룹인 경우
    bot.sendMessage(chatId, `✅ 봇 상태: 이 그룹에서 정상 작동 중\n📊 큐 대기 메시지: ${totalQueueSize}개 (높은 우선순위: ${highPriorityQueue.length}개, 일반: ${normalPriorityQueue.length}개)`);
  } else {
    // 허용되지 않은 그룹인 경우
    bot.sendMessage(chatId, '❌ 이 그룹에서는 봇이 작동하지 않습니다.');
  }
});

// 그룹 ID 확인 명령어 추가
bot.onText(/\/chatid/, (msg) => {
  const chatId = msg.chat.id;
  const isAllowed = isAllowedChat(chatId);
  
  bot.sendMessage(chatId, `📍 현재 그룹 정보:\n\n🆔 채팅 ID: \`${chatId}\`\n📝 그룹명: ${msg.chat.title || '개인 채팅'}\n${isAllowed ? '✅ 허용된 그룹' : '❌ 허용되지 않은 그룹'}`, { parse_mode: 'Markdown' });
});

// 에러 핸들링
bot.on('polling_error', (error) => {
  logger.error(`🔄 텔레그램 Polling 오류`, { 
  error: error.message, 
  code: error.code, 
  stack: error.stack 
});
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`💥 처리되지 않은 Promise 거부`, { 
    reason: reason, 
    promise: promise.toString() 
  });
});

process.on('uncaughtException', (error) => {
  logger.error(`💥 예외 처리되지 않은 오류 - 봇 종료`, { 
    error: error.message, 
    stack: error.stack 
  });
  process.exit(1);
}); 