require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const winston = require('winston');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'CEREBRAS_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`❌ 필수 환경변수가 설정되지 않았습니다: ${envVar}`);
    process.exit(1);
  }
}

// 텔레그램 봇 토큰 형식 검증
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (!telegramToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
  logger.error('❌ 텔레그램 봇 토큰 형식이 올바르지 않습니다');
  process.exit(1);
}

logger.info('✅ 환경변수 검증 완료');

// 관리자 설정
const ADMIN_USER_ID = parseInt(process.env.ADMIN_USER_ID) || null;
let ADMIN_GROUP_ID = parseInt(process.env.ADMIN_GROUP_ID) || null;

// 관리자 그룹 ID 처리 (양수인 경우 음수로 변환)
if (ADMIN_GROUP_ID && ADMIN_GROUP_ID > 0) {
  ADMIN_GROUP_ID = -ADMIN_GROUP_ID;
  logger.info('📝 관리자 그룹 ID를 음수로 변환했습니다', { 
    original: parseInt(process.env.ADMIN_GROUP_ID),
    converted: ADMIN_GROUP_ID 
  });
}

// 관리자 권한 확인 함수
function isAdmin(userId) {
  return ADMIN_USER_ID && userId === ADMIN_USER_ID;
}

// 관리자 그룹 확인 함수
function isAdminGroup(chatId) {
  return ADMIN_GROUP_ID && chatId === ADMIN_GROUP_ID;
}

// 관리자 설정 유효성 검증
if (!ADMIN_USER_ID) {
  logger.warn('⚠️ ADMIN_USER_ID가 설정되지 않았습니다. 관리자 기능이 비활성화됩니다.');
}

if (!ADMIN_GROUP_ID) {
  logger.warn('⚠️ ADMIN_GROUP_ID가 설정되지 않았습니다. 관리자 그룹 기능이 비활성화됩니다.');
}

if (ADMIN_USER_ID && ADMIN_GROUP_ID) {
  logger.info('✅ 관리자 설정 완료', { 
    adminUserId: ADMIN_USER_ID,
    adminGroupId: ADMIN_GROUP_ID 
  });
}

// 데이터베이스 디렉토리 생성
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// SQLite 데이터베이스 초기화
const dbPath = path.join(dbDir, 'whitelist.db');
const db = new sqlite3.Database(dbPath);

// 데이터베이스 테이블 생성
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS whitelist (
    chat_id INTEGER PRIMARY KEY,
    chat_title TEXT,
    chat_type TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    added_by INTEGER
  )`);
  
  // 기존 환경변수에서 화이트리스트 데이터 마이그레이션
  if (process.env.ALLOWED_CHAT_IDS) {
    const allowedChatIds = process.env.ALLOWED_CHAT_IDS.split(',')
      .map(id => id.trim())
      .filter(id => id !== '')
      .map(id => parseInt(id));
    
    allowedChatIds.forEach(chatId => {
      db.run(`INSERT OR IGNORE INTO whitelist (chat_id, chat_title, chat_type) VALUES (?, ?, ?)`, 
        [chatId, 'Legacy Group', 'group']);
    });
    
    logger.info(`✅ 기존 화이트리스트 데이터 마이그레이션 완료`, { 
      count: allowedChatIds.length,
      chatIds: allowedChatIds 
    });
  }
});

// 화이트리스트 관리 함수들
function addToWhitelist(chatId, chatTitle, chatType, addedBy) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT OR REPLACE INTO whitelist (chat_id, chat_title, chat_type, added_by) VALUES (?, ?, ?, ?)`, 
      [chatId, chatTitle, chatType, addedBy], 
      function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
  });
}

