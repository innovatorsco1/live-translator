/**
 * Translation service backed by OpenAI GPT-4.
 *
 * This module is server-only (used inside Next.js API routes and the WebSocket
 * handler). It must never be imported from client components.
 */

import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

/**
 * Lazily-initialised OpenAI client.  We defer construction until the first
 * call so that the module can be imported in environments where the API key
 * may not yet be present (e.g. during type-checking).
 */
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate `text` from `sourceLang` to `targetLang` using GPT-4.
 *
 * @param text       - The text to translate.
 * @param sourceLang - BCP-47 language tag or plain name of the source language.
 *                     Defaults to `"English"`.
 * @param targetLang - BCP-47 language tag or plain name of the target language.
 *                     Defaults to `"Spanish"`.
 * @returns The translated string, or the original `text` when translation fails.
 *
 * @example
 * ```ts
 * const spanish = await translateText('Good morning, everyone.');
 * // => 'Buenos días a todos.'
 * ```
 */
export async function translateText(
  text: string,
  sourceLang: string = 'English',
  targetLang: string = 'Spanish',
): Promise<string> {
  // Short-circuit empty or whitespace-only input to avoid wasting API credits.
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return text;
  }

  try {
    const client = getClient();

    const systemPrompt =
      `You are a professional real-time translator. ` +
      `Translate the following text from ${sourceLang} to ${targetLang}. ` +
      `Only output the translation, nothing else. ` +
      `Maintain the tone and meaning.`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: trimmed },
      ],
      // Keep latency low for real-time use: single translation sentence is short.
      max_tokens: 512,
      temperature: 0.2,
    });

    const translated = completion.choices[0]?.message?.content?.trim();

    if (!translated) {
      console.warn('[translation] GPT-4 returned an empty response for input:', trimmed);
      return text;
    }

    return translated;
  } catch (error) {
    // Log the error server-side so operators can investigate without exposing
    // raw error details to the client.
    console.error('[translation] OpenAI API error:', error);
    // Graceful degradation: return original text so captions keep flowing.
    return text;
  }
}
