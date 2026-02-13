export interface IdempotencyLocalOptions {
  ttlMs?: number;
  cacheFailures?: boolean;
  failureTtlMs?: number;
  maxSize?: number;
  cleanupIntervalMs?: number | false;
  keyPrefix?: string;
}

export interface RunOptions {
  ttlMs?: number;
  cacheFailures?: boolean;
  failureTtlMs?: number;
  signal?: AbortSignal;
}

export type RunMetaStatus =
  | "hit_completed"
  | "hit_failed"
  | "inflight_hit"
  | "miss_executed"
  | "miss_executed_failed";

export interface RunMeta {
  key: string;
  status: RunMetaStatus;
}

export interface IdempotencyStats {
  runs: number;
  hitsCompleted: number;
  hitsFailed: number;
  inflightHits: number;
  missesExecuted: number;
  missesExecutedFailed: number;
  abortedWaits: number;
  size: number;
  inFlight: number;
}
