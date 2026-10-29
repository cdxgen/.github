# Firmware SBOM corpus, golden tests and benchmarks

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4641 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | `cdxgen-firmware-corpus.corpus.json`, to be added with cdxgen/cdxgen#4642 once the images are stored |

## Why

Firmware analysis fails quietly. A parser that misses one compression variant or one nested volume still produces a plausible list of modules. The defence is ground truth, and firmware builds produce it for free: an EDK II build writes `FV/Guid.xref`, coreboot's `cbfstool print` lists every CBFS file, filesystem tools list every entry, and Yocto and OpenWrt record every installed package. If we build our corpus from pinned sources, every image comes with its own answer key.

The same corpus seeds romi's fuzzers, drives cdxgen's repository tests, and makes a public comparison with other tools possible. That comparison is what "first-class" has to mean in practice.

## Scope

In scope: the public corpus and its manifest, a private benchmark manifest for vendor images, the build pipeline, cdxgen's firmware repository tests, and the benchmark harness.

Out of scope: redistributing vendor firmware. Vendor images are described by URL and digest so measurements can be reproduced, but their bytes are never published.

## Approach

### Corpus contents

**Built from pinned sources**, with answer keys:

| Family | Variants | Answer key | Licence |
| --- | --- | --- | --- |
| EDK II OVMF / ArmVirtQemu / RISC-V virt | X64, IA32, AArch64, RISC-V; RELEASE and DEBUG; `NETWORK_ENABLE` on and off; Secure Boot with enrolled keys; two `edk2-stable` tags | `Guid.xref`, `.Fv.map` | BSD-2-Clause-Patent |
| OVMF with embedded SBOMs | CoSWID `.sbom` section in one module; multi-tag uSWID blob, compressed with zlib and with LZMA | python-uswid input files | BSD-2-Clause-Patent |
| Capsules and keys | FMP capsules from `GenerateCapsule`, signed and unsigned; variable store with a synthetic "DO NOT TRUST" platform key | generator inputs | BSD-2-Clause-Patent |
| coreboot | QEMU x86 with uSWID SBOM; with SeaBIOS; with EDK II payload; with microcode | `cbfstool print` | GPL-2.0-only plus payload licences |
| U-Boot | QEMU ARM; legacy and FIT images with `mkimage`; signed FIT | `mkimage -l` | GPL-2.0-or-later |
| Buildroot | QEMU ARM and x86-64; SquashFS, ext4, JFFS2 and UBIFS | `.config`, `build/packages-file-list.txt` | per package, from Buildroot's legal-info |
| Yocto | `core-image-minimal` for QEMU; IPK and RPM backends | installed-packages manifest | per package, from Yocto's license manifest |
| Malformed fixtures | bombs, traversal, overlapping lengths, loops | expected diagnostics | test data written for this corpus |

**Taken from distributions and upstream releases**, with source URL and digest:

| Item | Example digest (SHA-256) | Licence |
| --- | --- | --- |
| Ubuntu `qemu-efi-aarch64` 2024.02-2ubuntu0.10 `QEMU_EFI.fd` | `d2d1228a664adbaed2148c2661e30c930af9bf09f03b6d5aa2a8bbc9cb5cab43` | BSD-2-Clause-Patent and bundled licences per Debian copyright |
| Ubuntu `ipxe-qemu` `efi-e1000.rom` | `2e100b3f6aeadb8702189882bc8f5de9948cb09a54f1d501430aa5ded0556d76` | GPL-2.0-or-later |
| Debian and Fedora OVMF, AAVMF and their `.ms.fd` variable stores | to be recorded | as above |
| OpenWrt release images: x86-64, one ARM router, one NAND target | to be recorded | GPL-2.0 and package licences |
| `linux-firmware` release tag | to be recorded | per `WHENCE` |
| Intel and AMD microcode releases | to be recorded | vendor redistribution licences |

**Private benchmark set**, never published: vendor capsules and BIOS images for at least one AMI, Insyde and Phoenix platform, Dell, HPE and Lenovo servers, and one AMD and one Intel desktop board, taken from the LVFS and OEM support sites. These are listed in a separate manifest with URL and digest.

### Storage and pipeline

Images too large for git go to an OCI artifact in GHCR (for example `ghcr.io/cdxgen/firmware-corpus:<date>`), pulled by digest. Small malformed fixtures stay in romi's repository. The build pipeline uses container images with pinned toolchains, so a rebuild produces the same bytes where the upstream build is reproducible. Where it is not, the pipeline records the new digests and keeps the answer keys with them.

### Golden tests

Answer-key assertions (recall and precision per image, with thresholds that only ratchet up) are the main checks. A few normalised BOM snapshots catch unintended changes in shape. A fast subset runs on every pull request, and the full set runs nightly and on release branches.

### Benchmark

The harness compares cdxgen with UEFIExtract, uefi-firmware-parser, binwalk v3 with Syft or Trivy, EMBA's SBOM profile, the LVFS composite SBOM and python-uswid, wherever each applies. It measures completeness against answer keys, identity quality, embedded SBOM import, robustness on malformed inputs, time and memory. Results for the public corpus are published in full. For the private set, only aggregates and digests are published.

## Test cases

The cases each image must keep passing are listed in the companion plans. This plan adds the cross-cutting ones:

| Case | Expected |
| --- | --- |
| Corpus integrity | every item's digest matches its manifest entry before tests run |
| Answer-key thresholds | recall and precision at or above the recorded threshold for every built image |
| Regression images | every image that once broke romi or cdxgen stays in the corpus with its expected result |
| Determinism | two runs on different machines produce identical normalised BOMs |
| Fuzz seeds | romi's fuzz targets load seeds from the corpus by digest |

## Deliverables

### D1. Corpus and manifest (cdxgen/cdxgen#4642)

The built and collected public corpus in GHCR, the manifest, the private benchmark manifest and the build pipeline.

### D2. Golden firmware tests (cdxgen/cdxgen#4643)

Answer-key assertions and snapshots in repotests, fast on pull requests and complete nightly.

### D3. Benchmark (cdxgen/cdxgen#4644)

A one-command harness and published results for 13.8.0.

## Risks and open questions

- **Build cost.** Building EDK II, coreboot, Buildroot and Yocto variants takes hours. The pipeline should run on demand and on a schedule, not on every change, and the corpus is versioned by date.
- **Licence review.** Every collected item needs its licence confirmed before it goes into the public artifact. Microcode and some `linux-firmware` blobs have their own redistribution terms, which allow redistribution but have conditions to record.
- **Vendor set access.** Some vendor images need accepting a licence to download. Those can be benchmarked locally but not shared, which limits how others can reproduce those numbers.

## Outcome

To be filled in when the work ends.
