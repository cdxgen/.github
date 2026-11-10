# Memory-safety findings for rusi, golem and kosi

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/NUMBER |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | `plugins-memory-safety.corpus.json`, added with D1 once the first items are stored |

## Why

Rust, Go and Kotlin are chosen because they are memory-safe, and that promise holds only as far as the code that opts out of it. Rust has `unsafe`, Go has `unsafe.Pointer`, cgo and data races on multi-word values, and the JVM has JNI, `sun.misc.Unsafe`, the restricted methods of the Foreign Function and Memory API, JNA and Kotlin/Native's `cinterop`. The bugs live where that code trusts something it does not control. The FORGE team's review of the Rust standard library ([Rust std memory safety](https://forge-blog.github.io/posts/rust-std-memory-safety/)) groups the bugs it found into three kinds of misplaced trust: trusting code not to panic while an invariant is broken, trusting a safe trait implementation to be consistent, and trusting process-wide state such as `environ` or the main thread's signal stack. Rudra ([SOSP 2021](https://dl.acm.org/doi/10.1145/3477132.3483570)) found 264 bugs of the first two kinds in crates.io with simple static rules.

cdxgen's three source analyzers in cdxgen-plugins-bin already see most of what such rules need. rusi's compiler backend walks MIR with unwind edges and resolves trait calls through monomorphisation, golem works on Go SSA with a taint engine, and kosi resolves Kotlin and Java calls against a classpath. Today they report that unsafe code exists (rusi's `unsafe-code` and `native-interop` signals) and nothing about whether it is used correctly. cdxgen copies only a category and a severity into the BOM.

atom's `memory-safety` command (AppThreat/atom, with the passes in AppThreat/chen) is the working model for C and C++. Fact passes write facts onto graph nodes, one rule pass turns facts into findings with a rule ID, CWE, severity, confidence and an evidence trace, and the command prints JSON or SARIF. Its precision comes from a corpus with ground truth on every line and a negative control beside every positive case, and that corpus is what this plan copies most closely.

## Scope

In scope: a memory-safety mode in rusi, golem and kosi; one finding contract and SARIF layout shared by the three; one corpus and scorer per language with the same marker grammar and gates; the cdxgen mapping of findings into BOM properties, audit rules, documentation and `cdxi` commands.

Out of scope: dynamic analysis (Miri, the race detector, sanitizers), aliasing models such as Stacked Borrows, rewriting code, and C or C++ code linked into these projects, which atom already covers. Kotlin and Java data races are out because the JVM keeps them memory-safe.

## Approach

### Shared design

Each analyzer gets the same three layers, written in its own language and inside its own process.

1. **An API inventory as data.** A JSON file per analyzer describes unsafe APIs by argument role, the way atom's `memory-apis.json` describes `memcpy` as `{dst:1, src:2, len:3}`. Roles include `ptr`, `len`, `index`, `dst`, `src`, `requiresUtf8`, `breaks` (the invariant a call breaks, such as `len`, `init` or `ownership-dup`), `restores`, `alloc` and `free` with a family, `mayUnwind` and `writesGlobal`. A `--memory-api-config` option adds or replaces entries by name. Lists that change more often than the code that reads them stay in data.
2. **Fact passes, then rules.** Fact passes record what is known (an untrusted call, a guard, a may-unwind summary, an allocation state) and write an explicit `unknown` rather than guessing. Rules read facts only and never match source text. A rule registry holds `(id, cwe, kind, severity, confidence, message)`, and a finding may lower or raise its own confidence when the evidence says so.
3. **One output contract.** A memory-safety finding is `{ruleId, cwe, kind, severity, confidence, message, file, line, column, function, purl, flow[], fingerprint}`. `flow[]` is an ordered list of `{file, line, column, role, note}` steps (for example `breaks-invariant`, `may-unwind-call`, `unwind-drop`). `fingerprint` is a stable hash of the rule, the canonical function name, the relative file and the API names in the flow, without line numbers, so a finding survives unrelated edits and can be baselined. SARIF 2.1.0 output lists only the rules that fired, maps critical and high to `error`, medium to `warning` and the rest to `note`, puts the flow in `codeFlows`, and the fingerprint in `partialFingerprints`. A JSON Schema for the finding and a golden SARIF file live in cdxgen-plugins-bin and every analyzer's tests validate against them.

Rule IDs carry the analyzer prefix and a class: `RUSI-MS-PANIC-001`, `GOLEM-MS-PTR-001`, `KOSI-MS-FFM-001`. Messages name the API and function involved and never copy argument values, environment values or source text into the finding, following cdxgen's property hygiene rules.

### Corpus and scoring

The corpus decides whether a rule ships. It has the same arms for every language, and each arm has its own manifest so its numbers stay comparable from round to round.

| Arm | What it is | Ground truth |
| --- | --- | --- |
| Hand-written | Small, realistic programs per rule, each `bad_*` function paired with a `good_*` look-alike | Inline markers: `@expect rule=<id> cwe=<n>` on the defect line and `@nofinding` on the look-alike line, scanned into a manifest by a script so the two cannot drift apart |
| Advisory | Published advisories with an upstream fix commit (RustSec, the Go vulnerability database, GitHub advisories for Maven) | Derived from the fix's diff: the first removed line, or for a pure addition the statement at the insertion point. The vulnerable commit is the positive case and the fixed commit is the negative control |
| Labelled suite | A third-party test suite whose cases already say where the defect is: Miri's `tests/fail` and `tests/pass` for Rust, the `go vet` analyzer `testdata` and the Go toolchain's `checkptr` tests for Go, the JDK's `java/foreign` tests for the JVM | The suite's own annotations, read in place and never copied |
| Real projects | Pinned, popular projects that use the unsafe surface heavily | No ground truth: findings per thousand lines, plus a manual triage of a sample of 20 findings per project for each round, recorded with a verdict |

A scorer reads a findings file and a manifest and reports recall, precision and F1 per rule, per CWE and per capability (`interprocedural`, `generic`, `unwind-path`, `cgo`, `ffi`). A finding on a `@nofinding` line or in a fixed commit fails the run outright. `--min-recall` and `--min-precision` turn the scorer into a CI gate. Thresholds only move up.

Ground truth is never typed by hand. The advisory arm is regenerated by a script from a table of (advisory, repository, fix commit, CWE, rule) and fails loudly when a commit no longer resolves. Items too large for git are listed in the corpus manifest with their SHA-256 digest and licence, and stored as a release asset or an OCI artifact.

### Order

The rusi work goes first because the blog's bug classes are concrete and rusi already has MIR. The shared contract and scorer are written during the first rusi deliverable and reused by golem and kosi. golem and kosi can start once the contract is merged. cdxgen's integration starts once one analyzer emits findings.

## Deliverables

### D1. Finding contract, SARIF layout and scorer

The finding JSON Schema, a golden SARIF file, the marker grammar and the scorer, in cdxgen-plugins-bin. Done when the scorer's self-test passes, a hand-made findings file validates against the schema and the golden SARIF validates against the official SARIF 2.1.0 schema.

### D2. rusi memory-safety

The rusi plan: [rusi-memory-safety.md](rusi-memory-safety.md).

### D3. golem memory-safety

The golem plan: [golem-memory-safety.md](golem-memory-safety.md).

### D4. kosi native-boundary safety

The kosi plan: [kosi-memory-safety.md](kosi-memory-safety.md).

### D5. cdxgen integration

cdxgen keeps findings out of the BOM text and keeps their shape in it. Per purl it adds `cdx:<tool>:memorySafety:ruleIds`, `:cwes`, `:findingCount` and `:maxConfidence`, and adds `evidence.occurrences` for the sites without code snippets. Metadata gets the run's counts per rule. The raw findings and SARIF stay files, written next to the BOM when `--semantics-slices-file` or a new `--memory-safety-sarif <path>` is given. Audit rule packs (`data/rules/rusi-rust.yaml`, and the matching golem and kosi rules) report high-confidence findings in runtime code. `docs/CUSTOM_PROPERTIES.md`, `docs/EVINSE.md` and `docs/BOM_AUDIT.md` describe the properties and rules, and `cdxi` gains `.unsafehotspots`. Done when `lib/ecosystems/rusi.poku.js`, `golem.poku.js` and the kosi tests cover the mapping, a test asserts that no message text or argument value reaches the BOM, and a repository test runs evinse with memory safety on one public crate.

## Risks and open questions

- **Noise decides adoption.** A rule that fires on the `SetLenOnDrop` pattern or on `set_len(0)` will be switched off by users. Every rule ships with its negative controls, and the real-project triage is the guard for the shapes the controls missed.
- **rustc's private API drifts.** rusi's wrapper already probes it in `build.rs`. Every new MIR query needs the same treatment, and the pinned nightly CI job catches breakage.
- **Analyzing the standard library.** Checking `library/alloc` and `library/std` at the blog's pre-fix commits is the best recall test for the Rust rules, and it may not build under rusi's `cargo check` driver. D2 measures whether it works before the plan depends on it.
- **Licences of labelled suites.** Miri is MIT or Apache-2.0, the Go tests are BSD-3-Clause and the JDK tests are GPL-2.0 with the Classpath Exception. All are read in place and never redistributed. RustSec advisories are CC0-1.0 and the Go vulnerability database is CC-BY-4.0.
- **Boundary bugs need a model of the platform.** The blog's third class (`environ`, exit handlers, signal stacks) is hard for static rules. Those rules stay at low confidence and are framed as review candidates, not verdicts.

## Outcome

Filled in when the work ends.
