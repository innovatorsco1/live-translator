/**
 * Translation service backed by OpenAI.
 *
 * Optimisations (vs. the original implementation):
 *  - Model: gpt-4o-mini instead of gpt-4 (~5x faster, sufficient for translation)
 *  - Streaming: `translateTextStream` yields tokens as they arrive
 *  - Caching: LRU cache avoids re-translating repeated / common phrases
 *  - Compact prompt: shorter system prompt → fewer input tokens → lower latency
 *
 * This module is server-only (used inside Next.js API routes and the WebSocket
 * handler). It must never be imported from client components.
 */

import OpenAI from 'openai';
import { translationCache } from './translation-cache';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client === null) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is not set. ' +
          'Add it to your .env.local file before starting the server.',
      );
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

/** Fast model for translation – gpt-4o-mini is ~5x faster than gpt-4. */
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(sourceLang: string, targetLang: string): string {
  return (
    `Translate ${sourceLang} to ${targetLang}. Output ONLY the translation.`
  );
}

// ---------------------------------------------------------------------------
// Public API: batch translation (with cache)
// ---------------------------------------------------------------------------

/**
 * Translate `text` from `sourceLang` to `targetLang`.
 * Returns a cached result when available.
 */
export async function translateText(
  text: string,
  sourceLang: string = 'English',
  targetLang: string = 'Spanish',
): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;

  // Cache lookup
  const cached = translationCache.get(trimmed);
  if (cached) {
    return cached;
  }

  try {
    const client = getClient();

    const completion = await client.chat.completions.create({
      model: TRANSLATION_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt(sourceLang, targetLang) },
        { role: 'user', content: trimmed },
      ],
      max_tokens: 512,
      temperature: 0.2,
    });

    const translated = completion.choices[0]?.message?.content?.trim();

    if (!translated) {
      console.warn('[translation] Empty response for:', trimmed);
      return text;
    }

    // Populate cache
    translationCache.set(trimmed, translated);

    return translated;
  } catch (error) {
    console.error('[translation] OpenAI API error:', error);
    return text;
  }
}

// ---------------------------------------------------------------------------
// Public API: streaming translation
// ---------------------------------------------------------------------------

/**
 * Callback invoked for each streamed token chunk.
 *
 * @param chunk  - The new token(s) received from the model.
 * @param accumulated - All text received so far (concatenation of all chunks).
 */
export type StreamChunkCallback = (chunk: string, accumulated: string) => void;

/**
 * Translate `text` using the OpenAI streaming API.
 *
 * Calls `onChunk` for every incremental token and returns the full
 * translated string once the stream completes.
 *
 * If the text is found in the cache, `onChunk` is called once with the
 * full cached translation and the function resolves immediately.
 */
export async function translateTextStream(
  text: string,
  onChunk: StreamChunkCallback,
  sourceLang: string = 'English',
  targetLang: string = 'Spanish',
): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    onChunk(text, text);
    return text;
  }

  // Cache hit → instant result
  const cached = translationCache.get(trimmed);
  if (cached) {
    onChunk(cached, cached);
    return cached;
  }

  try {
    const client = getClient();

    const stream = await client.chat.completions.create({
      model: TRANSLATION_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt(sourceLang, targetLang) },
        { role: 'user', content: trimmed },
      ],
      max_tokens: 512,
      temperature: 0.2,
      stream: true,
    });

    let accumulated = '';

    for await (const event of stream) {
      const delta = event.choices[0]?.delta?.content;
      if (delta) {
        accumulated += delta;
        onChunk(delta, accumulated);
      }
    }

    const result = accumulated.trim() || text;

    // Populate cache
    translationCache.set(trimmed, result);

    return result;
  } catch (error) {
    console.error('[translation] Streaming error:', error);
    // Fallback: return original text
    onChunk(text, text);
    return text;
  }
}
