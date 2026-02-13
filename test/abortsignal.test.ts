import { describe, expect, it } from "vitest";
import { AbortError, IdempotencyLocal, isAbortError } from "../src";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("abort signal", () => {
  it("aborting one caller does not cancel shared inflight execution", async () => {
    const store = new IdempotencyLocal({ ttlMs: 1_000 });
    const d = deferred<string>();
    const fn = () => d.promise;

    const controller = new AbortController();
    const callerA = store.run("k", fn, { signal: controller.signal });
    const callerB = store.run("k", fn);

    controller.abort();
    d.resolve("ok");

    await expect(callerA).rejects.toBeInstanceOf(AbortError);
    await expect(callerA).rejects.toSatisfy((error: unknown) => isAbortError(error));
    await expect(callerB).resolves.toBe("ok");

    expect(store.getStats().abortedWaits).toBe(1);
  });
});
