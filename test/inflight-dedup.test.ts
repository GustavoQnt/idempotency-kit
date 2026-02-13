import { describe, expect, it, vi } from "vitest";
import { IdempotencyLocal } from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("inflight dedup", () => {
  it("deduplicates 100 concurrent callers", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000 });
    const fn = vi.fn(async () => {
      await sleep(30);
      return "shared";
    });

    const results = await Promise.all(
      Array.from({ length: 100 }, () => store.run("same-key", fn))
    );

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("shared");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getStats().inflightHits).toBe(99);
  });

  it("runWithMeta marks inflight hits", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000 });
    const fn = vi.fn(async () => {
      await sleep(20);
      return "done";
    });

    const [first, second] = await Promise.all([
      store.runWithMeta("x", fn),
      store.runWithMeta("x", fn)
    ]);

    const statuses = [first.meta.status, second.meta.status].sort();
    expect(statuses).toEqual(["inflight_hit", "miss_executed"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
