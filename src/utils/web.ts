import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { WebContent } from '../types';
import { logger } from '../logger';

export async function fetchWebPageContent(url: string): Promise<WebContent | null> {
  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    const dom = new JSDOM(data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    return {
      title: article?.title || null,
      siteName: (dom.window.document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) || null,
      content: article?.textContent || null,
    };
  } catch (error: any) {
    logger.warn('⚠️ 웹페이지 내용 분석 실패', { url, error: error.message, service: 'web' });
    return null;
  }
}