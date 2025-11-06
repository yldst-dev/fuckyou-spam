// Minimal vendor type declarations to satisfy strict TS without external @types

declare module 'node-telegram-bot-api' {
  // Class definition
  declare class TelegramBot {
    constructor(token: string, options?: { polling?: boolean } & Record<string, unknown>);
    onText(regex: RegExp, callback: (msg: TelegramBot.Message, match: RegExpExecArray | null) => void): void;
    on(event: 'message', callback: (msg: TelegramBot.Message) => void): void;
    on(event: 'polling_error', callback: (error: unknown) => void): void;
    on(event: 'webhook_error', callback: (error: unknown) => void): void;
    sendMessage(chatId: number, text: string, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message>;
    deleteMessage(chatId: number, messageId: number | string): Promise<boolean>;
    getChat(chatId: number | string): Promise<TelegramBot.Chat>;
    editMessageText(
      text: string,
      options?: {
        chat_id?: number;
        message_id?: number | string;
        inline_message_id?: string;
        parse_mode?: 'Markdown' | 'HTML';
        disable_web_page_preview?: boolean;
      }
    ): Promise<boolean>;
    getChatMember(chatId: number, userId: number): Promise<TelegramBot.ChatMember>;
    getMe(): Promise<TelegramBot.User>;
    setMyCommands(
      commands: TelegramBot.BotCommand[],
      options?: { scope?: unknown; language_code?: string }
    ): Promise<boolean>;
  }

  // Namespace for types (merged with class)
  declare namespace TelegramBot {
    interface Chat {
      id: number;
      title?: string;
      type?: string;
    }

    interface User {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      username?: string;
    }

    interface MessageEntity {
      type: string;
      offset: number;
      length: number;
      url?: string;
    }

    interface Message {
      message_id: number;
      chat: Chat;
      text?: string;
      caption?: string;
      entities?: MessageEntity[];
      from: User;
    }

    interface SendMessageOptions {
      parse_mode?: 'Markdown' | 'HTML';
      disable_web_page_preview?: boolean;
    }

    interface BotCommand {
      command: string;
      description: string;
    }

    type ChatMemberStatus =
      | 'creator'
      | 'administrator'
      | 'member'
      | 'restricted'
      | 'left'
      | 'kicked';

    interface ChatMember {
      user: User;
      status: ChatMemberStatus;
    }
  }

  export = TelegramBot;
}

declare module 'node-cron' {
  export interface ScheduledTask {
    start(): void;
    stop(): void;
  }
  export function schedule(
    expression: string,
    func: () => void,
    options?: { timezone?: string }
  ): ScheduledTask;
  const cron: { schedule: typeof schedule };
  export default cron;
}

declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string | Buffer, options?: Record<string, unknown>);
    window: any;
  }
}

declare module '@mozilla/readability' {
  export class Readability {
    constructor(doc: any);
    parse():
      | {
          title?: string;
          byline?: string;
          dir?: string;
          content?: string;
          textContent?: string;
          length?: number;
          excerpt?: string;
          siteName?: string;
        }
      | null;
  }
}