function removeFromWhitelist(chatId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM whitelist WHERE chat_id = ?`, [chatId], function(err) {
      if (err) reject(err);
      else resolve(this.changes > 0);
    });
  });
}

function isAllowedChat(chatId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT chat_id FROM whitelist WHERE chat_id = ?`, [chatId], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

function getWhitelistStats() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT chat_id, chat_title, chat_type, added_at FROM whitelist ORDER BY added_at DESC`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// 실시간 그룹 정보 조회 함수
async function fetchCurrentGroupInfo(chatId) {
  try {
    const chatInfo = await bot.getChat(chatId);
    return {
      id: chatInfo.id,
      title: chatInfo.title || '개인 채팅',
      type: chatInfo.type,
      accessible: true
    };
  } catch (error) {
    logger.warn(`그룹 정보 조회 실패: ${chatId}`, { error: error.message });
    return {
      id: chatId,
      title: null,
      type: 'unknown',
      accessible: false,
      error: error.message
    };
  }
}

// Telegram Bot 및 Cerebras AI 초기화
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const cerebras = new Cerebras({
  apiKey: process.env.CEREBRAS_API_KEY
});

// 봇 명령어 자동완성 설정
const generalCommands = [
  { command: 'start', description: '봇 소개 및 시작' },
  { command: 'help', description: '도움말' },
  { command: 'status', description: '봇 상태 확인' },
  { command: 'chatid', description: '현재 그룹 ID 확인' }
];

const adminCommands = [
  { command: 'start', description: '봇 소개 및 시작' },
  { command: 'help', description: '도움말' },
  { command: 'status', description: '봇 상태 확인' },
  { command: 'chatid', description: '현재 그룹 ID 확인' },
  { command: 'whitelist_add', description: '그룹을 화이트리스트에 추가' },
  { command: 'whitelist_remove', description: '그룹을 화이트리스트에서 제거' },
  { command: 'whitelist_list', description: '화이트리스트 목록 확인' },
  { command: 'sync_commands', description: '봇 명령어 동기화' }
];

// 재시도 유틸리티 함수
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      logger.warn(`⚠️ 작업 실패, ${delay}ms 후 재시도 (${i + 1}/${maxRetries})`, { 
        error: error.message 
      });
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // 지수 백오프
    }
  }
}

// 봇 명령어 동기화 함수
async function syncBotCommands() {
  try {
    logger.info('🔄 봇 명령어 동기화 시작...');

    // 일반 사용자용 명령어 설정 (기본)
    await retryOperation(async () => {
      await bot.setMyCommands(generalCommands);
      logger.info('✅ 일반 사용자 명령어 동기화 완료', { 
        commandCount: generalCommands.length,
        commands: generalCommands.map(cmd => cmd.command)
      });
    });

    // 관리자용 명령어 설정 (개인 채팅에서)
    if (ADMIN_USER_ID) {
      await retryOperation(async () => {
        await bot.setMyCommands(adminCommands, {
          scope: {
            type: 'chat',
            chat_id: ADMIN_USER_ID
          }
        });
        logger.info('✅ 관리자 개인 채팅 명령어 동기화 완료', { 
          adminUserId: ADMIN_USER_ID,
          commandCount: adminCommands.length,
          commands: adminCommands.map(cmd => cmd.command)
        });
      });
    }

    // 관리자 그룹용 명령어 설정
    if (ADMIN_GROUP_ID) {
      await retryOperation(async () => {
        await bot.setMyCommands(adminCommands, {
          scope: {
            type: 'chat',
            chat_id: ADMIN_GROUP_ID
          }
        });
        logger.info('✅ 관리자 그룹 명령어 동기화 완료', { 
          adminGroupId: ADMIN_GROUP_ID,
          commandCount: adminCommands.length,
          commands: adminCommands.map(cmd => cmd.command)
        });
      });
    }

    // 관리자 설정이 없는 경우 경고
    if (!ADMIN_USER_ID && !ADMIN_GROUP_ID) {
      logger.warn('⚠️ 관리자 설정이 없어 관리자 명령어를 동기화할 수 없습니다.');
    }

    // 동기화 완료 요약
    const summary = {
      generalCommandsCount: generalCommands.length,
      adminCommandsCount: adminCommands.length,
      adminUserConfigured: !!ADMIN_USER_ID,
      adminGroupConfigured: !!ADMIN_GROUP_ID
    };
    
    logger.info('🎯 명령어 동기화 완료 요약', summary);

  } catch (error) {
    logger.error('❌ 봇 명령어 동기화 실패', { 
      error: error.message,
      stack: error.stack,
      errorCode: error.code,
      response: error.response?.body
    });
    throw error; // 상위로 에러 전파
  }
}

// 명령어 동기화 실행 (지연 실행)
setTimeout(async () => {
  try {
    await syncBotCommands();
  } catch (error) {
    logger.error('❌ 초기 명령어 동기화 실패', { error: error.message });
  }
}, 2000); // 2초 후 실행

// 메시지 큐 (배치 처리용) - 우선순위별로 분리
let highPriorityQueue = []; // 우선순위 높은 메시지 (비멤버, 링크 포함)
let normalPriorityQueue = []; // 일반 메시지
let processingTimeout = null;

logger.info('🚀 텔레그램 스팸 감지 봇이 시작되었습니다');

// 봇 초기화 검증
async function validateBotInitialization() {
  try {
    // 봇 정보 확인
    const botInfo = await bot.getMe();
    logger.info('✅ 봇 정보 확인 완료', { 
      botName: botInfo.first_name,
      botUsername: botInfo.username,
      botId: botInfo.id
    });

    // 환경변수 BOT_USERNAME과 실제 봇 사용자명 일치 확인
    if (process.env.BOT_USERNAME && process.env.BOT_USERNAME !== botInfo.username) {
      logger.warn('⚠️ 환경변수 BOT_USERNAME과 실제 봇 사용자명이 일치하지 않습니다', {
        envUsername: process.env.BOT_USERNAME,
        actualUsername: botInfo.username
      });
    }

    return true;
  } catch (error) {
    logger.error('❌ 봇 초기화 검증 실패', { 
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

// 봇 초기화 검증 실행
setTimeout(async () => {
  const isValid = await validateBotInitialization();
  if (!isValid) {
    logger.error('💥 봇 초기화 검증 실패로 인한 종료');
    process.exit(1);
  }
}, 1000);

// 봇 시작 시 관리자 그룹에 알림 전송 (지연 실행)
setTimeout(async () => {
  if (ADMIN_GROUP_ID) {
    try {
      await retryOperation(async () => {
        const startTime = new Date().toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
        
        const stats = await getWhitelistStats();
        const adminStartMessage = `🚀 **스팸 감지 봇 시작**

⏰ **시작 시간:** ${startTime}
🏠 **화이트리스트 그룹 수:** ${stats.length}개
🤖 **상태:** 정상 작동 중

봇이 성공적으로 시작되었습니다.`;

        await bot.sendMessage(ADMIN_GROUP_ID, adminStartMessage, { parse_mode: 'Markdown' });
        logger.info('✅ 관리자 그룹 시작 알림 전송 완료', { adminGroupId: ADMIN_GROUP_ID });
      });
    } catch (error) {
      logger.error('❌ 관리자 그룹 시작 알림 전송 실패', { 
        error: error.message, 
        adminGroupId: ADMIN_GROUP_ID,
        errorCode: error.code,
        response: error.response?.body
      });
    }
  }
}, 5000); // 5초 후 실행 (명령어 동기화 후)

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
bot.on('new_chat_members', async (msg) => {
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
    
    const isAllowed = await isAllowedChat(chatId);
    
    if (isAllowed) {
      bot.sendMessage(chatId, '✅ 안녕하세요! 스팸 메시지 감지 봇입니다. 이 그룹은 허용된 그룹으로 등록되어 있어 스팸 메시지를 자동으로 감지하고 삭제합니다.');
      logger.info(`✅ 허용된 그룹에 봇 추가 완료`, { 
        chatTitle: msg.chat.title, 
        chatId: chatId 
      });
    } else {
      bot.sendMessage(chatId, '❌ 이 그룹은 허용된 그룹 목록에 없어 봇이 작동하지 않습니다. 관리자가 /whitelist_add 명령어로 이 그룹을 허용 목록에 추가해야 합니다.');
      logger.warn(`🚫 허용되지 않은 그룹에 봇 추가됨`, { 
        chatTitle: msg.chat.title, 
        chatId: chatId 
      });
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
  const isAllowed = await isAllowedChat(msg.chat.id);
  if (!isAllowed) {
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

    // 한국시간으로 시각 포맷팅
    const originalSentTime = formatKoreanTime(msg.date * 1000);
    const deletedTime = formatKoreanTime(new Date());
    const memberStatus = isGroupMemberResult ? '그룹 멤버' : '비멤버';
    
    // 필터링된 그룹에는 알림을 보내지 않음 (조용히 삭제)
    
    // 관리자 그룹에 상세한 스팸 삭제 알림 전송
    const adminMessage = `🚨 **스팸 메시지 삭제 알림**

🏠 **그룹 정보:**
• 그룹명: ${msg.chat.title}
• 그룹 ID: \`${msg.chat.id}\`
• 그룹 타입: ${msg.chat.type}

👤 **사용자 정보:**
• 이름: ${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}
• 사용자명: ${msg.from.username ? '@' + msg.from.username : '없음'}
• 사용자 ID: \`${msg.from.id}\`
• 멤버 상태: ${memberStatus}
• 언어: ${msg.from.language_code || '미설정'}

📝 **메시지 정보:**
• 메시지 ID: ${msg.message_id}
• 우선순위: ${priority}
• URL 포함: ${extractUrlsFromText(text).length > 0 ? '예' : '아니오'}
• 텔레그램 링크: ${hasTelegramGroupLink(text) ? '예' : '아니오'}
• 내용: \`${text.substring(0, 200)}${text.length > 200 ? '...' : ''}\`

⏰ **시각 정보:**
• 전송 시각: ${originalSentTime}
• 삭제 시각: ${deletedTime}

⚡ 이 메시지는 AI에 의해 스팸으로 분류되어 자동 삭제되었습니다.`;

    // 관리자 그룹에 알림 전송 (설정된 경우에만)
    if (ADMIN_GROUP_ID) {
      try {
        await retryOperation(async () => {
          await bot.sendMessage(ADMIN_GROUP_ID, adminMessage, { parse_mode: 'Markdown' });
        }, 2, 500); // 2번 재시도, 500ms 딜레이
      } catch (adminError) {
        logger.error(`❌ 관리자 그룹 알림 전송 실패`, { 
          error: adminError.message, 
          adminGroupId: ADMIN_GROUP_ID,
          errorCode: adminError.code,
          response: adminError.response?.body
        });
      }
    }

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
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.chat.type === 'private') {
    // 개인 메시지인 경우
    bot.sendMessage(chatId, '안녕하세요! 저는 스팸 메시지 감지 봇입니다.\n\n📋 사용법:\n- 허용된 그룹에 저를 추가하고 관리자 권한을 주세요\n- 메시지 삭제 권한이 필요합니다\n- 자동으로 스팸 메시지를 감지하고 삭제합니다\n\n⚠️ 보안상 허용된 그룹에서만 작동합니다.');
  } else {
    const isAllowed = await isAllowedChat(chatId);
    if (isAllowed) {
      // 허용된 그룹인 경우
      bot.sendMessage(chatId, '✅ 안녕하세요! 저는 스팸 메시지 감지 봇입니다.\n\n이 그룹은 허용된 그룹으로 등록되어 있어 자동으로 스팸 메시지를 감지하고 삭제합니다.\n\n📋 기능:\n- AI 기반 스팸 감지\n- 스마트 URL 분석\n- 자동 메시지 삭제');
    } else {
      // 허용되지 않은 그룹인 경우
      bot.sendMessage(chatId, '❌ 이 그룹은 허용된 그룹 목록에 없어 봇이 작동하지 않습니다.\n\n관리자가 /whitelist_add 명령어로 이 그룹을 허용 목록에 추가해야 합니다.');
    }
  }
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  
  const totalQueueSize = highPriorityQueue.length + normalPriorityQueue.length;
  
  if (msg.chat.type === 'private') {
    // 개인 메시지인 경우
    const stats = await getWhitelistStats();
    bot.sendMessage(chatId, `🤖 봇 상태: 정상 작동 중\n📊 큐 대기 메시지: ${totalQueueSize}개 (높은 우선순위: ${highPriorityQueue.length}개, 일반: ${normalPriorityQueue.length}개)\n🏠 허용된 그룹 수: ${stats.length}개`);
  } else {
    const isAllowed = await isAllowedChat(chatId);
    if (isAllowed) {
      // 허용된 그룹인 경우
      bot.sendMessage(chatId, `✅ 봇 상태: 이 그룹에서 정상 작동 중\n📊 큐 대기 메시지: ${totalQueueSize}개 (높은 우선순위: ${highPriorityQueue.length}개, 일반: ${normalPriorityQueue.length}개)`);
    } else {
      // 허용되지 않은 그룹인 경우
      bot.sendMessage(chatId, '❌ 이 그룹에서는 봇이 작동하지 않습니다.');
    }
  }
});

