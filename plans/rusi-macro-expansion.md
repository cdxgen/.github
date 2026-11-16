# rusi: evidence through declarative macros in the stable backend

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/199 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | none (fixtures under `thirdparty/rusi/fixtures`, the small tier of `thirdparty/rusi/corpus.toml`) |

The compiler-backend half of this work is [rusi-compiler-macro-attribution.md](rusi-compiler-macro-attribution.md).

## Why

Rust code uses `macro_rules!` to generate types, trait impls and whole functions, and dependency crates such as `log`, `tracing` and `anyhow` are used almost entirely through macros. rusi's stable backend does not expand macros. It parses a macro's arguments as Rust where it can (which is how calls inside `println!` or `vec![]` are seen), skips `macro_rules!` bodies, and reports the rest as a `macro` diagnostic. A probe crate built from common macro patterns, scoping rules and use cases (described in a [2026-11-10 article on declarative macros](https://sigseis.dev/articles/2026/11/10)), was run through rusi at cdxgen-plugins-bin `c25bb43f` with both backends:

- **Generated items are invisible.** A workspace macro that generates a struct and its methods produced no declarations. A call to a generated method resolved to an external node, and an environment variable to `Command::arg` flow inside the generated method produced no slice. The compiler backend found all of them.
- **Dependency macro calls leave no evidence.** `serde_json::json!`, `bail!` (imported from `anyhow`) and `info!` (imported from `log`) produced no usage and no call-graph edge. A crate used only through a legacy `#[macro_use] extern crate` left not even an import, so cdxgen's evinse could not see that the crate is used.
- **Misleading diagnostics.** `pub(crate) use child::*;`, where `child` is a module declared one line above, was reported as a glob "outside this workspace". This is the usual layout for crate-local macros (a `macros/mod.rs` that re-exports one file per macro).
- **Macro definitions are not declarations.** A `#[macro_export]` macro is public API at the crate root, but it did not appear in `declarations`.

## Scope

In scope: expanding `macro_rules!` macros defined in the analysed workspace, in the stable backend; macro definitions as declarations; usages and call-graph edges for invocations of dependency macros; an `expanded_from` field on evidence produced by an expansion; the child-module import fix.

Out of scope: expanding dependency macros (their source is only read with `--deps`), procedural macros, `macro` 2.0 items, and changes to cdxgen. The compiler backend is the other plan.

## Approach

### Definitions and scoping

A pre-pass over the analysed files collects every `macro_rules!` definition with its name, defining module, file, line and column, and the way it is in scope, following the Rust Reference chapter [Macros By Example](https://doc.rust-lang.org/reference/macros-by-example.html):

- textual scope: visible after its definition in the same module and in child modules declared later, and only inside the block it was defined in; a later definition with the same name shadows an earlier one from its position on;
- `#[macro_use] mod m;` hoists the module's textual macros into the parent after the `mod` item, and a chain of `#[macro_use]` modules hoists through every level;
- path-based scope: `pub(crate) use name;` (any visibility) makes the macro an item at that module path, reachable through `use` and full paths, including `self::`, `super::` and `crate::`;
- `#[macro_export]` places the macro at the crate root whatever module defines it, and `$crate::path::name!` resolves to it;
- `#[macro_use] extern crate c;` brings in `c`'s exported macros, which are expanded when `c` is a workspace crate and attributed to `c` otherwise.

Each definition becomes a declaration with `kind: "macro"`. Its `qualified_name` is the crate root path for exported macros and the defining module plus the name otherwise; this path is also what `expanded_from.macro` names.

### Matching and transcription

An invocation that resolves to a workspace definition is matched against its rules in order, and the first match is transcribed. The matcher supports every fragment specifier rustc does, with rustc's edition behaviour for `pat` and `expr`, multi-token separators (`::`, `=>`, `->`), nested repetitions, and repetitions that match zero times inside an outer repetition. `$crate` becomes `crate`, or the defining crate's name when the invocation is in another workspace crate.

Expansion is bounded, and each bound has its own `macro` diagnostic naming the macro: a nesting depth, a token budget covering everything one hand-written invocation produces (nested and sibling expansions together), a repetition iteration cap, and a step budget for the matcher's backtracking. rusi analyses untrusted source, so no input that compiles may crash it or keep it running past these bounds.

The result is parsed for the invocation's position (items, statements or an expression) and walked by the existing collector, so declarations, usages, call-graph edges and data flow come out as if the code had been written by hand.

### Hygiene

rustc keeps local variables introduced by a transcriber apart from the caller's (mixed-site hygiene). The expander renames a binding written literally in the transcriber, and its later uses, so that it cannot alias a caller variable of the same name in the data-flow model. Only binding positions and the uses that refer to them are renamed: never a name after `::` or `.`, a type, a field, a struct-literal key, a macro name or an item name. The internal suffix never appears in report output.

### Positions and identity

Transcribed tokens have no real source positions. Everything an expansion produces is positioned at the invocation site, and carries:

```json
"expanded_from": { "macro": "my_crate::macros::make_units", "file_path": "src/macros/make_units.rs", "line": 4 }
```

on declarations, usages, security signals, call-graph edges and data-flow nodes. Evidence ids and closure names inside an expansion include the invocation site and a per-file expansion sequence number, so two invocations of one macro never share an id or merge two closures into one node. Ids of evidence that is not from an expansion do not change.

### Dependency macro calls

A bang-macro invocation that resolves to a dependency crate becomes a `LibraryUsage` with `kind: "macro-call"` and `name` set to the resolved path with a trailing `!`, and a call-graph edge with `call_type: "macro"` and `targetPurl` set to the crate's purl. cdxgen's Rust evidence reader (`lib/ecosystems/rusi.js`, `addCallGraphEvidence`) already reads `targetPurl`, so the crate is attributed without a cdxgen change. A bare name that more than one `#[macro_use] extern crate` could supply is not guessed: the usage lists `properties.candidates` and carries no purl. Standard-library macros are not recorded. The values inside `serde_json::json!` bodies are walked so a tainted value keeps its flow.

## Deliverables

### D1. Macro definitions, scoping and declarations

The pre-pass, the scope table and the `kind: "macro"` declarations, following the scoping rules above, including shadowing by source position, a definition and an invocation on one line, block-local definitions, multi-level `#[macro_use]` hoisting, `$crate` paths of any length and workspace crates imported with `#[macro_use] extern crate`. Done when a test exists for each rule and the probe's two macros are declared.

### D2. Matcher and transcriber with bounds

Matching and transcription as described, with the four bounds and their diagnostics. Done when the matcher has unit tests for each fragment specifier (including `literal` with `-1` and `true`, `tt` with joint punctuation and lifetimes, `pat` with top-level or-patterns, `stmt` before a `;` separator, `vis` matching nothing), for multi-token separators, for an optional or starred repetition that matches zero times inside an outer repetition, for `$name: Type` in a transcriber, and for matchers delimited by `[]` and `{}`; when an exponential matcher (`$($($t:tt)+)+ !` on 40 tokens) and a polynomial one (`$($a:tt)* $($b:tt)* $($c:tt)* !` on 400 tokens) both finish in under a second with a diagnostic; and when no input that compiles makes the module panic.

### D3. Hygiene for transcriber bindings

The renaming rule above. Done when tests cover `let`, `let mut`, `let ref`, tuple and struct patterns, `if let`, `while let`, `for`, closure parameters, `match` arms and inline format arguments as bindings, and `Some`, `dep::parse`, a field, a struct-literal key, a macro name and a function name as names that are not renamed, and when no renamed name appears in any report.

### D4. Expansion evidence and identity

`expanded_from` on the five evidence kinds, invocation-site positions, and ids and closure names that stay distinct across invocations. Done when a macro that generates a closure, an `unsafe` block and a secret-named binding, invoked twice, yields two closure nodes, no cross edges between the invocations, and unique ids for every usage, signal and crypto record.

### D5. Dependency macro calls

`macro-call` usages, `macro` edges with `targetPurl`, the ambiguity rule, the standard-library list (including `dbg!` and `is_x86_feature_detected!`) and `json!` values. Done when the fixture's `json!`, imported `bail!`, imported and aliased `log` macros and a `#[macro_use] extern crate` case produce the right target purls, and an ambiguous case records candidates.

### D6. Child-module imports

Resolve `use child::*;` and `pub(crate) use child::name;` against modules declared in the importing module before reporting them as outside the workspace. Done when the `macros/mod.rs` layout reports no `import-resolution` diagnostic.

### D7. Fixture, corpus and documentation

A `macro-zoo-app` fixture covering every case above with at least one source to sink flow through a generated item; the small corpus tier run before and after with every count change explained and the goldens updated; `JSON_ATTRIBUTE_REFERENCE.md`, `docs/ANALYSIS_ARCHITECTURE.md` and `docs/RUSI.md` updated. Done when `make fmt-check lint test` passes in `thirdparty/rusi` and no corpus project gains a `macro` diagnostic.

## Risks and open questions

- Emulating `macro_rules!` without rustc will always differ in corner cases. The rule is that rusi may accept more than rustc but must never crash, hang or invent flows; every remaining difference is listed in the documentation.
- Expanding large internal macros adds declarations and edges to the report (in the `log` crate, about 90 generated methods). Report size on large workspaces should be checked on the medium corpus tier before release.

## Outcome

To be filled in when the work ends.
