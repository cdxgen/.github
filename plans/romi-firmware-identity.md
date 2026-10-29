# Embedded SBOMs and module identity in romi

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/150 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | See [cdxgen-firmware-corpus.md](cdxgen-firmware-corpus.md) |

## Why

Knowing where a module sits in an image is not the same as knowing what it is. Identity is what lets a firmware SBOM be matched against advisories, compared across vendors and versions, and checked against a vendor's own claims. Firmware offers several sources of identity, of very different strength, and romi has to collect all of them and say where each came from.

The strongest source is the vendor's own SBOM. The [Firmware Embedded SBOM specification](https://sbomspec.osfw.foundation/) (Open Source Firmware Foundation, draft 0.10, 2024) asks vendors to embed CoSWID tags (RFC 9393) in a `.sbom` COFF section of each PE binary, where Authenticode covers them, and to use uSWID containers, which have a 16-byte magic header and optional compression, everywhere else. The LVFS scans uploads for both. coreboot can write a uSWID file into CBFS. [python-uswid](https://github.com/hughsie/python-uswid) creates and converts them.

Where vendors have not embedded SBOMs, EDK II itself leaves useful traces: fixed module GUIDs, user interface names, version sections, and CodeView debug paths that name the source tree, release and package. Ubuntu's `UefiPxeBcDxe`, for example, carries `/build/edk2-Y5IMbl/edk2-2024.02/Build/ArmVirtQemu-AARCH64/RELEASE_GCC5/AARCH64/NetworkPkg/UefiPxeBcDxe/UefiPxeBcDxe/DEBUG/UefiPxeBcDxe.dll`.

## Scope

In scope: uSWID and CoSWID extraction and decoding, ranked identity signals per module, the EDK II GUID database and its generator, and signature facts on capsules and modules. Mapping to CycloneDX is cdxgen's job ([cdxgen-firmware-uefi.md](cdxgen-firmware-uefi.md)).

## Approach

### Embedded SBOMs

romi looks for `.sbom` sections in every PE and TE image it extracts, and for the uSWID magic in raw files, freeform sections, CBFS files and unparsed blobs. It decodes the uSWID header (version, flags, compression, payload count), decompresses with zlib or LZMA within limits, and decodes each CoSWID tag with `ciborium`. Each tag is reported with its location, its raw hash and every field cdxgen maps. Multi-tag payloads get explicit tests, because a real-world case of only the first tag being read has already been reported ([fwupd/fwupd#9980](https://github.com/fwupd/fwupd/issues/9980)).

### Identity signals

For each module, romi reports every signal with its source and a confidence: the CoSWID tag, the parsed debug path (tree, release, platform, target, toolchain, architecture, package, module), the version section, the UI name, the GUID database match, and PE header facts with the image hash. Conflicts, for example a GUID that the database knows by one name next to a UI section with another name, produce a diagnostic, because vendors do reuse EDK II GUIDs for modified modules.

### GUID database

A generator in `thirdparty/romi/tools/` reads EDK II's `.inf` files across `edk2-stable` tags and records, for each `FILE_GUID`, the base name, module type, `.inf` path and the tags containing it. It accepts other `.inf`-based trees such as Project Mu. The output is embedded in the binary, versioned, and named in every report. EDK II is BSD-2-Clause-Patent, so the derived data can be shipped, with a NOTICE entry. The database never says a module is vulnerable. It only says where a GUID came from.

### Signatures

FMP capsule authentication (PKCS#7), Authenticode on PE and TE images, Boot Guard and AMD Platform Secure Boot manifests where recognised, and FIT signature nodes (from the embedded Linux plan). romi reports chains, digest algorithms and whether the computed digest matches. Trust decisions are left to cdxgen's rules.

## Test cases

| Case | Input | Expected |
| --- | --- | --- |
| CoSWID in PE | OVMF module with a python-uswid `.sbom` section | tag decoded, location and signing status reported |
| uSWID variants | blobs with none, zlib and LZMA compression, and one and three tags | all tags decoded |
| coreboot SBOM | coreboot QEMU build with uSWID | tag decoded from CBFS |
| Parity | each corpus tag | same fields as `uswid --cyclonedx` |
| Debug path | Ubuntu `UefiPxeBcDxe` | release `edk2-2024.02`, package `NetworkPkg`, module `UefiPxeBcDxe`, target `RELEASE_GCC5` |
| Stripped module | OVMF without debug directories | identity from UI name and GUID database |
| Conflict | fixture with a known GUID but a different UI name | both reported, with a diagnostic |
| GUID database | generator run on a fake EDK II tree and on real tags | `B95E9FDA-26DE-48D2-8807-1F9107AC5E3A` maps to `NetworkPkg/UefiPxeBcDxe/UefiPxeBcDxe.inf` |
| Signed capsule | `GenerateCapsule` with EDK II test keys | chain reported, digest valid |
| Tampered module | signed module with one byte flipped | digest mismatch reported |

## Deliverables

### D1. uSWID and CoSWID extraction (cdxgen/cdxgen-plugins-bin#151)

### D2. Module identity signals (cdxgen/cdxgen-plugins-bin#152)

### D3. EDK II GUID database (cdxgen/cdxgen-plugins-bin#153)

### D4. Signatures (cdxgen/cdxgen-plugins-bin#154)

## Risks and open questions

- **Specification drift.** The Firmware Embedded SBOM specification is a draft. The uSWID header and the CoSWID profile may change, so the parser should accept known header versions and report unknown ones rather than guess.
- **Malformed CBOR.** CBOR decoders can be pushed into deep recursion or large allocations. Decoding needs explicit depth and size limits and its own fuzz target.
- **Database size.** Recording tags per GUID across years of releases grows the database. A compact encoding, for example tag ranges, keeps it small.

## Outcome

To be filled in when the work ends.