// 그룹 ID 확인 명령어 추가
bot.onText(/\/chatid/, async (msg) => {
  const chatId = msg.chat.id;
  const isAllowed = await isAllowedChat(chatId);
  
  bot.sendMessage(chatId, `📍 현재 그룹 정보:\n\n🆔 채팅 ID: \`${chatId}\`\n📝 그룹명: ${msg.chat.title || '개인 채팅'}\n${isAllowed ? '✅ 허용된 그룹' : '❌ 허용되지 않은 그룹'}`, { parse_mode: 'Markdown' });
});

// 화이트리스트 관리 명령어들 (관리자 전용)
bot.onText(/\/whitelist_add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // 관리자 그룹에서만 실행 가능
  if (!isAdminGroup(chatId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
    return;
  }
  
  // 관리자만 실행 가능
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자만 사용할 수 있습니다.');
    return;
  }
  
  try {
    const targetChatId = parseInt(match[1]);
    if (isNaN(targetChatId)) {
      bot.sendMessage(chatId, '❌ 올바른 그룹 ID를 입력하세요. 예: /whitelist_add -1001234567890');
      return;
    }
    
    // 대상 그룹 정보 가져오기
    let chatInfo;
    try {
      chatInfo = await bot.getChat(targetChatId);
    } catch (error) {
      bot.sendMessage(chatId, '❌ 해당 그룹을 찾을 수 없습니다. 봇이 그룹에 추가되어 있는지 확인하세요.');
      return;
    }
    
    // 화이트리스트에 추가
    const success = await addToWhitelist(targetChatId, chatInfo.title, chatInfo.type, userId);
    if (success) {
      bot.sendMessage(chatId, `✅ 그룹 "${chatInfo.title}" (ID: ${targetChatId})이 화이트리스트에 추가되었습니다.`);
      logger.info(`📝 그룹이 화이트리스트에 추가됨`, {
        chatId: targetChatId,
        chatTitle: chatInfo.title,
        addedBy: userId,
        addedByUsername: msg.from.username
      });
    } else {
      bot.sendMessage(chatId, `⚠️ 그룹 "${chatInfo.title}"은 이미 화이트리스트에 등록되어 있습니다.`);
    }
  } catch (error) {
    logger.error(`❌ 화이트리스트 추가 실패`, { error: error.message, chatId: chatId });
    bot.sendMessage(chatId, '❌ 화이트리스트 추가 중 오류가 발생했습니다.');
  }
});

