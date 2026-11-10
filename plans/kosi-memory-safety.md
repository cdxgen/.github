# kosi native-boundary safety rules

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/184 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | `plugins-memory-safety.corpus.json`, added with the corpus deliverable of [plugins-memory-safety.md](plugins-memory-safety.md) |

Part of [plugins-memory-safety.md](plugins-memory-safety.md), which describes the shared finding contract, the corpus arms and the cdxgen integration.

## Why

Kotlin and Java code on the JVM cannot corrupt memory, so its memory-safety bugs sit at the boundary where it hands an address or a length to something that trusts it: JNI `native` methods and Kotlin `external` functions, `sun.misc.Unsafe`, JNA's `Pointer`, the restricted methods of the [Foreign Function and Memory API](https://openjdk.org/jeps/454) (`MemorySegment.reinterpret`, `Linker.downcallHandle`, `SymbolLookup.libraryLookup`), and Kotlin/Native's `kotlinx.cinterop` (`nativeHeap`, `memScoped`, `StableRef`, `pin`). The managed side often decides how many bytes the native side may touch, and that is where a check is missing.

kosi records two of these today: a Kotlin function with the `external` modifier and a resolved `System.loadLibrary` call each produce a `native-interop` signal, and a cinterop `.def` file is recorded too. Java `native` methods are not recorded (`ResolvedAnalyzer.javaModifiers` keeps only `abstract`, `final` and `static`), a `loadLibrary` in an `object` initializer is missed, and none of the other APIs above appear in kosi's model packs. `SecuritySignal` has no rule ID, severity, confidence or CWE, and SARIF covers only data-flow slices. The `unsafe-interop` signal code is reserved and never emitted.

## Scope

In scope: the native-boundary inventory; Java `native` methods and initializer `loadLibrary` calls; the rules below; memory-safety findings in the report and in SARIF; a `finding` kind in the corpus grammar; the JVM arms of the corpus. Kotlin/Native rules start on the syntax tier with import-based name resolution, because the resolved tier analyses against the JVM platform only.

Out of scope: data races (memory-safe on the JVM), the native code behind JNI (atom covers C and C++), and `IllegalStateException` from using a closed FFM arena, which the JVM checks and which is therefore not a memory-safety bug.

## Approach

### Fact passes

1. **NativeBoundary.** Every `native` or `external` method, every restricted FFM call, every JNA `Native.load` interface method, and every `kotlinx.cinterop` call, with the role of each argument (address, length, buffer, offset, size) from the inventory.
2. **Extent.** The known size of a buffer: an array's `size`, a `ByteBuffer`'s `capacity` or `remaining`, a JNA `Memory`'s `size`, a `MemorySegment`'s `byteSize`, or an explicit `unknown`.
3. **Guard.** A dominating comparison that bounds a length or offset by an extent.
4. **NativeAllocationState.** A flow-sensitive state for `Unsafe.allocateMemory` and `freeMemory`, `reallocateMemory`, JNA `Native.malloc` and `free`, `nativeHeap.alloc` and `free`, and `StableRef.create` and `dispose`: allocated, freed, maybe freed, escaped.
5. **ScopeEscape.** Kotlin/Native values allocated inside `memScoped { }` or pinned inside `usePinned { }`, and whether they are returned, stored in a field or captured by a lambda that outlives the scope.

### Rules

| Rule | CWE | Default confidence | What fires it |
| --- | --- | --- | --- |
| KOSI-MS-JNI-001 | 130 | medium | A call to a native method passes a buffer and a length where the length is not that buffer's size and is not bounded by it |
| KOSI-MS-JNI-002 | 20 | low | Untrusted data reaches a native method argument with an address, length or offset role |
| KOSI-MS-UNSAFE-001 | 787, 125 | medium | `Unsafe.getX`, `putX`, `copyMemory` or `setMemory` with an address or offset that is untrusted or not bounded by an extent |
| KOSI-MS-UNSAFE-002 | 415, 416, 401 | high for 415 and 416, low for 401 | Native memory from the allocators above freed twice, used after free, or not freed on some path |
| KOSI-MS-FFM-001 | 125, 787 | medium | `MemorySegment.reinterpret` with a size that is untrusted or not bounded |
| KOSI-MS-FFM-002 | 416 | low | A segment obtained from a downcall or an address is reinterpreted into an arena that lives longer than the memory's owner (for example `Arena.global()` or an automatic arena) |
| KOSI-MS-JNA-001 | 125, 787 | medium | `Pointer` reads or writes, or `Pointer.share`, at an offset that is untrusted or beyond the known extent; `new Pointer(address)` from untrusted data |
| KOSI-MS-KN-001 | 562, 416 | medium | A `memScoped` allocation or a pinned address escapes its scope |
| KOSI-MS-KN-002 | 416, 401 | medium | A `StableRef` used after `dispose`, or never disposed |
| KOSI-MS-BUF-001 | 119 | low | The address of a direct `ByteBuffer` read through reflection (`Buffer.address`) or `Unsafe` and passed on as a raw address |

