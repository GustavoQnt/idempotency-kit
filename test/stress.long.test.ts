import { describe, expect, it } from "vitest";
import { IdempotencyLocal } from "../src";

const DEFAULT_DURATION_MS = 5 * 60_000;
const DEFAULT_LOG_INTERVAL_MS = 15_000;
const DEFAULT_CONCURRENCY = 64;
const DEFAULT_BATCH_SIZE = 128;
const DEFAULT_MAX_SIZE = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

describe("stress (long-running)", () => {
  it(
    "keeps cache bounded and memory stable under mixed load",
    { timeout: readIntEnv("STRESS_TIMEOUT_MS", DEFAULT_DURATION_MS + 30_000) },
    async () => {
      const durationMs = readIntEnv("STRESS_DURATION_MS", DEFAULT_DURATION_MS);
      const logIntervalMs = readIntEnv("STRESS_LOG_INTERVAL_MS", DEFAULT_LOG_INTERVAL_MS);
      const concurrency = readIntEnv("STRESS_CONCURRENCY", DEFAULT_CONCURRENCY);
      const batchSize = readIntEnv("STRESS_BATCH_SIZE", DEFAULT_BATCH_SIZE);

      const idem = new IdempotencyLocal({
        ttlMs: 900,
        cacheFailures: true,
        failureTtlMs: 300,
        maxSize: DEFAULT_MAX_SIZE,
        cleanupIntervalMs: false,
      });

      const hotKeys = Array.from({ length: 40 }, (_, i) => `order:hot:${i}`);
      const warmKeys = Array.from({ length: 450 }, (_, i) => `order:warm:${i}`);
      const failKeys = Array.from({ length: 12 }, (_, i) => `order:fail:${i}`);
      const recentKeys: string[] = [];
      let unique = 0;

      const rng = createRng(42_4242);
      const startedAt = Date.now();
      const warmupEndsAt = startedAt + Math.floor(durationMs * 0.25);
      const endsAt = startedAt + durationMs;
      let nextLogAt = startedAt;
      let nextPruneAt = startedAt;

      let warmupHeap = 0;
      let peakHeapAfterWarmup = 0;

      while (Date.now() < endsAt) {
        const tasks = Array.from({ length: batchSize }, async () => {
          const roll = rng();
          let key: string;

          if (roll < 0.5) {
            key = hotKeys[Math.floor(rng() * hotKeys.length)];
          } else if (roll < 0.78) {
            key = warmKeys[Math.floor(rng() * warmKeys.length)];
          } else if (roll < 0.92 && recentKeys.length > 0) {
            key = recentKeys[Math.floor(rng() * recentKeys.length)];
          } else if (roll < 0.98) {
            key = `order:new:${unique}`;
            unique += 1;
          } else {
            key = failKeys[Math.floor(rng() * failKeys.length)];
          }

          recentKeys.push(key);
          if (recentKeys.length > 1_000) recentKeys.shift();

          const loaderDelayMs = 3 + Math.floor(rng() * 22);
          const shouldFail = key.startsWith("order:fail:");

          try {
            await idem.run(key, async () => {
              await sleep(loaderDelayMs);
              if (shouldFail) throw new Error("gateway-5xx");
              return { ok: true, key, at: Date.now() };
            });
          } catch {
            // Failures are part of workload.
          }
        });

        for (let i = 0; i < tasks.length; i += concurrency) {
          const chunk = tasks.slice(i, i + concurrency);
          await Promise.all(chunk);
        }

        const now = Date.now();
        const mem = process.memoryUsage();

        if (now >= warmupEndsAt) {
          if (warmupHeap === 0) warmupHeap = mem.heapUsed;
          peakHeapAfterWarmup = Math.max(peakHeapAfterWarmup, mem.heapUsed);
        }

        if (now >= nextPruneAt) {
          idem.prune();
          nextPruneAt = now + 2_000;
        }

        if (now >= nextLogAt) {
          const stats = idem.getStats();
          console.log(
            `[stress:idempotency-kit] t=${((now - startedAt) / 1000).toFixed(1)}s rss=${formatMb(mem.rss)} heap=${formatMb(mem.heapUsed)} size=${stats.size} inFlight=${stats.inFlight} runs=${stats.runs} hitsCompleted=${stats.hitsCompleted} hitsFailed=${stats.hitsFailed} inflightHits=${stats.inflightHits} missesExecuted=${stats.missesExecuted} missesExecutedFailed=${stats.missesExecutedFailed}`,
          );
          nextLogAt = now + logIntervalMs;
        }
      }

      idem.prune();
      const finalStats = idem.getStats();
      const finalMem = process.memoryUsage();
      const growthBytes = warmupHeap > 0 ? peakHeapAfterWarmup - warmupHeap : 0;

      console.log(
        `[stress:idempotency-kit] done duration=${durationMs}ms rss=${formatMb(finalMem.rss)} heap=${formatMb(finalMem.heapUsed)} peakGrowthAfterWarmup=${formatMb(growthBytes)}`,
      );

      expect(finalStats.size).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
      expect(finalStats.inFlight).toBe(0);
      expect(finalStats.runs).toBeGreaterThan(0);
      expect(finalStats.missesExecuted).toBeGreaterThan(0);
      expect(finalStats.hitsCompleted + finalStats.inflightHits).toBeGreaterThan(0);
      expect(growthBytes).toBeLessThan(96 * 1024 * 1024);

      idem.dispose();
    },
  );
});
