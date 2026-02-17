# idempotency-kit

[![npm version](https://img.shields.io/npm/v/idempotency-kit?style=flat-square)](https://www.npmjs.com/package/idempotency-kit)
[![npm downloads](https://img.shields.io/npm/dm/idempotency-kit?style=flat-square&color=blue)](https://www.npmjs.com/package/idempotency-kit)
[![CI](https://img.shields.io/github/actions/workflow/status/GustavoQnt/idempotency-kit/ci.yml?branch=main&style=flat-square)](https://github.com/GustavoQnt/idempotency-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

<!-- TRAFFIC_START -->
## Traffic Dashboard

GitHub traffic snapshot (rolling window reported by GitHub API).

Totals since 2026-02-12: **75 views** and **247 clones**.

| Date | Views | Clones |
|---|---:|---:|
| 2026-02-15 | 17 | 34 |
| 2026-02-14 | 20 | 30 |
| 2026-02-13 | 38 | 183 |
| 2026-02-12 | 0 | 0 |

_Updated automatically: 2026-02-17T05:04:17.370Z_
<!-- TRAFFIC_END -->

Local-only idempotency for Node.js/TypeScript.

- Dedup concurrent executions by key (single in-flight promise).
- Return the same result on retries while TTL is valid.
- Optional failed-result memoization (`cacheFailures`).
- Abort one caller without canceling shared execution.
- Zero infra (in-memory only).

## Why this library

- Webhook duplicates.
- Client retries.
- Double-submit and double-click actions.
- Accidental job reprocessing.

## Install

```bash
npm install idempotency-kit
```

## Quick Start

```ts
import { IdempotencyLocal } from "idempotency-kit";

const idem = new IdempotencyLocal({ ttlMs: 30_000 });

const charge = await idem.run("charge:order-123", async () => {
  return { ok: true, chargeId: "ch_1" };
});
```

## API

```ts
new IdempotencyLocal(options?)
createIdempotencyLocal(options?)
```

### Main methods

| Method | Return | Description |
|---|---|---|
| `run(key, fn, options?)` | `Promise<T>` | Executes once per key and memoizes result by TTL. |
| `runWithMeta(key, fn, options?)` | `Promise<{ value: T; meta: RunMeta }>` | Same as `run`, with resolution metadata. |
| `delete(key)` | `boolean` | Deletes one cached result key. |
| `clear()` | `void` | Clears all cached results. |
| `prune()` | `number` | Removes expired entries and returns removed count. |
| `getStats()` | `IdempotencyStats` | Read runtime counters and sizes. |
| `dispose()` | `void` | Disposes internal cache resources. |
| `size` | `number` | Current result-cache size. |

### Constructor options

| Option | Type | Default | Description |
|---|---|---|---|
| `ttlMs` | `number` | `30000` | Success TTL in milliseconds. |
| `cacheFailures` | `boolean` | `false` | Cache failed results for dedup/retry behavior. |
| `failureTtlMs` | `number` | `ttlMs` | TTL for cached failures. |
| `maxSize` | `number` | `undefined` | Max result entries (LRU evicts old entries). |
| `cleanupIntervalMs` | `number \\| false` | `false` | Periodic cleanup interval. |
| `keyPrefix` | `string` | `""` | Prefix applied as `prefix:key`. |

### Per-run options

| Option | Type | Description |
|---|---|---|
| `ttlMs` | `number` | Override success TTL for this call. |
| `cacheFailures` | `boolean` | Override failure caching behavior for this call. |
| `failureTtlMs` | `number` | Override failure TTL for this call. |
| `signal` | `AbortSignal` | Cancel only this caller wait. |

### runWithMeta statuses

- `hit_completed`
- `hit_failed`
- `inflight_hit`
- `miss_executed`
- `miss_executed_failed`

## Behavior and semantics

`run(key, fn)` rules:

1. If completed result is valid, returns it (`hit_completed`).
2. If failed result is valid and `cacheFailures=true`, throws same error (`hit_failed`).
3. If key is in-flight, waits on the same promise (`inflight_hit`).
4. Otherwise executes `fn`:
   - success: caches completed result (`miss_executed`)
   - error: caches failed result only if enabled (`miss_executed_failed`)

Key normalization:

```ts
const finalKey = keyPrefix ? `${keyPrefix}:${key}` : key;
```

## Abort behavior

```ts
import { AbortError, IdempotencyLocal, isAbortError } from "idempotency-kit";

const idem = new IdempotencyLocal();
const controller = new AbortController();

const promise = idem.run("job:1", doWork, { signal: controller.signal });
controller.abort();

try {
  await promise;
} catch (error) {
  if (isAbortError(error)) {
    // this caller stopped waiting
  }
}
```

Aborting one caller does not cancel the shared loader for other callers.

## Errors

- `AbortError`: thrown when caller signal is aborted.
- `isAbortError(error)`: type-safe helper.

## Stats

`getStats()` returns:

- `runs`
- `hitsCompleted`
- `hitsFailed`
- `inflightHits`
- `missesExecuted`
- `missesExecutedFailed`
- `abortedWaits`
- `size`
- `inFlight`

## Benchmarks

Run:

```bash
npm run bench
```

Included scenarios:

- Miss path (`run` with unique key).
- Hit path (`run` with warm key).
- 100 concurrent calls same key (dedup).
- LRU pressure under `maxSize`.
- Expiration cleanup with `prune()`.

See `BENCHMARK.md` for details.

### Latest local run

Date: February 13, 2026  
Environment: Windows + Node `v22.19.0` + Vitest `3.2.4`

| Scenario | Throughput (hz) |
|---|---:|
| `run miss (new key each call)` | `672,647.73` |
| `run hit (same key)` | `707,083.15` |
| `inflight dedup (100 concurrent same key)` | `120.37` |
| `lru pressure (maxSize=1_000, 2_000 inserts)` | `544.62` |
| `prune expired (5_000 keys)` | `40.83` |

## Quality checks

```bash
npm run typecheck
npm test
npm run build
```

## Gotchas

- Cache is per process; no cross-instance guarantees.
- `undefined` return values are cached normally.
- Default `cacheFailures` is `false`.

## License

MIT (`LICENSE`)
