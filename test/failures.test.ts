import { describe, expect, it, vi } from "vitest";
import { IdempotencyLocal } from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("failures", () => {
  it("caches failures when cacheFailures=true", async () => {
    const store = new IdempotencyLocal({
      ttlMs: 1_000,
      cacheFailures: true,
      failureTtlMs: 1_000
    });
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(store.run("k", fn)).rejects.toThrow("boom");
    await expect(store.run("k", fn)).rejects.toThrow("boom");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getStats().hitsFailed).toBe(1);
  });

  it("re-executes when cacheFailures=false", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000, cacheFailures: false });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockResolvedValueOnce("ok");

    await expect(store.run("k", fn)).rejects.toThrow("first");
    await expect(store.run("k", fn)).resolves.toBe("ok");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects failureTtlMs", async () => {
    const store = new IdempotencyLocal({
      ttlMs: 1_000,
      cacheFailures: true,
      failureTtlMs: 40
    });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");

    await expect(store.run("k", fn)).rejects.toThrow("transient");
    await expect(store.run("k", fn)).rejects.toThrow("transient");
    await sleep(70);
    await expect(store.run("k", fn)).resolves.toBe("ok");

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
