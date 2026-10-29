# romi, the ROM inspector

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/139 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | See [cdxgen-firmware-corpus.md](cdxgen-firmware-corpus.md) |

## Why

cdxgen needs to look inside firmware images, and firmware images are about the most hostile input an SBOM tool can receive. They are nested containers of compressed data, and an attacker controls every length field and every decompressor's input. They often come from vendor download sites, from devices under investigation, or from incident response. Parsing them in cdxgen's JavaScript would be slow and would put the whole generator at risk.

The cdxgen-plugins-bin repository already holds native helpers for this kind of work: golem for Go, rusi for Rust, kosi for Kotlin, cdxrs for BOM validation and fetching, and cdxui as a TUI. A firmware helper fits the same pattern. We call it **romi**, for ROM inspector, following rusi (Rust source inspector) and kosi (Kotlin source inspector). The name is free on crates.io, and the npm package with the same name is unrelated and does not matter, because romi ships inside `@cdxgen/cdxgen-plugins-bin`.

Rust is the right language. It gives memory safety for a parser of untrusted data, mature fuzzing tools, and a growing set of firmware crates to build on, and it cross-compiles to every platform the plugins support:

| Crate | Use in romi | Licence |
| --- | --- | --- |
| [patina_ffs](https://crates.io/crates/patina_ffs) (Microsoft and Open Device Partnership) | UEFI firmware volumes and FFS, zero-copy, pluggable section extractors | Apache-2.0 |
| [mu_uefi_decompress](https://crates.io/crates/mu_uefi_decompress) (Project Mu) | EDK II decompression algorithms | BSD-2-Clause-Patent |
| [efi-compress](https://crates.io/crates/efi-compress) | alternative port of EDK II's EFI and Tiano decompressor | BSD-2-Clause-Patent |
| [backhand](https://crates.io/crates/backhand) | SquashFS v4 and v3, including vendor variants | MIT OR Apache-2.0 |
| [goblin](https://crates.io/crates/goblin) | PE, TE and ELF parsing | MIT |
| [fdt](https://crates.io/crates/fdt) | flattened device trees for FIT images | MPL-2.0 |
| [ciborium](https://crates.io/crates/ciborium) | CBOR for CoSWID tags | Apache-2.0 |
| [binwalk](https://crates.io/crates/binwalk) v3 | reference for signature scanning, not a dependency, because it shells out to external extractors | MIT |

## Scope

This plan covers the foundation: the crate, the CLI, the `romi/1` report contract, resource limits, extraction safety, the threat model, fuzzing and packaging. Format support is in [romi-uefi-formats.md](romi-uefi-formats.md) and [romi-embedded-linux.md](romi-embedded-linux.md), and identity and embedded SBOMs are in [romi-firmware-identity.md](romi-firmware-identity.md).

romi does not produce CycloneDX. It produces facts, and cdxgen maps them, as with golem and kosi. That keeps BOM policy in one place and lets romi be used by other tools.

## Approach

### Layout

```
thirdparty/romi/
  Cargo.toml          workspace: romi-core (library), romi (CLI)
  Makefile            same triples and release profile as cdxrs and rusi
  README.md
  JSON_ATTRIBUTE_REFERENCE.md
  THREAT_MODEL.md
  schemas/romi-1.schema.json
  src/                CLI
  crates/romi-core/   format detection, walker, limits, report model
  crates/romi-uefi/   UEFI and PC firmware formats
  crates/romi-linux/  embedded Linux containers and filesystems
  crates/romi-sbom/   uSWID and CoSWID
  tools/              EDK II GUID database generator
  fuzz/               cargo-fuzz targets
  tests/              unit, snapshot and malformed-input tests
```

Every romi crate uses `#![forbid(unsafe_code)]`. Dependencies are audited with `cargo-deny` (licences, advisories, duplicate versions) and recorded with cargo-auditable for the post-build SBOM.

### CLI and report

- `romi scan <path> [--output file] [limits]` walks the input and writes `romi/1` JSON.
- `romi extract <path> --dest <dir> [--select modules,filesystems,sboms] [limits]` walks the input and writes selected payloads.
- `romi formats` lists the supported formats and parser versions.

The report has `schema`, `romi` (version and GUID database version), `input` (path, size, SHA-256), `nodes` (id, parent, kind, format, offset, size, SHA-256, compression, attributes, diagnostics), `sboms`, `diagnostics` (code, message, node, count) and `stats`. Output is byte-identical across runs, thread counts and platforms. The schema is published and versioned, and breaking changes bump the major version that cdxgen pins.

### Limits and safety

| Limit | Default (to tune on the corpus) | Diagnostic |
| --- | --- | --- |
| nesting depth | 16 | `depth-limit` |
| decompressed bytes per section | 256 MiB | `section-budget` |
| decompressed bytes per input | 4 GiB | `input-budget` |
| decompression ratio | 1000:1 | `ratio-limit` |
| nodes | 1,000,000 | `node-limit` |
| wall clock | 300 s | `time-limit` |
| extraction bytes on disk | 8 GiB | `extract-budget` |

Extraction never writes outside the destination: there are no absolute paths and no `..` components, symlinks are recreated but never followed, device nodes and FIFOs are skipped, and setuid and setgid bits are dropped. Every skip is a diagnostic. All length arithmetic is checked, parsers return errors instead of panicking, and a panic aborts the process, which cdxgen reports as a failure and the fuzzers treat as a bug.

### Fuzzing

There is one cargo-fuzz target per format family. The targets are seeded from the corpus by digest, run briefly on every pull request that touches romi and for longer each night, and reproducers are uploaded on crash. Once the API settles, romi is proposed to OSS-Fuzz.

### Packaging

romi is pure Rust with no system libraries, so it should build for all eleven package targets, including linux-arm, linux-riscv64 and ppc64. Any platform gap is named in `scripts/plugin-platform-support.sh`. romi is added to the build scripts, `plugins-manifest.json` and the post-build SBOM, gets `docs/ROMI.md` and a lesson, and is added to cdxgen's `PLUGIN_ENV_COMMAND_NAMES` as `ROMI_CMD`.

## Test cases

| Case | Expected |
| --- | --- |
| Synthetic volume built in the test | snapshot of the report matches, and it validates against the schema |
| Determinism | identical bytes across two runs, 1 and 8 threads, and Linux and macOS |
| Each limit | fixture trips the named diagnostic within a bounded time |
| Traversal and symlink escape | nothing written outside the destination, and a diagnostic for each skip |
| Zero-size and self-referencing FFS files | no infinite loop, and a diagnostic |
| Fuzz harness smoke | every target builds and runs for a few seconds in the regular test job |
| Package smoke | `romi formats` and `romi scan` work from each installed platform package |

## Deliverables

### D1. Crate and `romi/1` contract (cdxgen/cdxgen-plugins-bin#140)

### D2. Limits and threat model (cdxgen/cdxgen-plugins-bin#141)

### D3. Fuzzing in CI (cdxgen/cdxgen-plugins-bin#142)

### D4. Packaging and documentation (cdxgen/cdxgen-plugins-bin#143)

## Risks and open questions

- **patina_ffs on malformed input.** patina_ffs is built for firmware that is itself being constructed, not for adversarial images. It needs fuzzing before romi adopts it, and romi may keep its own walker and use patina_ffs as a reference.
- **Dependency licences.** Every dependency is permissive, but `fdt` is MPL-2.0, which is file-level copyleft. That is compatible with distribution as a binary, but it should be noted in the NOTICE file.
- **Binary size.** Many compression features and the GUID database will grow the binary. Feature flags per format family and UPX, as used for other helpers, keep it manageable.

## Outcome

To be filled in when the work ends.
