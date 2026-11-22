# rusi: reuse dependency analysis across runs

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/228 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | none (the small and medium tiers of `thirdparty/rusi/corpus.toml`, pinned by commit, with dependency sources pinned by each project's `Cargo.lock`) |

This plan depends on the per-pass measurements from D1 of [rusi-dependency-performance.md](rusi-dependency-performance.md). That plan makes a single run cheaper. This one avoids repeating work between runs.

## Why

rusi keeps nothing between runs. Every `rusi analyze --deps` parses, expands and lowers every file of every dependency crate again, although a crate downloaded from a registry at a given version never changes. On mini-redis at `3d93b42` with rusi 4.4.0 (cdxgen-plugins-bin `dcacc7ed`), the workspace alone takes 0.30 s and `--deps` takes 7.9 s, of which about 4 s is the module tree walk, the macro pre-pass and per-file analysis of 85 packages. In `--dataflow security-deps` mode, where dependency bodies are summarised too, the same project runs for minutes. The same dependency versions recur across runs on one project, across projects on one machine, and across CI jobs that restore a cache directory.

The [Rust Glancer post on persistent incrementality](https://rust-glancer.github.io/blog/persistent-incrementality-in-rust/) and its two projects show the techniques. rust-glancer writes each dependency package's index to disk under a fingerprint, reloads it when the fingerprint still matches, and treats any failure to read it as a miss that re-indexes the package from source. [Ajika](https://github.com/rust-glancer/ajika), the incremental query library it now uses, records what each query read, compares the version of each result after recomputing it, and leaves everything downstream alone when the version is unchanged ("early cutoff", the red-green idea from Salsa and rustc). Ajika's storage chapter adds the practical rules for a disposable cache: a format version in every entry, atomic checkpoints, a checksum per value, and retention limits by count, size and idle time.

## Scope

In scope: a per-package cache of the stable backend's per-file results for dependency crates; cache keys and storage; using the cache in `--deps` runs; a cache of dependency taint summaries for `security-deps` with early cutoff; keeping the compiler backend's per-crate output between runs; the threat model and documentation; letting cdxgen pass `--deps` and a cache directory to rusi.

Out of scope: caching workspace crates (they change between runs, and the workspace is the cheap part), adopting Ajika or another incremental query engine, a long-running rusi process, and any change to the report schema.

## Approach

### Why not adopt Ajika

rusi runs once per invocation; it does not serve a stream of edits as a language server does. Ajika is at 0.2 and says its APIs and cache format may change, it would add redb, wincode, zstd and lz4 to a binary that ships for many targets, and using it would mean restructuring `crates/rusi-core/src/lib.rs` (over 21,000 lines) into queries. The post itself warns that hand-written caches scattered through a codebase grow hard to maintain. This plan avoids that by having one cache boundary, the dependency package, behind one module with one API, and by borrowing Ajika's rules rather than its runtime.

### Cache unit and key

The unit is one dependency package at one analysis tier. Its value is what the stable backend computes for the package before the cross-package passes start: the module tree, the macro pre-pass output (the package's `macro_rules!` definitions and exports, which other packages' expansion reads) and the `AnalyzedFile` of every file. Import resolution, the call graph and data flow run after loading, as now.

The key is a SHA-256 over:

- the cache format version and the rusi version;
- the package name, version and source (`registry+...`, `git+...#rev`, or path);
- a hash of the package's source files, read in a stable order (reading and hashing is cheap next to parsing, and it means the key never trusts a registry directory to be untouched);
- the analysis tier (light, or with bodies), the enabled features and the cfg set rusi evaluates for the package, and the target triple;
- the keys of the package's own dependencies, so that a change in a dependency's exported macros changes every package that might expand them.

The last item makes the keys a Merkle tree over the dependency graph. A package whose key matches can be loaded without looking at anything else.

### Storage

Entries live under the existing per-user cache base (`rusi_cache_base()` in `crates/rusi-driver`, which honours `RUSI_CACHE_DIR` and `XDG_CACHE_HOME`), in a `packages/` directory created with owner-only permissions. Each entry is one file named by its key, written to a temporary name and renamed into place, with a header holding the format version, the payload length and a checksum. Any problem (missing file, wrong version, bad checksum, decode error) is a miss, logged under `--debug`, and the package is analysed from source. The cache never makes a run fail.

A sweep removes entries over a size limit, oldest first, and entries not read for a set time, on the same lines as Ajika's retention settings. `--no-cache` and `RUSI_NO_CACHE` turn the cache off, and `rusi cache stats` and `rusi cache prune` show and clean it.

### Determinism

Cold and warm runs must produce byte-identical reports. `AnalyzedFile` and the types inside it hold `HashMap`s (for example `field_types`), so the encoding sorts them or they become ordered maps. Every deliverable that touches the cache adds a test that runs the corpus cold, then warm, and compares the reports byte for byte.

### Early cutoff for taint summaries

In `security-deps` mode the expensive part is the interprocedural summary fixpoint over dependency functions. A dependency's summaries depend only on the packages it uses. They can be stored per package under a key built from the package key and a hash of the summaries of its dependencies, rather than of their sources. When a dependency changes but its summaries come out the same, every package above it keeps its stored summaries. That is the Ajika rule of comparing the version of a result rather than the version of its inputs.

## Deliverables

### D1. Serialisable per-package analysis results

Add serde derives to `AnalyzedFile`, the module tree, the macro pre-pass output and the types they contain, with ordered maps where order reaches the report. Choose the encoding by measurement on the medium tier: `serde_json` (already a dependency) with optional compression, against a compact binary encoding such as `postcard`. Prefer the fewest new dependencies that keep decode time well below parse time. Finished when a round trip of every corpus package's results is lossless and the encoding's size and decode time are recorded.

### D2. Package cache keys

Compute the key described above for every package in a `--deps` run, including the Merkle step over dependencies, the source file hash, the cfg and feature set and the tier. Finished when tests show that changing a source file, a feature, the tier, the target, the rusi version, or a dependency's exported macro changes the key, and that nothing else does.

### D3. Package cache store

Add the store under `packages/` with atomic writes, the entry header and checksum, owner-only permissions, the retention sweep, `--no-cache`, `RUSI_NO_CACHE`, and the `rusi cache stats` and `rusi cache prune` commands. Finished when tests cover a truncated entry, a wrong format version, a bad checksum, a read-only cache directory and two concurrent writers, and each of them ends in a correct report.

### D4. Use the cache in `--deps` runs

Look up each dependency package before the module tree walk. A hit loads the package's module tree, macro definitions and per-file results and skips the three parsing passes for it; a miss analyses the package and stores the result. Workspace packages are always analysed. Finished when cold and warm runs over the small and medium tiers produce byte-identical reports, the warm `--deps` run on mini-redis takes close to the workspace-only time plus the call graph, and `--debug` reports hits and misses.

### D5. Dependency taint summaries with early cutoff

Store the summaries computed for each dependency package in `security-deps` mode, keyed as described above, and reuse them in later runs. A summary is cached only if its evaluation read no edge that leaves the package's dependency closure: when the resolver over-approximates a trait call to every implementation, the candidates can include implementations in the workspace, and a summary that read such an edge depends on the workspace. The summary evaluation records whether it read such an edge, as Ajika's frames record each read, and those summaries are recomputed on every run. Finished when cold and warm `security-deps` runs over the small tier produce byte-identical reports and the warm run skips the stored packages' fixpoint.

### D6. Keep compiler backend output between runs

The compiler backend clears `target/rusi-embedded-build` at the start of every run so that Cargo invokes the wrapper for every crate. Keep the directory instead, and store the payload the wrapper emits for each crate under the crate's `-C metadata` hash, the wrapper's content hash and the data-flow mode. When Cargo finds a crate fresh and skips the wrapper, the driver takes that crate's stored payload. Finished when a second `--backend compiler` run on an unchanged project skips recompiling dependencies and produces a byte-identical report, and a change of data-flow mode or wrapper version forces the crates to be re-analysed.

### D7. Threat model and documentation

Add the cache to `thirdparty/rusi/THREAT_MODEL.md`: anyone who can write to the cache directory can change what rusi reports, which is the same trust as `~/.cargo`, and the checksum guards against corruption, not against that person. Document the cache directory, the flags, the retention settings and the use of a CI cache (for example `actions/cache` on `RUSI_CACHE_DIR` keyed by `Cargo.lock`) in the rusi README, and describe the cache in `docs/ANALYSIS_ARCHITECTURE.md`. Finished when the documents are merged with D4.

### D8. cdxgen: pass `--deps` and the cache directory to rusi

In `lib/ecosystems/rusi.js`, add an option that passes `--deps` to rusi, place the rusi cache under cdxgen's cache directory unless `RUSI_CACHE_DIR` is set, and pass `--no-cache` when cdxgen runs in secure mode or with `--no-cache`. Update `docs/ENV.md`, the evinse documentation and the repo tests. Finished when an evinse run on a Rust repository with the option produces dependency call edges and a second run is faster. This deliverable lives in cdxgen/cdxgen.

## Risks and open questions

**Hidden inputs.** If per-file analysis reads anything the key does not cover, a warm run silently reports stale results. The cold and warm comparison over the corpus is the main defence. D2 lists every input `analyze_file` reads, and a new input is added to the key in the same change that introduces it.

**Cross-package macro expansion.** Expansion of a package's code can use macros exported by its dependencies (`#[macro_use] extern crate`, `$crate` paths, re-exports). The Merkle key covers that, at the price that a change deep in the graph invalidates everything above it. For registry crates this almost never happens.

**Cache size.** Per-file results for large closures may be hundreds of megabytes. D1's measurement sets the default retention limits.

**D6 depends on Cargo's freshness rules.** Cargo must not reuse a crate's build output when the wrapper or the data-flow mode changes. If its fingerprint does not cover them, the driver has to clear the directory when they change.

## Outcome

Filled in when the work ends.
