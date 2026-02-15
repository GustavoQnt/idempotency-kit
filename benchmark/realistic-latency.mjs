import { IdempotencyLocal } from "../dist/index.js";
import { performance } from "node:perf_hooks";

const QUICK = process.argv.includes("--quick");

const PROFILES = QUICK ? [5, 20] : [5, 20, 80];

const CONFIG = QUICK
  ? {
      missRequests: 1_200,
      missConcurrency: 48,
      hitWarmKeys: 80,
      hitRequests: 3_200,
      hitConcurrency: 96,
      inflightBursts: 20,
      inflightFanout: 60,
      failureFanout: 60,
      mixedRequests: 4_000,
      mixedConcurrency: 64,
    }
  : {
      missRequests: 6_000,
      missConcurrency: 64,
      hitWarmKeys: 200,
      hitRequests: 12_000,
      hitConcurrency: 128,
      inflightBursts: 60,
      inflightFanout: 120,
      failureFanout: 120,
      mixedRequests: 20_000,
      mixedConcurrency: 96,
    };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`;
}

function formatThroughput(requests, elapsedMs) {
  return ((requests / elapsedMs) * 1000).toFixed(2);
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function createNoIdempotencyStrategy() {
  return {
    name: "no-idempotency",
    async run(_key, loader) {
      return loader();
    },
  };
}

function createNaiveInflightLockStrategy() {
  const inFlight = new Map();
  return {
    name: "naive-inflight-lock",
    async run(key, loader) {
      const cached = inFlight.get(key);
      if (cached) return cached;
      const promise = (async () => loader())();
      inFlight.set(key, promise);
      try {
        return await promise;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

function createIdempotencyKitStrategy() {
  const idem = new IdempotencyLocal({
    ttlMs: 2_000,
    maxSize: 100_000,
    cacheFailures: true,
    failureTtlMs: 600,
  });

  return {
    name: "idempotency-kit",
    async run(key, loader) {
      return idem.run(key, loader);
    },
  };
}

const STRATEGY_FACTORIES = [
  createNoIdempotencyStrategy,
  createNaiveInflightLockStrategy,
  createIdempotencyKitStrategy,
];

function createLoaderTracker() {
  let loaderCalls = 0;
  return {
    count() {
      return loaderCalls;
    },
    async execute(op) {
      loaderCalls += 1;
      await sleep(op.delayMs);
      if (op.shouldFail) throw new Error(op.errorMessage ?? "upstream-failure");
      return op.value ?? op.key;
    },
    reset() {
      loaderCalls = 0;
    },
  };
}

async function runMeasured({ requests, concurrency, strategy, loaderTracker }) {
  const latencies = [];
  let errors = 0;

  const t0 = performance.now();
  await runPool(requests, concurrency, async (op) => {
    const reqStart = performance.now();
    try {
      await strategy.run(op.key, () => loaderTracker.execute(op));
    } catch {
      errors += 1;
    } finally {
      latencies.push(performance.now() - reqStart);
    }
  });
  const elapsedMs = performance.now() - t0;

  const requestCount = requests.length;
  const loaderCalls = loaderTracker.count();

  return {
    requestCount,
    errors,
    loaderCalls,
    elapsedMs,
    avgMs: mean(latencies),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    throughputOps: Number(formatThroughput(requestCount, elapsedMs)),
    upstreamSavedPct: ((1 - loaderCalls / requestCount) * 100).toFixed(1),
  };
}

function buildMissRequests(baseDelayMs, requestCount) {
  return Array.from({ length: requestCount }, (_, i) => ({
    key: `miss:${i}`,
    delayMs: baseDelayMs,
    shouldFail: false,
  }));
}

function buildHitRequests(baseDelayMs, requestCount, warmKeys, seed) {
  const rng = createRng(seed);
  const keys = Array.from({ length: warmKeys }, (_, i) => `hit:${i}`);
  const requests = [];
  for (let i = 0; i < requestCount; i++) {
    const key = keys[Math.floor(rng() * keys.length)];
    requests.push({ key, delayMs: baseDelayMs, shouldFail: false });
  }
  return { keys, requests };
}

function buildInflightRequests(baseDelayMs, bursts, fanout) {
  const requests = [];
  for (let b = 0; b < bursts; b++) {
    const key = `burst:${b}`;
    for (let i = 0; i < fanout; i++) {
      requests.push({ key, delayMs: baseDelayMs, shouldFail: false });
    }
  }
  return requests;
}

function buildFailureRequests(baseDelayMs, fanout) {
  const requests = [];
  for (let i = 0; i < fanout * 2; i++) {
    requests.push({
      key: "fail:checkout",
      delayMs: baseDelayMs,
      shouldFail: true,
      errorMessage: "gateway-temporary-error",
    });
  }
  return requests;
}

function buildMixedRequests(baseDelayMs, requestCount, seed) {
  const rng = createRng(seed);
  const hotKeys = Array.from({ length: 24 }, (_, i) => `order:hot:${i}`);
  const warmKeys = Array.from({ length: 120 }, (_, i) => `order:warm:${i}`);
  const failingKeys = Array.from({ length: 10 }, (_, i) => `order:fail:${i}`);
  const recent = [];
  let uniqueId = 0;

  const requests = [];
  for (let i = 0; i < requestCount; i++) {
    const roll = rng();
    let key;

    if (roll < 0.55) key = hotKeys[Math.floor(rng() * hotKeys.length)];
    else if (roll < 0.8) key = warmKeys[Math.floor(rng() * warmKeys.length)];
    else if (roll < 0.95 && recent.length > 0) key = recent[Math.floor(rng() * recent.length)];
    else if (roll < 0.99) {
      key = `order:new:${uniqueId}`;
      uniqueId += 1;
    } else key = failingKeys[Math.floor(rng() * failingKeys.length)];

    recent.push(key);
    if (recent.length > 400) recent.shift();

    const jitter = Math.floor(rng() * Math.max(1, Math.ceil(baseDelayMs * 0.6)));
    const shouldFail = key.startsWith("order:fail:");

    requests.push({
      key,
      delayMs: baseDelayMs + jitter,
      shouldFail,
      errorMessage: shouldFail ? "gateway-5xx" : undefined,
    });
  }

  return requests;
}

function printHeader() {
  console.log("\n=== idempotency-kit realistic latency benchmark ===");
  console.log(`Node: ${process.version}`);
  console.log(`Mode: ${QUICK ? "quick" : "full"}`);
  console.log(`Profiles (upstream latency base): ${PROFILES.map((x) => `${x}ms`).join(", ")}`);
}

function printScenarioHeader(scenarioName, profileMs) {
  console.log(`\n--- ${scenarioName} | loader=${profileMs}ms ---`);
  console.log(
    "strategy                reqs   errors  loaderCalls  upstreamSaved  avg      p50      p95      p99      throughput",
  );
}

function printResultRow(name, result) {
  const row = [
    name.padEnd(22),
    String(result.requestCount).padStart(6),
    String(result.errors).padStart(7),
    String(result.loaderCalls).padStart(11),
    `${result.upstreamSavedPct}%`.padStart(13),
    formatMs(result.avgMs).padStart(8),
    formatMs(result.p50Ms).padStart(8),
    formatMs(result.p95Ms).padStart(8),
    formatMs(result.p99Ms).padStart(8),
    `${result.throughputOps.toFixed(2)} ops/s`.padStart(14),
  ];
  console.log(row.join("  "));
}

async function runScenario(profileMs, scenarioName, scenarioBuilder) {
  printScenarioHeader(scenarioName, profileMs);

  for (const createStrategy of STRATEGY_FACTORIES) {
    const strategy = createStrategy();
    const loaderTracker = createLoaderTracker();

    if (scenarioBuilder.warmup) {
      await scenarioBuilder.warmup({ strategy, loaderTracker });
      loaderTracker.reset();
    }

    const result = await runMeasured({
      requests: scenarioBuilder.requests,
      concurrency: scenarioBuilder.concurrency,
      strategy,
      loaderTracker,
    });

    printResultRow(strategy.name, result);
  }
}

async function main() {
  printHeader();

  for (const profileMs of PROFILES) {
    await runScenario(profileMs, "miss", {
      requests: buildMissRequests(profileMs, CONFIG.missRequests),
      concurrency: CONFIG.missConcurrency,
    });

    const hit = buildHitRequests(profileMs, CONFIG.hitRequests, CONFIG.hitWarmKeys, 11_019);
    await runScenario(profileMs, "hit", {
      requests: hit.requests,
      concurrency: CONFIG.hitConcurrency,
      warmup: async ({ strategy, loaderTracker }) => {
        for (const key of hit.keys) {
          await strategy.run(key, () => loaderTracker.execute({ key, delayMs: profileMs, shouldFail: false }));
        }
      },
    });

    await runScenario(profileMs, "inflight dedup burst", {
      requests: buildInflightRequests(profileMs, CONFIG.inflightBursts, CONFIG.inflightFanout),
      concurrency: CONFIG.inflightFanout,
    });

    await runScenario(profileMs, "failure cache hit", {
      requests: buildFailureRequests(profileMs, CONFIG.failureFanout),
      concurrency: CONFIG.failureFanout,
    });

    await runScenario(profileMs, "mixed checkout workload", {
      requests: buildMixedRequests(profileMs, CONFIG.mixedRequests, 42_4242),
      concurrency: CONFIG.mixedConcurrency,
    });
  }

  console.log("\nDone.\n");
}

await main();
