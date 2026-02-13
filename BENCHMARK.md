# BENCHMARK

This document describes how to run and interpret performance benchmarks for `@gustavoqnt/idempotency-local`.

## Scope

The benchmark suite focuses on:

- Hot path overhead (`run` miss and hit).
- Concurrency dedup behavior (`100` concurrent callers on same key).
- Capacity pressure (`maxSize` + LRU eviction).
- Cleanup pressure (`prune` over expired entries).

It is not a macro benchmark of your full backend stack.

## Environment (last recorded run)

- Date: February 13, 2026
- OS: Windows
- Node.js: `v22.19.0`
- Vitest: `3.2.4`
- Command: `npm run bench`

## Run

```bash
npm run bench
```

## Benchmark scenarios

1. `run miss (new key each call)`
- Each call uses a unique key.
- Measures baseline overhead for first execution + result write.

2. `run hit (same key)`
- Warms one key and repeatedly reads it.
- Measures fast-path hit overhead.

3. `inflight dedup (100 concurrent same key)`
- Starts `100` concurrent calls with same key.
- Measures dedup synchronization and shared promise behavior.

4. `lru pressure (maxSize=1_000, 2_000 inserts)`
- Inserts `2,000` keys with `maxSize=1,000`.
- Exercises eviction logic under pressure.

5. `prune expired (5_000 keys)`
- Populates `5,000` short-TTL entries.
- Waits for expiration, then runs `prune()`.

## Latest results

| Scenario | hz | mean ms/op | Notes |
|---|---:|---:|---|
| `run miss (new key each call)` | `672,647.73` | `0.0015` | Baseline write path |
| `run hit (same key)` | `707,083.15` | `0.0014` | Fastest path |
| `inflight dedup (100 concurrent same key)` | `120.37` | `8.3079` | End-to-end grouped workload |
| `lru pressure (maxSize=1_000, 2_000 inserts)` | `544.62` | `1.8361` | Includes evictions |
| `prune expired (5_000 keys)` | `40.83` | `24.4925` | Heavy cleanup sweep |

## How to compare runs

- Compare only runs on the same machine profile and Node version.
- Run benchmarks multiple times and watch trend, not one-off values.
- Use `hz` for throughput-sensitive comparisons.
- Use `mean`, `p99`, and `rme` for tail and stability.

## Interpreting this suite

- `run hit` should usually remain near or above `run miss`.
- `inflight dedup` is intentionally slower per benchmark iteration because each iteration performs `100` concurrent waits.
- `lru pressure` and `prune` numbers are stress-path indicators, not normal steady-state request latency.

## Reproducibility checklist

Before recording results:

1. Use the same Node major/minor version.
2. Close heavy background CPU tasks.
3. Run once as warm-up, then record the second run.
4. Save command output in PR description.

## Updating benchmark numbers

When updating numbers in `README.md` and this file:

1. Run `npm run bench`.
2. Copy `hz` values and environment metadata.
3. Update date and Node version.
4. Mention benchmark changes in `CHANGELOG.md`.
