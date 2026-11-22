# rusi: faster, smaller analysis of dependency crates

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/EPIC |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | none (the small and medium tiers of `thirdparty/rusi/corpus.toml`, pinned by commit, with dependency sources pinned by each project's `Cargo.lock`) |

The plan for reusing dependency analysis across runs is [rusi-dependency-cache.md](rusi-dependency-cache.md). It builds on the measurements this plan adds.

## Why

`rusi analyze --deps` analyses every resolved dependency crate as well as the workspace, so that a call into a dependency resolves to a real node instead of an external one. Dependencies are analysed at a lighter tier (library target only, no function bodies) unless `--dataflow security-deps` is given. Even so, the dependency closure is usually far larger than the workspace, and the cost shows. On mini-redis at `3d93b42` (85 packages, 2,302 source files) with rusi 4.4.0 at cdxgen-plugins-bin `dcacc7ed`, on an Apple silicon laptop:

| Command | Time | Peak RSS |
| --- | --- | --- |
| `analyze` | 0.30 s | 54 MB |
| `analyze --deps` | 7.9 s | 1,177 MB |
| `analyze --deps --callgraph none --dataflow none` | 5.0 s | 1,048 MB |

The rusi 4.3.1 binary measured a day earlier peaked at 642 MB on the same command. The 4.4.0 release added `macro_rules!` expansion, which is the likely cause of the growth, but that has not been confirmed.

The `--debug` pass markers split the 7.9 s run as follows:

| Pass | Time |
| --- | --- |
| Workspace discovery (module trees) | 0.46 s |
| Macro pre-pass | 1.43 s |
| Per-file analysis | 2.09 s |
| Import resolution | 0.20 s |
| Call graph | 2.38 s |
| Data flow, report normalisation, canonical names, stats | 0.36 s |

Three things stand out. Every source file is read and parsed with `syn` three times: by the module tree walk (`crates/rusi-core/src/module_tree.rs`), by the macro pre-pass (`crates/rusi-core/src/macro_expand/scope.rs`) and by per-file analysis (`analyze_file` in `crates/rusi-core/src/lib.rs`). Memory stays above 1 GB with the call graph and data flow turned off, so it is held by the per-file results and the macro table rather than by the later passes. And `--dataflow security-deps`, which also analyses dependency function bodies, runs for minutes on the same project (see the risks section for the measured figure).

cdxgen does not pass `--deps` to rusi today (`lib/ecosystems/rusi.js`), partly because of this cost. The evidence it would add, dependency call edges and taint that flows through a dependency, is exactly what cdxgen's evinse needs for reachability.

Two projects described in the [Rust Glancer post on persistent incrementality](https://rust-glancer.github.io/blog/persistent-incrementality-in-rust/) informed this plan. rust-glancer, a Rust language server built for low memory, skips dependency bodies by default (as rusi already does), orders its allocations by phase so that freeing one phase returns a contiguous block, and shrinks containers when a phase is finished. Its [memory notes](https://github.com/rust-glancer/rust-glancer/blob/main/docs/src/development/MEMORY.md) record the effect of each step. The post also describes evaluating function bodies only when a query needs them, which is the idea behind D5.

## Scope

In scope: per-pass timing and memory measurement, removing the repeated parses, the call graph's cost, peak memory in the stable backend, and analysing dependency bodies on demand in `security-deps` mode.

Out of scope: persisting results between runs (the cache plan), the compiler backend's own cost, changes to analysis precision or to the report schema, and cdxgen changes.

## Approach

Measure first, then change one pass at a time, and keep the output byte for byte the same. rusi promises a deterministic report, and every deliverable here is an optimisation, so the gate for each is that the corpus reports are identical before and after the change. Where a change can only alter ordering, the comparison is on the normalised report and the change says why.

A target for each pass is set from D1's numbers, not before. Earlier work on cdxgen showed that a guess at where time goes is often wrong: the 15x fetch speed-up came from concurrency, not from moving code to Rust, and parallelising BOM generation delivered almost nothing.

## Deliverables

### D1. Per-pass timing and memory report

Add a `--profile-passes` option (or extend `--debug`) that prints, for each pass, its wall time, the elapsed time and the peak RSS so far, as one JSON line per pass on stderr. Add a script under `scripts/eval/` that runs `--deps`, `--deps --callgraph none --dataflow none` and `--deps --dataflow security-deps` over the small and medium corpus tiers and writes a table. Record the baseline for rusi 4.4.0 in the epic. Finished when the script runs on Linux and macOS and the baseline is posted.

### D2. Read and parse each source file once per phase

Fold the module tree walk and the macro pre-pass into one parse that extracts `mod` declarations, `use` items and `macro_rules!` definitions together, and read each file's text once. Holding every parsed tree in memory for the later analysis pass would trade time for memory, so the analysis pass keeps its own parse unless D1 shows that holding the trees costs little. Finished when each file is parsed at most twice, the corpus reports are unchanged, and D1 shows the saving.

### D3. Call graph cost

Profile `build_call_graph` on the medium tier with `--deps`. The likely costs are string-keyed indexes (`build_local_function_index` maps names to vectors of string ids) and the fan-out of ambiguous call sites. Intern function ids and canonical names to integer handles where the profile points, keeping the string form only at report time. Finished when the call graph pass is at least as fast as D1's target and the reports are unchanged.

### D4. Peak memory in the stable backend

Use D1 to find which structures hold the 1 GB. Confirm or rule out macro expansion as the cause of the growth from 4.3.1 to 4.4.0 (the expansion cache, token streams kept in the macro table, or expanded items kept beside the hand-written ones). Then apply the rust-glancer measures that fit: drop each pass's inputs as soon as the next pass has what it needs, finish a phase for all files before starting the next, and shrink long-lived maps and vectors when a phase completes. Evaluate mimalloc only after that, and only if it builds for every target in `thirdparty/rusi/Makefile` (including musl, riscv64 and Windows on ARM) without a large size cost to the `opt-level = "z"` binary. Finished when peak RSS on mini-redis `--deps` is at or below the 4.3.1 figure of 642 MB, or the epic records why that is not reachable.

### D5. Dependency bodies on demand in `security-deps` mode

Today `security-deps` lowers and summarises every function body in every dependency. Most are never reached from the workspace. Split dependency analysis into an item stage, which runs for every package as the light tier does now, and a body stage, which runs only for dependency functions reachable from the workspace call graph. Reachability is computed over the item-level graph, bodies are lowered for the reachable set, the new edges they add extend the set, and the loop repeats until it adds nothing. The summary fixpoint then runs over the reachable functions only. Finished when `security-deps` on the small tier produces the same slices as before for workspace sources and sinks, runs in a fraction of the D1 baseline, and the architecture document describes the stage split.

## Risks and open questions

**The `security-deps` baseline.** The run on mini-redis was still going after 280 s with rusi 4.3.1. The 4.4.0 figure will be added to the epic from D1. If D5 cannot bring it within a few times the light-tier run, cdxgen should keep `security-deps` out of its default profiles.

**D5 and over-approximated edges.** When the resolver cannot pin a trait call to one implementation, it emits an edge to every candidate. Reachability over those edges may pull in most of a large dependency. D1's data for the medium tier will show whether the reachable set is small enough to matter. If it is not, D5 should cap fan-out for dependency-internal calls the way `--max-call-candidates` caps it for the workspace.

**Output identity.** A change that alters iteration order (for example a `HashMap` that becomes a `Vec` of interned ids) can reorder report arrays. Each deliverable keeps the report identical, or documents the reordering and updates the expected outputs in the same pull request.

## Outcome

Filled in when the work ends.
