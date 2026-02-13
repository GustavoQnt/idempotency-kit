import { describe, expect, it } from "vitest";
import { IdempotencyLocal } from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("prune", () => {
  it("removes expired entries and returns removed count", async () => {
    const store = new IdempotencyLocal({ ttlMs: 20 });

    await store.run("a", () => "a");
    await store.run("b", () => "b");

    expect(store.size).toBeGreaterThanOrEqual(2);
    await sleep(50);

    const removed = store.prune();

    expect(removed).toBeGreaterThanOrEqual(2);
    expect(store.size).toBe(0);
    expect(store.getStats().size).toBe(0);
  });
});
