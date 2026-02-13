import { describe, expect, it, vi } from "vitest";
import { IdempotencyLocal } from "../src";

describe("lru", () => {
  it("evicts least recently used when maxSize is exceeded", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000, maxSize: 1 });
    const fnA = vi.fn(async () => "a");
    const fnB = vi.fn(async () => "b");

    await store.run("a", fnA);
    await store.run("b", fnB);
    await store.run("a", fnA);

    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});