bot.onText(/\/whitelist_remove (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // 관리자 그룹에서만 실행 가능
  if (!isAdminGroup(chatId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
    return;
  }
  
  // 관리자만 실행 가능
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자만 사용할 수 있습니다.');
    return;
  }
  
  try {
    const targetChatId = parseInt(match[1]);
    if (isNaN(targetChatId)) {
      bot.sendMessage(chatId, '❌ 올바른 그룹 ID를 입력하세요. 예: /whitelist_remove -1001234567890');
      return;
    }
    
    // 화이트리스트에서 제거
    const success = await removeFromWhitelist(targetChatId);
    if (success) {
      bot.sendMessage(chatId, `✅ 그룹 (ID: ${targetChatId})이 화이트리스트에서 제거되었습니다.`);
      logger.info(`📝 그룹이 화이트리스트에서 제거됨`, {
        chatId: targetChatId,
        removedBy: userId,
        removedByUsername: msg.from.username
      });
    } else {
      bot.sendMessage(chatId, `⚠️ 그룹 (ID: ${targetChatId})은 화이트리스트에 등록되어 있지 않습니다.`);
    }
  } catch (error) {
    logger.error(`❌ 화이트리스트 제거 실패`, { error: error.message, chatId: chatId });
    bot.sendMessage(chatId, '❌ 화이트리스트 제거 중 오류가 발생했습니다.');
  }
});

