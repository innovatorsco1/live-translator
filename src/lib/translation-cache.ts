/**
 * LRU translation cache.
 *
 * Stores recent translations keyed by normalised source text to avoid
 * redundant OpenAI API calls for repeated or common phrases.
 *
 * The cache is intentionally simple (in-memory Map with LRU eviction)
 * because the working set of a live event is small and ephemeral.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE = 500;

// ---------------------------------------------------------------------------
// Cache implementation
// ---------------------------------------------------------------------------

interface CacheEntry {
  translation: string;
  /** Unix ms when the entry was inserted. */
  createdAt: number;
}

export class TranslationCache {
  private readonly maxSize: number;
  private readonly store = new Map<string, CacheEntry>();

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Normalise the input text so minor whitespace / casing differences still
   * hit the cache.
   */
  private normalise(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Look up a cached translation.  Returns `undefined` on cache miss.
   * On hit the entry is promoted to the most-recently-used position.
   */
  get(text: string): string | undefined {
    const key = this.normalise(text);
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Promote to MRU by deleting and re-inserting (Map preserves insertion order).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.translation;
  }

  /**
   * Store a translation in the cache.  If the cache is at capacity the
   * least-recently-used entry is evicted first.
   */
  set(text: string, translation: string): void {
    const key = this.normalise(text);

    // If updating an existing entry, delete first so it moves to the end.
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict the oldest entry (first key in Map insertion order) if needed.
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, { translation, createdAt: Date.now() });
  }

  /** Number of entries currently cached. */
  get size(): number {
    return this.store.size;
  }

  /** Flush all cached entries. */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const translationCache = new TranslationCache();
