# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.1.1] - 2026-02-13

### Changed

- Package name migrated from `@gustavoqnt/idempotency-local` to `idempotency-kit`.
- Updated npm metadata for discoverability:
  - expanded keywords
  - repository/homepage/bugs links
  - improved package description
- Updated README install/import examples to `idempotency-kit`.
- Added social-proof badges in README (npm version, downloads, CI, license).
- Added automated traffic dashboard workflow and persisted traffic history.

## [0.1.0] - 2026-02-13

### Added

- Initial release (originally published as `@gustavoqnt/idempotency-local`).
- Core idempotency API:
  - `run`
  - `runWithMeta`
  - `delete`
  - `clear`
  - `prune(): number`
  - `getStats`
  - `dispose`
  - `size` getter
- Local semantics:
  - In-flight dedup by key.
  - Result memoization by TTL.
  - Optional failure memoization with `cacheFailures` and `failureTtlMs`.
  - Key normalization with prefix separator (`prefix:key`).
- Abort support:
  - `AbortError`
  - `isAbortError`
  - Caller abort without canceling shared inflight execution.
- Test suite covering:
  - Basic hit/miss behavior
  - 100-way inflight dedup
  - Failure caching modes
  - TTL expiration
  - Abort behavior
  - LRU pressure
  - `prune` correctness
- Packaging and build:
  - ESM + CJS + DTS outputs via `tsup`.
- Documentation:
  - Full `README.md`
  - Benchmark documentation in `BENCHMARK.md`
- Benchmark suite via `npm run bench`.

[0.1.1]: https://www.npmjs.com/package/idempotency-kit
[0.1.0]: https://www.npmjs.com/package/idempotency-kit
