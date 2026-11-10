# golem memory-safety rules

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/178 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | `plugins-memory-safety.corpus.json`, added with the corpus deliverable of [plugins-memory-safety.md](plugins-memory-safety.md) |

Part of [plugins-memory-safety.md](plugins-memory-safety.md), which describes the shared finding contract, the corpus arms and the cdxgen integration.

## Why

Go is memory-safe until code uses `unsafe`, cgo, `syscall` memory mappings or `reflect`'s pointer methods, or races on a value wider than one word. The [`unsafe` package documentation](https://pkg.go.dev/unsafe#Pointer) lists the only valid patterns for `unsafe.Pointer`, the [cgo documentation](https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers) lists the rules for passing pointers to C, and the runtime enforces part of both only when `-d=checkptr` or `GODEBUG=cgocheck` catches the case at run time.

golem records that this code exists: an `unsafe` import is a high-severity signal, `import "C"` is a `native-interop` signal, `//go:linkname` and `//go:nosplit` are recorded as directives, and taint can reach `unsafe.String` and `unsafe.Slice` as sinks. It does not say whether the code follows the rules. There is no finding type with a rule ID and CWE (`SecuritySignal` in `internal/model/model.go` has neither), `C.free` is modelled as a taint sink rather than as a deallocation, and SARIF covers only data-flow slices and only through `golem bench --sarif`.

## Scope

In scope: a memory-safety mode in `golem analyze` with JSON and SARIF output; an inventory of unsafe, cgo, `syscall` and `reflect` APIs by argument role; fact passes over golem's SSA; the rules below; a new `finding` kind in the corpus annotation grammar; the Go arms of the corpus.

Out of scope: a general static race detector, the C side of cgo (atom covers C), and checks that `go vet` already makes exactly. golem's rules add what vet cannot see: values that cross function boundaries, lengths and offsets from untrusted input, and allocation state across paths. The corpus compares golem with vet's `unsafeptr` and `cgocall` analyzers on the same cases, and the comparison is published.

## Approach

### Fact passes

1. **UnsafeConversion.** Every `unsafe.Pointer` ↔ `uintptr` conversion in SSA, with whether the round trip happens inside one expression (allowed) or through a variable, a field, a parameter or a return value (not allowed). Conversions passed straight to `syscall.Syscall` and its relatives are allowed, as the documentation says.
2. **Extent.** For a pointer derived from a slice, array or allocation, the size of the object it points into when it is known (`len`, `cap`, a constant, `unsafe.Sizeof`), or an explicit `unknown`.
3. **Guard.** A comparison that dominates a use and bounds an offset or length by an extent.
4. **NativeAllocationState.** A flow-sensitive state per value for `C.CString`, `C.CBytes`, `C.malloc`, `syscall.Mmap` and `unix.Mmap`: allocated, freed, maybe freed, escaped. `defer C.free(...)` and `defer unix.Munmap(...)` count as a release on every exit.
5. **CgoArgument.** For each call into C, the Go type of each argument and whether the memory it points to contains Go pointers (pointer fields, slices of pointers, strings, interfaces, maps, channels, functions).
6. **Finalizer.** Objects passed to `runtime.SetFinalizer`, the fields the finalizer releases, and the last use of the object compared with later uses of those fields through `uintptr` or `syscall`.

### Rules

| Rule | CWE | Default confidence | What fires it |
| --- | --- | --- | --- |
| GOLEM-MS-PTR-001 | 119 | high | A `uintptr` made from an `unsafe.Pointer` is stored, passed or returned, then converted back |
| GOLEM-MS-PTR-002 | 823 | medium | `unsafe.Add` or `uintptr` arithmetic with an offset that is untrusted or not bounded by the extent |
| GOLEM-MS-HDR-001 | 119 | high | A `reflect.SliceHeader` or `reflect.StringHeader` value is built or filled instead of being reached through a pointer to a real slice or string |
| GOLEM-MS-SLICE-001 | 125, 787 | medium | `unsafe.Slice` or `unsafe.String` with a length that is untrusted or larger than the extent of its base |
| GOLEM-MS-STR-001 | 664 | medium | A string made from a byte slice with `unsafe.String` or `unsafe.StringData` is still live when the slice is written |
| GOLEM-MS-CGO-001 | 401 | low | `C.CString`, `C.CBytes` or `C.malloc` memory not freed on some path |
| GOLEM-MS-CGO-002 | 415, 416 | high | C memory freed twice, or used after `C.free` |
| GOLEM-MS-CGO-003 | 119 | medium | A Go pointer to memory that contains Go pointers is passed to C, or an exported function returns a Go pointer to C |
| GOLEM-MS-MMAP-001 | 416 | high | A slice from `Mmap` is used, or escapes, after `Munmap` |
| GOLEM-MS-KEEP-001 | 416 | low | A field released by a finalizer is used through `uintptr` or `syscall` after the object's last use, with no `runtime.KeepAlive` |
| GOLEM-MS-REFL-001 | 119 | medium | The result of `reflect.Value.UnsafePointer`, `UnsafeAddr` or `reflect.NewAt` feeds pointer arithmetic or `unsafe.Slice` |

