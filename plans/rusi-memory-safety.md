# rusi memory-safety rules

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/172 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | `plugins-memory-safety.corpus.json`, added with the corpus deliverable of [plugins-memory-safety.md](plugins-memory-safety.md) |

Part of [plugins-memory-safety.md](plugins-memory-safety.md), which describes the shared finding contract, the corpus arms and the cdxgen integration.

## Why

rusi reports where `unsafe` code is (`unsafe-code` signals for unsafe blocks and functions, `native-interop` for foreign items) but not whether it is correct. The bugs in the Rust standard library that FORGE reported in 2026 ([Rust std memory safety](https://forge-blog.github.io/posts/rust-std-memory-safety/)) show what correctness means here. Each one is unsafe code that trusted something it did not control:

- **Panic safety.** `MapWindows::clone` (rust-lang/rust#156501) built a buffer whose `Drop` was already armed and then called the element's `clone`. A panicking `clone` dropped uninitialised elements. Unwinding allocators broke `BTreeMap::insert` (#156490) and several other paths.
- **Trusting safe trait implementations.** `join` borrows the first element twice through `Borrow::borrow`, and a value that grows on the second call underflows the length computation (CVE-2020-36323, and again in rust-lang/rust#155708). `str::replace` trusted a one-byte `StringPattern` to be ASCII and called `from_utf8_unchecked` on the result (#156491). A safe `Searcher` could return ranges for a different string (#158265).
- **Trusting the platform.** `CommandExt::exec` wrote `environ` while holding only the read side of the environment lock (#156951). `process::exit` called from a thread-local destructor dropped a value twice (#164243). `process::exit` from a child thread unmapped the main thread's alternate signal stack (#161018).

None of these can be seen in the syntax tree alone. They need MIR, unwind edges and knowing whether a callee is a trait method on a type parameter, and rusi's compiler backend (`rusi-rustc-wrapper`) already collects all three.

## Scope

In scope: a `memory-safety` command in rusi that requires the compiler backend; an inventory of unsafe standard-library APIs; fact passes and rules for the three classes above plus unbounded `unsafe impl Send/Sync`; detection of `unsafe impl` in both backends; SARIF output; the Rust arms of the corpus.

Out of scope: aliasing (Stacked or Tree Borrows), inline assembly, data races in safe code, and lints clippy already has (`uninit_vec`, `mem_replace_with_uninit`, `transmute_*`). The stable backend keeps its coarse `unsafe-code` signal and gains only a low-confidence inventory of calls to the APIs in the inventory.

## Approach

### Layout

The passes live in a new `memory_safety` module of `rusi-rustc-wrapper`. The driver embeds the wrapper's sources with `include_str!` and builds them on the analysing machine (`rusi-driver/src/lib.rs`), so every new source file must be added to that embedded list, and a test must fail when a wrapper source is missing from it. Finding types go in `rusi-schema` next to `SecuritySignal`, as a new `memory_safety_findings` field on `Report` that is skipped when empty, so older consumers keep working. The inventory is a JSON file in `rusi-schema`, compiled in with `include_str!`, and `--memory-api-config` adds or replaces entries.

Every rustc API the passes use goes through the existing `build.rs` probes when its shape has changed between 1.98 and the current nightly, the same way the wrapper handles `PlaceElem` and `GenericArgs` today.

### Inventory entries

Examples of the shape (argument indices are 1-based, the receiver is argument 1):

| API | Roles |
| --- | --- |
| `Vec::set_len` | `len:2`, `breaks:len` unless the new length is a constant 0 or provably not greater than the old one, in which case it `restores` |
| `ptr::read`, `ptr::read_unaligned` | `src:1`, `breaks:ownership-dup` |
| `ptr::write`, `ptr::copy`, `ptr::copy_nonoverlapping` | `dst`, `src`, `len` |
| `slice::from_raw_parts`, `slice::from_raw_parts_mut` | `ptr:1`, `len:2` |
| `get_unchecked`, `get_unchecked_mut` | `index:2` |
| `str::from_utf8_unchecked`, `String::from_utf8_unchecked` | `requiresUtf8:1` |
| `MaybeUninit::assume_init` and its variants | `requiresInit:1` |
| `String::as_mut_vec` | `breaks:utf8` |
| `mem::forget`, `ManuallyDrop::new` | `restores` (disarms the drop) |
| `libc::setenv`, `libc::putenv`, `libc::unsetenv`, `libc::execve` | `writesGlobal:environ` |
| `libc::exit`, `std::process::exit` | `runsExitHandlers` |
| `libc::munmap`, `libc::sigaltstack` | `releasesProcessResource` |

### Fact passes

1. **UnsafeRegion.** Unsafe blocks and functions (existing), plus `unsafe impl` and unsafe trait definitions from HIR (`impl_trait_header` safety) and from `syn` in the stable backend.
2. **UntrustedCall.** A call whose callee is a method of a safe trait and whose `Self` type is, or contains, a type parameter or a `dyn` type. Calls through `Fn`, `FnMut` and `FnOnce` on a type parameter count too. A method of an `unsafe trait` (for example `TrustedLen` or `GlobalAlloc`) is trusted, because its implementor has promised what the caller relies on. When monomorphisation shows that every instantiation in the analysed crates uses a standard-library type, the fact carries `instantiatedOnlyWithStd`.
3. **MayUnwind.** A per-function summary computed to a fixpoint: a function may unwind if it calls an untrusted method, a function that may unwind, a method of a generic `Allocator`, or `panic!` and its relatives outside a `catch_unwind`. Pointer intrinsics, `len`, and arithmetic with overflow checks off do not unwind. The summary is written per call site from MIR's `UnwindAction::Cleanup` successors.
4. **Guard.** A comparison that dominates a use and bounds a value by a `len()`, `capacity()` or constant, a `min`, an `assert!` or a checked slice. `debug_assert!` is a guard only in debug builds and is recorded as `guard-debug-only`.
5. **DropGuard.** A local whose type implements `Drop` and that is live across a call is a restoring guard (the `SetLenOnDrop` pattern). A value wrapped in `ManuallyDrop`, or passed to `mem::forget` before the call, is disarmed.
6. **LockState.** Where a `RwLockReadGuard` or `MutexGuard` local is live, from its creation to its drop.

### Rules

| Rule | CWE | Default confidence | What fires it |
| --- | --- | --- | --- |
| RUSI-MS-PANIC-001 | 415, 457 | medium | After a `breaks:*` operation on a place, a call that may unwind has a cleanup path that drops that place or its owner, with no drop guard or restore on the way |
| RUSI-MS-PANIC-002 | 457 | medium | An ADT whose `Drop` reads `MaybeUninit` fields as initialised is constructed, then filled while calling untrusted code |
| RUSI-MS-PANIC-003 | 415, 457 | low | PANIC-001 where the only unwinding call is a generic `Allocator` method |
| RUSI-MS-TRUST-001 | 125, 787 | medium | The result of an untrusted call reaches a `len`, `index` or `ptr` role with no guard |
| RUSI-MS-TRUST-002 | 367 | medium | The same untrusted method is called twice on the same place, and one result sizes or bounds what the other drives |
| RUSI-MS-TRUST-003 | 838 | medium | Bytes derived from an untrusted call reach a `requiresUtf8` argument |
| RUSI-MS-SEND-001 | 362 | medium | `unsafe impl Send` or `Sync` for a type with a type parameter that appears in the type and has no `Send` or `Sync` bound |
| RUSI-MS-SYS-001 | 362 | low | A `writesGlobal` call or a write to a `static` while only a read guard is held |
| RUSI-MS-SYS-002 | 415 | low | A `runsExitHandlers` call reachable from a `Drop` implementation, a thread-local destructor or an `atexit` callback |
| RUSI-MS-SYS-003 | 416 | low | A `releasesProcessResource` call on a resource held in a `static`, reachable from a closure passed to `thread::spawn` |

Confidence rises one level when the type parameter comes from a `pub` item of a library crate, because any downstream crate can supply the implementation, and falls one level with `instantiatedOnlyWithStd`. `panic = "abort"` in the profile is recorded on the finding but does not suppress it, because a library cannot assume how it will be built. Findings are deduplicated on (site, rule), and PANIC-001 suppresses PANIC-003 at the same site.

## Corpus

The Rust arms of the shared corpus, stored as described in the overview plan:

- **Hand-written.** A `fixtures/memsafe-*` Cargo project per rule family, with `@expect` and `@nofinding` markers. Each fixture reproduces a blog bug in a crate of its own (a panicking `Clone`, a `Borrow` that grows on the second call, a one-byte non-ASCII pattern, a `Searcher` that returns foreign ranges, `exec` under a read lock, `process::exit` from a thread-local destructor) next to its fixed form. The fixtures are written from scratch and copy no standard-library source.
- **Standard library.** rust-lang/rust at the parent and the fix commit of each issue above. D1 finds out whether rusi can analyse `library/alloc`, `library/core` and `library/std` there. If it cannot, this arm is recorded as not possible and the hand-written reproductions carry those cases.
- **Advisories.** RustSec advisories with the `memory-corruption`, `memory-exposure` or `thread-safety` category and a fix commit in a public repository, starting with those Rudra reported. A script derives the vulnerable line from the fix diff and checks out both commits.
- **Labelled suite.** Miri's `tests/fail` cases for the classes the rules cover (uninitialised reads, double drops, out-of-bounds access, dangling pointers) and its `tests/pass` cases as negatives. Stacked and Tree Borrows cases are excluded.
- **Real projects.** Pinned releases of crates with a lot of unsafe code, such as smallvec, arrayvec, bytes, hashbrown, crossbeam, parking_lot, memchr, indexmap, tokio and regex-automata, added to `corpus.toml` as a `memsafe` tier.

## Deliverables

### D1. Foundations: `unsafe impl`, SEND-001, findings and SARIF (cdxgen/cdxgen-plugins-bin#173)

`unsafe impl` detection in both backends, the inventory and its loader, the finding types in `rusi-schema`, the `memory-safety` command with `--format json|sarif` and `--min-confidence`, RUSI-MS-SEND-001, the hand-written fixtures for SEND-001, and the check of whether the standard-library arm can run. Done when SEND-001 meets the corpus gate and the SARIF output validates against the official schema and the shared golden file.

### D2. Trust rules (cdxgen/cdxgen-plugins-bin#174)

UntrustedCall and Guard, and RUSI-MS-TRUST-001 to 003, using the existing data-flow engine with new source and sink categories. Done when the `join`, `str::replace` and `Searcher` reproductions are found, their fixed twins are silent, and the advisory arm's trust cases are scored.

### D3. Panic-safety rules (cdxgen/cdxgen-plugins-bin#175)

MayUnwind, DropGuard and RUSI-MS-PANIC-001 to 003. Done when the `MapWindows::clone` and unwinding-allocator reproductions are found, `SetLenOnDrop`, `set_len(0)` and `ManuallyDrop` controls are silent, and the Miri and advisory arms are scored.

### D4. Platform-boundary rules (cdxgen/cdxgen-plugins-bin#176)

LockState and RUSI-MS-SYS-001 to 003, at low confidence. Done when the `exec`, thread-local exit and signal-stack reproductions are found and the real-project triage shows how many findings a reviewer would have to read.

### D5. Corpus arms and gates (cdxgen/cdxgen-plugins-bin#177)

The standard-library, advisory, Miri and real-project arms, their manifest entries and digests, and the CI job that runs the hand-written arm on every pull request and the rest nightly. Done when the job fails on a planted false positive and on a planted recall drop.

## Risks and open questions

- The standard-library arm may not build under the driver; D1 answers this before D2 relies on it.
- PANIC-001 needs to know which place a `breaks:*` call affects through references and reborrows. If MIR's place projections are not enough, the rule starts with the receiver local only and records the gap.
- The thresholds for each rule are set from the first measured round and are the maintainer's decision.

## Outcome

Filled in when the work ends.
