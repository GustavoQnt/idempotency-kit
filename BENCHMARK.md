# BENCHMARK - idempotency-kit

This document records benchmark methodology and the latest measured results for `idempotency-kit`.

## What this benchmark answers

- How much request-level latency is reduced under retries, duplicate submits, and burst concurrency.
- How many upstream calls are avoided by deduplication + idempotency cache.
- Whether memory remains bounded during long-running mixed workloads.

## Benchmark artifacts

Generated logs from the latest run (February 15, 2026):

- `bench-latency-full.log`
- `bench-latency-quick-confirm.log`
- `stress-idempotency-10m.log`

## Environment of the latest run

- Date: February 15, 2026
- OS: Windows
- Node.js: `v22.19.0`
- Runner: `vitest 3.2.4` for stress tests, Node script for latency suite
- Hardware class: consumer workstation

## Commands

```bash
npm run test
npm run bench:latency:quick
npm run bench:latency

# Long stress run (10 minutes)
STRESS_DURATION_MS=600000 STRESS_TIMEOUT_MS=720000 STRESS_LOG_INTERVAL_MS=30000 npm run test:stress
```

## Realistic latency benchmark design

The latency suite compares three strategies under identical workload:

- `no-idempotency`
- `naive-inflight-lock`
- `idempotency-kit`

Scenarios:

- `miss`
- `hit`
- `inflight dedup burst`
- `failure cache hit`
- `mixed checkout workload`

Profiles:

- `loader=5ms`
- `loader=20ms`
- `loader=80ms`

Metrics per row:

- request count
- error count
- upstream `loaderCalls`
- `upstreamSaved` percent
- latency `avg`, `p50`, `p95`, `p99`
- throughput (ops/s)

## Latest full results (selected and decision-relevant)

### Mixed checkout workload (most production-representative)

| Profile | Strategy | Throughput | p50 | p95 | p99 | Upstream Saved | Loader Calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| 5ms | no-idempotency | 7443.04 ops/s | 13.10ms | 20.32ms | 24.27ms | 0.0% | 20000 |
| 5ms | naive-inflight-lock | 9316.52 ops/s | 10.64ms | 21.60ms | 27.43ms | 58.6% | 8286 |
| 5ms | idempotency-kit | 115294.11 ops/s | 0.00ms | 7.88ms | 18.16ms | 95.3% | 942 |
| 20ms | no-idempotency | 2966.98 ops/s | 31.75ms | 43.26ms | 50.22ms | 0.0% | 20000 |
| 20ms | naive-inflight-lock | 4050.77 ops/s | 27.13ms | 41.50ms | 50.25ms | 58.7% | 8261 |
| 20ms | idempotency-kit | 46036.28 ops/s | 0.00ms | 24.75ms | 39.71ms | 95.3% | 942 |
| 80ms | no-idempotency | 867.27 ops/s | 110.43ms | 133.70ms | 140.12ms | 0.0% | 20000 |
| 80ms | naive-inflight-lock | 1218.02 ops/s | 89.35ms | 129.09ms | 137.40ms | 59.3% | 8141 |
| 80ms | idempotency-kit | 13311.33 ops/s | 0.00ms | 92.19ms | 126.22ms | 95.2% | 952 |

### Hit-only scenario

| Profile | Strategy | Throughput | p50 | p95 | p99 | Upstream Saved |
|---|---:|---:|---:|---:|---:|---:|
| 5ms | no-idempotency | 9880.50 ops/s | 13.95ms | 19.50ms | 20.80ms | 0.0% |
| 5ms | naive-inflight-lock | 12623.04 ops/s | 9.96ms | 20.85ms | 25.37ms | 44.8% |
| 5ms | idempotency-kit | 280027.72 ops/s | 0.02ms | 0.30ms | 13.16ms | 99.6% |
| 20ms | no-idempotency | 4846.68 ops/s | 24.65ms | 35.37ms | 47.03ms | 0.0% |
| 20ms | naive-inflight-lock | 6182.72 ops/s | 22.79ms | 34.88ms | 38.31ms | 44.8% |
| 20ms | idempotency-kit | 122848.87 ops/s | 0.00ms | 1.47ms | 24.75ms | 98.9% |
| 80ms | no-idempotency | 1459.28 ops/s | 87.61ms | 94.78ms | 100.45ms | 0.0% |
| 80ms | naive-inflight-lock | 1869.73 ops/s | 84.29ms | 94.27ms | 106.16ms | 44.8% |
| 80ms | idempotency-kit | 34179.88 ops/s | 0.00ms | 1.50ms | 93.24ms | 98.5% |

## Important outlier note

In `bench-latency-full.log`, one row is invalid due to host noise:

- Scenario: `miss | loader=5ms | no-idempotency`
- Observed: `avg=2434.32ms`, `p99=226654.70ms`, `26.29 ops/s`

This is inconsistent with adjacent rows and with the confirmation run in `bench-latency-quick-confirm.log`:

- Same scenario in confirmation run: `avg=13.52ms`, `p99=21.20ms`, `3544.40 ops/s`

Decision: treat that specific full-run row as an outlier and exclude it from trend decisions.

## Long stress test (10 minutes)

Run:

```bash
STRESS_DURATION_MS=600000 STRESS_TIMEOUT_MS=720000 STRESS_LOG_INTERVAL_MS=30000 npm run test:stress
```

### Summary from `stress-idempotency-10m.log`

- Duration completed: `600000ms` (test passed)
- Last sampled counters at `t=570.3s`:
  - `runs=2352512`
  - `hitsCompleted=1893259`
  - `hitsFailed=37767`
  - `inflightHits=42375`
  - `missesExecuted=364149`
  - `missesExecutedFailed=14962`

Derived ratios:

- Request throughput: `4125.04 req/s`
- Upstream calls (`missesExecuted + missesExecutedFailed`): `379111` total, `664.76 calls/s`
- Upstream savings: `83.88%`
- `hit_completed` share: `80.48%`
- `hit_failed` share: `1.61%`
- `inflight_hit` share: `1.80%`
- `miss_executed` share: `15.48%`
- `miss_executed_failed` share: `0.64%`
- Failure rate among upstream executions: `3.95%`

### Memory and boundedness

Post-warmup window (`t >= 120s`):

- RSS range: `95.9MB` to `96.9MB`
- Heap range: `11.4MB` to `25.0MB`
- Cache size range: `678` to `1217`
- Configured `maxSize`: `5000`
- Peak heap growth after warmup: `7.9MB`

Conclusion:

- No unbounded growth pattern observed.
- Cache occupancy remained far below configured cap.
- In-flight map remained stable (`inFlight=0` at sampled checkpoints).

## Interpretation

- The dominant production benefit is upstream call reduction under retries and duplicate submits.
- `idempotency-kit` consistently achieves around `95%` upstream savings in mixed workloads.
- Tail (`p95/p99`) still reflects the fraction of true misses, which is expected.
- Compared with naive in-flight locking, result-cache replay is the major multiplier.

## Reproducibility and release guidance

- Always record at least 3 full latency runs and compare medians.
- Keep Node version fixed across baseline and candidate runs.
- Treat any single-row extreme deviation as suspect until rechecked with a confirmation run.
- Use stress logs as guardrails for memory boundedness and counter progression.

## Stress tunables

- `STRESS_DURATION_MS` default: `300000`
- `STRESS_TIMEOUT_MS` default: `duration + 30000`
- `STRESS_LOG_INTERVAL_MS` default: `15000`
- `STRESS_CONCURRENCY` default: `64`
- `STRESS_BATCH_SIZE` default: `128`