/**
 * POST /api/translate
 *
 * REST endpoint for on-demand text translation.  Accepts a JSON body and
 * delegates to the OpenAI-backed translation service.
 *
 * Request body (application/json):
 *   { text: string, sourceLang?: string, targetLang?: string }
 *
 * Success response (200):
 *   { translatedText: string }
 *
 * Error responses:
 *   400 – { error: string }  (missing / invalid request body)
 *   500 – { error: string }  (translation service failure)
 */

import { NextResponse } from 'next/server';
import { translateText } from '@/lib/translation';

export async function POST(request: Request): Promise<NextResponse> {
  // -------------------------------------------------------------------------
  // 1. Parse and validate the request body
  // -------------------------------------------------------------------------

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON' },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 },
    );
  }

  const { text, sourceLang = 'English', targetLang = 'Spanish' } = body as Record<string, unknown>;

  if (!text || typeof text !== 'string') {
    return NextResponse.json(
      { error: 'text is required and must be a non-empty string' },
      { status: 400 },
    );
  }

  if (typeof sourceLang !== 'string' || sourceLang.trim().length === 0) {
    return NextResponse.json(
      { error: 'sourceLang must be a non-empty string' },
      { status: 400 },
    );
  }

  if (typeof targetLang !== 'string' || targetLang.trim().length === 0) {
    return NextResponse.json(
      { error: 'targetLang must be a non-empty string' },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // 2. Perform translation
  // -------------------------------------------------------------------------

  try {
    const translatedText = await translateText(text, sourceLang, targetLang);
    return NextResponse.json({ translatedText });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed';
    console.error('[POST /api/translate] Unhandled error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
