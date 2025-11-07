import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { env } from '../config/env';
import { logger } from '../logger';
import { ClassificationMap } from '../types';

const cerebras = new Cerebras({ apiKey: env.CEREBRAS_API_KEY });

export async function classifySpam(messagePrompt: string): Promise<ClassificationMap> {
  try {
    const response = await cerebras.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You are a bot that reads Telegram messages and classifies them as spam or not spam. Focus on identifying actual spam content, not just membership status.\n\nClassify as spam (true) ONLY if:\n1. Cryptocurrency (coin) promotions, NFT promotions, Web3 promotions\n2. Illegal advertising, gambling, drugs, adult content, or unsafe links\n3. Multi-level marketing or pyramid schemes\n4. Link or invite spam intended to drive users to other groups or websites\n5. Obvious phishing or scam attempts\n\nIgnore non-spam messages, normal conversation, admin messages, or bot commands. Return a JSON object mapping message IDs to boolean values. Example: {"123": false, "124": true}',
        },
        { role: 'user', content: messagePrompt },
      ],
      model: env.CEREBRAS_MODEL,
      stream: false,
      max_completion_tokens: 2048,
      temperature: 0.2,
      top_p: 1,
      response_format: { type: 'json_object' },
    });
    // Type-safe extraction from the SDK response which is currently typed with unknowns
    type ChatCompletionResponse = { choices?: Array<{ message?: { content?: unknown } }> };
    const { choices } = response as ChatCompletionResponse;
    if (!Array.isArray(choices) || !choices[0]?.message || typeof choices[0].message.content !== 'string') {
      throw new Error('Invalid AI response format: missing choices[0].message.content');
    }
    const rawContent = choices[0].message.content as string;
    const classification = JSON.parse(rawContent) as ClassificationMap;
    logger.info('✅ AI 스팸 분류 완료', {
      totalAnalyzed: Object.keys(classification).length,
      spamDetected: Object.values(classification).filter((v) => v).length,
      service: 'ai',
    });
    return classification;
  } catch (error: any) {
    logger.error('❌ AI 스팸 분류 실패', { error: error.message, service: 'ai' });
    throw error;
  }
}