Untrusted means the taint engine's existing sources from `security-pack-v0.json`. Flow-shaped rules (JNI-002, and the untrusted arms of UNSAFE-001, FFM-001 and JNA-001) are expressed as new sink categories in that pack, so they reuse the engine and its SARIF output. The rest are fact rules in a new collector next to `NativeInterop.kt`.

### Output and tests

Findings follow the shared contract in a new `memorySafetyFindings` section. `--sarif-out` renders findings as well as slices, and no longer refuses a run that has findings but no data flow. The corpus grammar in `modules/kosi-corpus/.../Annotation.kt` gains `kosi:want finding rule=<id> [cwe=<n>] [confidence=<level>]` and its `want-not` form, with the same two-way ratchet. The `unsafe-interop` code becomes the signal for boundary sites that no rule flags, so the inventory stays visible.

## Corpus

- **Hand-written.** `fixtures/memsafe-*` projects in Kotlin and Java, one or more per rule, with near-miss twins, registered in `corpus.toml`.
- **Advisories.** GitHub advisories for Maven packages with CWE-119, 125, 130, 416 or 787 whose fix is on the managed side of a native boundary, for example in compression libraries that check lengths before calling native code. Each candidate is confirmed against its advisory and fix commit before it enters the manifest.
- **Labelled suite.** The JDK's `test/jdk/java/foreign` tests, read in place, as negative controls: they exercise correct and checked use of the API, so a high-confidence finding there is a false positive.
- **Real projects.** Pinned releases of netty, lz4-java, snappy-java, zstd-jni, sqlite-jdbc, lwjgl3, JNA, kotlinx-io and the Android NDK samples, plus kosi's existing KMP fixture KaMPKit for the Kotlin/Native rules.

## Deliverables

### D1. Boundary inventory and findings (cdxgen/cdxgen-plugins-bin#185)

Java `native` methods, initializer `loadLibrary`, the inventory, the finding type, SARIF for findings, the `finding` annotation, and JNI-001. Done when the hand-written JNI cases pass the ratchet and the SARIF output validates against the official schema and the shared golden file.

### D2. Unsafe and JNA rules (cdxgen/cdxgen-plugins-bin#186)

Extent, Guard and NativeAllocationState, the new sink categories, and UNSAFE-001, UNSAFE-002, JNA-001, BUF-001 and JNI-002. Done when the hand-written arm meets the gate and netty and lz4-java are triaged.

### D3. FFM rules (cdxgen/cdxgen-plugins-bin#187)

FFM-001 and FFM-002, with the JDK tests as negative controls. Done when the JDK arm has no high-confidence finding and the hand-written cases pass.

### D4. Kotlin/Native rules (cdxgen/cdxgen-plugins-bin#188)

ScopeEscape and KN-001 and KN-002 on the syntax tier, matching `kotlinx.cinterop` names through imports. Done when the hand-written cases pass and KaMPKit is triaged. Whether the resolved tier can analyse native source sets with klibs is measured and recorded.

### D5. JVM corpus arms (cdxgen/cdxgen-plugins-bin#189)

The advisory, JDK and real-project arms, their manifest entries and digests, and the split between `corpusQuick` and `corpusFull`.

## Risks and open questions

- Adding a signal code or a report section changes the schema and every golden digest in `goldens/`. Each deliverable regenerates the goldens in its own commit, so the change can be reviewed on its own.
- JNI-001 has to recognise how projects pass a length (`arr.size`, `buf.remaining()`, an offset and a count). The first round measures how many findings are wrapper helpers that already check, and the Guard pass grows from there.
- Kotlin/Native resolution through imports alone misses star imports and type aliases. KN rules stay at medium confidence until the resolved tier supports native platforms.

## Outcome

Filled in when the work ends.
