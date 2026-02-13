import { bench, describe } from "vitest";
import { IdempotencyLocal } from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("idempotency-local benchmarks", () => {
  bench("run miss (new key each call)", async () => {
    const idem = new IdempotencyLocal({ ttlMs: 60_000 });
    const key = `miss:${Math.random().toString(36).slice(2)}`;
    await idem.run(key, async () => 1);
  });

  bench("run hit (same key)", async () => {
    const idem = new IdempotencyLocal({ ttlMs: 60_000 });
    await idem.run("hit:key", async () => 1);
    await idem.run("hit:key", async () => 1);
  });

  bench("inflight dedup (100 concurrent same key)", async () => {
    const idem = new IdempotencyLocal({ ttlMs: 60_000 });
    const tasks = Array.from({ length: 100 }, () =>
      idem.run("dedup:key", async () => {
        await sleep(1);
        return 1;
      })
    );
    await Promise.all(tasks);
  });

  bench("lru pressure (maxSize=1_000, 2_000 inserts)", async () => {
    const idem = new IdempotencyLocal({ ttlMs: 60_000, maxSize: 1_000 });
    for (let i = 0; i < 2_000; i += 1) {
      await idem.run(`lru:${i}`, async () => i);
    }
  });

  bench("prune expired (5_000 keys)", async () => {
    const idem = new IdempotencyLocal({ ttlMs: 5 });
    for (let i = 0; i < 5_000; i += 1) {
      await idem.run(`prune:${i}`, async () => i);
    }
    await sleep(10);
    idem.prune();
  });
});
