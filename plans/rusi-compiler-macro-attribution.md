# rusi: attributing macro-expanded evidence in the compiler backend

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/207 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | none (fixtures under `thirdparty/rusi/fixtures`, the small tier of `thirdparty/rusi/corpus.toml`) |

Follows [rusi-macro-expansion.md](rusi-macro-expansion.md), which defines the `expanded_from` field, the `macro-call` usage and the `macro` call type that this plan reuses.

## Why

rusi's compiler backend (`rusi-rustc-wrapper`) reads MIR after macro expansion, so it sees code that macros generate. It does not say where that code came from. The probe crate described in the stable-backend plan showed four problems:

- **Signals inside a dependency's expansion.** An `unsafe-code` signal, "compiler-generated unsafe block detected", was reported at a `log::info!` call. The unsafe block is in `log`'s expansion, not in the user's code. The signal comes from `UnsafeSource::CompilerGenerated` in `rusi-rustc-wrapper/src/main.rs`.
- **Generated code reported only at the call site.** `span_site` maps every span through `source_callsite()`, so a process-exec sink inside a workspace macro is reported at the invocation and the macro's own file never appears.
- **Hidden helper names.** Usages appear as `log::__private_api::log` and `anyhow::__private::format_err`, with nothing linking them to `log::info!` or `anyhow::bail!`. The `__private` re-export module is the usual way an exported macro reaches its crate's internals, so these names are common.
- **Stale diagnostics.** In compiler mode, the stable backend's "bodies were not analyzed" `macro` diagnostics are still emitted for macros the compiler expanded.

## Scope

In scope: the compiler backend's handling of spans from macro expansions, for signals, declarations, usages, call-graph edges and data-flow nodes, and how compiler-mode output merges stable diagnostics. Out of scope: the stable backend, procedural-macro specific handling beyond what span expansion data gives, and cdxgen changes.

## Approach

rustc records, for every span produced by an expansion, the expansion's kind, the macro's definition id and the call site ([`ExpnData`](https://doc.rust-lang.org/nightly/nightly-rustc/rustc_span/hygiene/struct.ExpnData.html), reached through `span.ctxt().outer_expn_data()` and `span.macro_backtrace()`). The wrapper already decides whether a crate is local. With these two facts:

- A signal whose span comes from an expansion of a macro defined outside the workspace is not emitted. One inside a workspace macro's expansion is kept and carries `expanded_from`.
- `expanded_from` is filled from the outermost workspace macro in the backtrace. `file_path` and `line` point at the transcriber span when it is local, otherwise at the definition. `position` and the evidence key in `SpanSite` stay at the call site, so evidence ids do not change.
- A usage or edge from a dependency's bang-macro expansion gets `properties.via_macro` with the macro's path (from `tcx.def_path_str` of the expansion's `macro_def_id`), and each such invocation also gets the `macro-call` usage and `macro` edge the stable backend emits, once per call site, so both backends report the same macro-level evidence.
- A stable `macro` diagnostic is dropped for a file the compiler backend analysed and kept for files it did not.

## Deliverables

### D1. No signals from dependency expansions

Done when the probe's `info!` unsafe signal is gone and an `unsafe` block written inside a workspace macro's transcriber is still reported with `expanded_from`.

### D2. `expanded_from` in compiler mode

Done when a declaration and the data-flow nodes of a slice inside a workspace macro carry `expanded_from` naming the macro, and evidence ids for the fixtures are unchanged.

### D3. `via_macro` and macro-call parity

Done when the `log` and `anyhow` helper usages carry `via_macro`, and the set of `macro-call` usages (name and line) on the `macro-zoo-app` fixture is the same in both backends, with any difference that cannot be removed listed in the documentation.

### D4. Diagnostics in compiler mode

Done when compiler mode reports no stable "not analyzed" diagnostic for files the compiler analysed, still reports it for a crate the compiler run failed on, and the compiler-backend tests (`RUSTC_BOOTSTRAP=1 cargo test -- --ignored --test-threads=1`) and the small corpus tier with `--backend compiler` pass with every change explained.

## Risks and open questions

- rustc's span and hygiene APIs change between nightlies. Any API whose shape differs between the supported toolchains goes through the existing `build.rs` probes.

## Outcome

To be filled in when the work ends.