bot.onText(/\/whitelist_list/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // 관리자 그룹에서만 실행 가능
  if (!isAdminGroup(chatId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
    return;
  }
  
  // 관리자만 실행 가능
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
    
    // 각 그룹에 대해 실시간 정보 조회
    for (let index = 0; index < stats.length; index++) {
      const row = stats[index];
      const addedDate = new Date(row.added_at).toLocaleDateString('ko-KR');
      
      // 실시간 그룹 정보 조회
      const currentInfo = await fetchCurrentGroupInfo(row.chat_id);
      
      message += `${index + 1}. `;
      
      if (currentInfo.accessible && currentInfo.title) {
        // 현재 그룹 이름이 있는 경우
        message += `${currentInfo.title}\n`;
        
        // 저장된 이름과 현재 이름이 다른 경우 추가 표시
        if (row.chat_title !== currentInfo.title) {
          message += `   📝 저장된 이름: ${row.chat_title}\n`;
        }
      } else {
        // 그룹에 접근할 수 없는 경우
        message += `${row.chat_title} ❌ 접근 불가\n`;
        if (currentInfo.error) {
          message += `   ⚠️ 오류: ${currentInfo.error}\n`;
        }
      }
      
      message += `   🆔 ID: \`${row.chat_id}\`\n`;
      message += `   📅 추가일: ${addedDate}\n`;
      
      // 그룹 타입 정보 표시
      const typeEmoji = currentInfo.type === 'supergroup' ? '🏢' : 
                       currentInfo.type === 'group' ? '👥' : 
                       currentInfo.type === 'private' ? '👤' : '❓';
      message += `   ${typeEmoji} 타입: ${currentInfo.type}\n\n`;
    }
    
    message += '💡 실시간 그룹 정보가 반영된 목록입니다.';
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error(`❌ 화이트리스트 조회 실패`, { error: error.message });
    bot.sendMessage(chatId, '❌ 화이트리스트 조회 중 오류가 발생했습니다.');
  }
});

