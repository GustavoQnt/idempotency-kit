import { TtlCache } from "@gustavoqnt/ttl-cache";
import { AbortError } from "./errors";
import type { IdempotencyLocalOptions, IdempotencyStats, RunMeta, RunOptions } from "./types";

interface NormalizedOptions {
  ttlMs: number;
  cacheFailures: boolean;
  failureTtlMs: number;
  keyPrefix: string;
}

type ResultRecord =
  | { status: "completed"; value: unknown }
  | { status: "failed"; error: unknown };

interface Counters {
  runs: number;
  hitsCompleted: number;
  hitsFailed: number;
  inflightHits: number;
  missesExecuted: number;
  missesExecutedFailed: number;
  abortedWaits: number;
}

const DEFAULT_TTL_MS = 30_000;

export class IdempotencyLocal {
  private readonly options: NormalizedOptions;
  private readonly resultCache: TtlCache<string, ResultRecord>;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly counters: Counters = {
    runs: 0,
    hitsCompleted: 0,
    hitsFailed: 0,
    inflightHits: 0,
    missesExecuted: 0,
    missesExecutedFailed: 0,
    abortedWaits: 0
  };

  constructor(options: IdempotencyLocalOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.options = {
      ttlMs,
      cacheFailures: options.cacheFailures ?? false,
      failureTtlMs: options.failureTtlMs ?? ttlMs,
      keyPrefix: options.keyPrefix ?? ""
    };

    const cacheOptions: {
      ttlMs: number;
      maxSize?: number;
      cleanupIntervalMs?: number | false;
    } = { ttlMs };
    if (typeof options.maxSize === "number") {
      cacheOptions.maxSize = options.maxSize;
    }
    if (typeof options.cleanupIntervalMs === "number" || options.cleanupIntervalMs === false) {
      cacheOptions.cleanupIntervalMs = options.cleanupIntervalMs;
    }

    this.resultCache = new TtlCache<string, ResultRecord>(cacheOptions);
  }

  public get size(): number {
    return this.resultCache.size;
  }

  public async run<T>(key: string, fn: () => Promise<T> | T, options: RunOptions = {}): Promise<T> {
    const { value } = await this.execute(key, fn, options);
    return value;
  }

  public async runWithMeta<T>(
    key: string,
    fn: () => Promise<T> | T,
    options: RunOptions = {}
  ): Promise<{ value: T; meta: RunMeta }> {
    return this.execute(key, fn, options);
  }

  public delete(key: string): boolean {
    return this.resultCache.delete(this.normalizeKey(key));
  }

  public clear(): void {
    this.resultCache.clear();
  }

  public prune(): number {
    const before = this.resultCache.size;
    const pruneResult = (this.resultCache as { prune: () => unknown }).prune();

    if (typeof pruneResult === "number") {
      return pruneResult;
    }

    const after = this.resultCache.size;
    return Math.max(0, before - after);
  }

  public getStats(): IdempotencyStats {
    return {
      runs: this.counters.runs,
      hitsCompleted: this.counters.hitsCompleted,
      hitsFailed: this.counters.hitsFailed,
      inflightHits: this.counters.inflightHits,
      missesExecuted: this.counters.missesExecuted,
      missesExecutedFailed: this.counters.missesExecutedFailed,
      abortedWaits: this.counters.abortedWaits,
      size: this.resultCache.size,
      inFlight: this.inflight.size
    };
  }

  public dispose(): void {
    this.inflight.clear();
    this.resultCache.dispose();
  }

  private async execute<T>(
    key: string,
    fn: () => Promise<T> | T,
    options: RunOptions
  ): Promise<{ value: T; meta: RunMeta }> {
    this.counters.runs += 1;
    this.throwIfAborted(options.signal);

    const finalKey = this.normalizeKey(key);
    const metaKey = finalKey;
    const effectiveCacheFailures = options.cacheFailures ?? this.options.cacheFailures;

    const cached = this.resultCache.get(finalKey);
    if (cached) {
      if (cached.status === "completed") {
        this.counters.hitsCompleted += 1;
        return {
          value: cached.value as T,
          meta: { key: metaKey, status: "hit_completed" }
        };
      }

      if (effectiveCacheFailures) {
        this.counters.hitsFailed += 1;
        throw cached.error;
      }
    }

    const existingInflight = this.inflight.get(finalKey) as Promise<T> | undefined;
    if (existingInflight) {
      this.counters.inflightHits += 1;
      const value = await this.withCallerAbort(existingInflight, options.signal);
      return { value, meta: { key: metaKey, status: "inflight_hit" } };
    }

    const ttlMs = options.ttlMs ?? this.options.ttlMs;
    const failureTtlMs = options.failureTtlMs ?? this.options.failureTtlMs;

    const executionPromise = (async (): Promise<T> => {
      try {
        const value = await fn();
        this.counters.missesExecuted += 1;
        this.resultCache.set(finalKey, { status: "completed", value }, { ttlMs });
        return value;
      } catch (error) {
        this.counters.missesExecutedFailed += 1;
        if (effectiveCacheFailures) {
          this.resultCache.set(finalKey, { status: "failed", error }, { ttlMs: failureTtlMs });
        } else {
          this.resultCache.delete(finalKey);
        }
        throw error;
      } finally {
        this.inflight.delete(finalKey);
      }
    })();

    this.inflight.set(finalKey, executionPromise);

    const value = await this.withCallerAbort(executionPromise, options.signal);
    return {
      value,
      meta: { key: metaKey, status: "miss_executed" }
    };
  }

  private normalizeKey(key: string): string {
    return this.options.keyPrefix ? `${this.options.keyPrefix}:${key}` : key;
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      this.counters.abortedWaits += 1;
      throw new AbortError();
    }
  }

  private async withCallerAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) {
      return promise;
    }

    if (signal.aborted) {
      this.counters.abortedWaits += 1;
      throw new AbortError();
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        this.counters.abortedWaits += 1;
        reject(new AbortError());
      };

      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };

      signal.addEventListener("abort", onAbort, { once: true });

      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        }
      );
    });
  }
}

export function createIdempotencyLocal(options?: IdempotencyLocalOptions): IdempotencyLocal {
  return new IdempotencyLocal(options);
}