A finding in code that only tests call (`cdx:golem:testOnly`) keeps its rule but drops one confidence level. Findings carry `cdx:golem:usageScopes` so cdxgen's audit rules can prefer runtime code, as they do for golem's other evidence.

### Output and tests

Findings follow the shared contract in a new `memorySafetyFindings` section of the report. `analyze` gains `--format sarif` (or `--sarif-out <file>`), and `internal/exporter/sarif.go` renders findings as well as slices. The corpus grammar in `internal/corpus/annotations.go` gains `golem:want finding rule=<id> [cwe=<n>] [confidence=<level>]` and its `want-not` form, evaluated with the same two-way ratchet as flows. New categories go through `validateCategory`.

## Corpus

- **Hand-written.** `testdata/corpus/mem-*` cases, one or more per rule, each with a `want-not` twin, listed in the bench manifest as `quick`.
- **Labelled suites.** The `unsafeptr` and `cgocall` analyzer `testdata` in golang.org/x/tools (their `// want` comments), the cgo pointer-passing table in the Go toolchain's `cmd/cgo/internal/testerrors/ptr_test.go` (each case says whether it must fail), and the runtime's `checkptr` test programs. All are read in place.
- **Advisories.** Entries in the Go vulnerability database and GitHub advisories for Go modules with CWE-119, 125, 416 or 787, with a fix commit, turned into vulnerable and fixed checkouts by the shared script.
- **Real projects.** golem's pinned bench fixtures that use this surface heavily (badger, gopacket, minio, go-sqlite3, gocv, confluent-kafka-go, purego), plus pinned releases of bytedance/sonic, valyala/fasthttp, cilium/ebpf and golang.org/x/sys.

## Deliverables

### D1. Findings, SARIF and the `finding` annotation (cdxgen/cdxgen-plugins-bin#179)

The finding type, `analyze --format sarif`, the annotation kind and its evaluator, and the inventory with its loader. Done when a hand-written finding case passes and fails the ratchet as expected and the SARIF output validates against the official schema and the shared golden file.

### D2. Pointer rules (cdxgen/cdxgen-plugins-bin#180)

UnsafeConversion, Extent and Guard, and PTR-001, PTR-002, HDR-001, SLICE-001, STR-001 and REFL-001. Done when the hand-written and `unsafeptr` arms meet the gate and the comparison with vet is recorded.

### D3. cgo and mapping rules (cdxgen/cdxgen-plugins-bin#181)

NativeAllocationState and CgoArgument, and CGO-001 to 003 and MMAP-001. `C.free` moves from a taint sink to a deallocation fact without changing existing flow results, which `testdata/seam-parity.json` and the corpus check. Done when the cgo pointer-passing table is scored and go-sqlite3 and gopacket are triaged.

### D4. Finalizer rule (cdxgen/cdxgen-plugins-bin#182)

Finalizer and KEEP-001. Done when the hand-written cases pass and the real-project triage shows the review cost.

### D5. Go corpus arms (cdxgen/cdxgen-plugins-bin#183)

The labelled, advisory and real-project arms, their manifest entries and digests, and the CI split between the `quick` tier on every pull request and the rest nightly.

## Risks and open questions

- golem builds SSA only when a call graph or data flow is requested. The memory-safety mode needs SSA always, so it costs as much as `--dataflow security` on large modules. The bench baseline records the cost.
- STR-001 needs to know that a string is still live when its bytes change. If liveness through maps and struct fields is too costly, the rule starts with locals and records the gap.
- A goroutine race rule (torn interface or slice writes) is left out until a cheap, precise shape is found. A note in the plan's Outcome records whether one was.

## Outcome

Filled in when the work ends.
