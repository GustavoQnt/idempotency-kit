import { describe, expect, it, vi } from "vitest";
import { IdempotencyLocal } from "../src";

describe("run basic", () => {
  it("executes once on miss", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000 });
    const fn = vi.fn(async () => "ok");

    const value = await store.run("k1", fn);

    expect(value).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getStats().missesExecuted).toBe(1);
  });

  it("returns hit and does not re-execute", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000 });
    const fn = vi.fn(async () => "ok");

    await store.run("k1", fn);
    const second = await store.run("k1", fn);

    expect(second).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getStats().hitsCompleted).toBe(1);
  });

  it("runWithMeta returns miss then hit", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000 });
    const fn = vi.fn(async () => 42);

    const first = await store.runWithMeta("k1", fn);
    const second = await store.runWithMeta("k1", fn);

    expect(first.value).toBe(42);
    expect(first.meta.status).toBe("miss_executed");
    expect(second.meta.status).toBe("hit_completed");
  });
});