// 명령어 동기화 명령어 추가
bot.onText(/\/sync_commands/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // 관리자 그룹에서만 실행 가능
  if (!isAdminGroup(chatId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자 그룹에서만 사용할 수 있습니다.');
    return;
  }
  
  // 관리자만 실행 가능
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ 이 명령어는 관리자만 사용할 수 있습니다.');
    return;
  }
  
  try {
    await bot.sendMessage(chatId, '🔄 봇 명령어 동기화를 시작합니다...');
    
    // 명령어 동기화 실행
    await syncBotCommands();
    
    await bot.sendMessage(chatId, '✅ 봇 명령어 동기화가 완료되었습니다.\n\n📋 동기화된 명령어:\n• 일반 사용자: start, help, status, chatid\n• 관리자: 모든 명령어 + 화이트리스트 관리 명령어');
    
    logger.info('🔄 관리자가 명령어 동기화를 실행함', {
      adminUserId: userId,
      adminUsername: msg.from.username,
      chatId: chatId
    });
    
  } catch (error) {
    logger.error(`❌ 명령어 동기화 실패`, { error: error.message, chatId: chatId });
    bot.sendMessage(chatId, '❌ 명령어 동기화 중 오류가 발생했습니다.');
  }
});

// 도움말 명령어 업데이트
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isAllowed = msg.chat.type !== 'private' ? await isAllowedChat(chatId) : true;
  
  let helpMessage = '🤖 **텔레그램 스팸 감지 봇 도움말**\n\n';
  helpMessage += '**기본 명령어:**\n';
  helpMessage += '/start - 봇 소개 및 시작\n';
  helpMessage += '/status - 봇 상태 확인\n';
  helpMessage += '/chatid - 현재 그룹 ID 확인\n';
  helpMessage += '/help - 도움말\n\n';
  
  if (isAdminGroup(chatId) && isAdmin(userId)) {
    helpMessage += '**관리자 명령어:**\n';
    helpMessage += '/whitelist_add [그룹ID] - 그룹을 화이트리스트에 추가\n';
    helpMessage += '/whitelist_remove [그룹ID] - 그룹을 화이트리스트에서 제거\n';
    helpMessage += '/whitelist_list - 화이트리스트 목록 확인\n';
    helpMessage += '/sync_commands - 봇 명령어 동기화\n\n';
  }
  
  if (msg.chat.type !== 'private') {
    if (isAllowed) {
      helpMessage += '✅ 이 그룹은 스팸 감지가 활성화되어 있습니다.';
    } else {
      helpMessage += '❌ 이 그룹은 스팸 감지가 비활성화되어 있습니다.';
    }
  }
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// 에러 핸들링 개선
bot.on('polling_error', (error) => {
  // 일반적인 네트워크 오류는 WARN 레벨로 처리
  if (error.code === 'EFATAL' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    logger.warn(`🔄 텔레그램 Polling 네트워크 오류 (재시도 중)`, { 
      error: error.message, 
      code: error.code
    });
  } else {
    logger.error(`🔄 텔레그램 Polling 심각한 오류`, { 
      error: error.message, 
      code: error.code, 
      stack: error.stack 
    });
  }
});

// 웹훅 에러도 처리
bot.on('webhook_error', (error) => {
  logger.error(`🔗 웹훅 오류`, { 
    error: error.message, 
    stack: error.stack 
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`💥 처리되지 않은 Promise 거부`, { 
    reason: reason instanceof Error ? reason.message : reason, 
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString() 
  });
});

process.on('uncaughtException', (error) => {
  logger.error(`💥 예외 처리되지 않은 오류 - 봇 종료`, { 
    error: error.message, 
    stack: error.stack 
  });
  
  // 정상적인 종료 시도
  if (db) {
    db.close((err) => {
      if (err) {
        logger.error('❌ 데이터베이스 연결 종료 실패', { error: err.message });
      }
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
}); 