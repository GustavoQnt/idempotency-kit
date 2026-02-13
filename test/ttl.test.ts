import { describe, expect, it, vi } from "vitest";
import { IdempotencyLocal } from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ttl", () => {
  it("expires success and re-executes after ttl", async () => {
    const store = new IdempotencyLocal({ ttlMs: 40 });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await expect(store.run("k", fn)).resolves.toBe("first");
    await expect(store.run("k", fn)).resolves.toBe("first");
    await sleep(70);
    await expect(store.run("k", fn)).resolves.toBe("second");

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
