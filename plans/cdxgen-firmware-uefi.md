# UEFI firmware SBOMs in cdxgen

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4626 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | See [cdxgen-firmware-corpus.md](cdxgen-firmware-corpus.md) |

## Why

UEFI firmware is the most privileged software on a PC or server, and its advisories come in waves that each need the same triage: LogoFAIL, PixieFail, PKfail and now CVE-2026-97631. Each time, the question "which of our images contain the affected module?" was answered by people opening images one at a time in UEFITool. A UEFI SBOM that lists every module with a trustworthy identity turns that into a query.

There is also a supply-chain reason. Under the [Firmware Embedded SBOM specification](https://sbomspec.osfw.foundation/), firmware vendors are starting to embed SBOM data in their images, and the LVFS already processes it. cdxgen should import that data faithfully and show where the vendor's statements and cdxgen's own analysis agree or differ.

## Scope

This plan covers how cdxgen turns romi's UEFI findings into a BOM: module components and identity, embedded SBOM import, silicon vendor blobs, blint deep analysis of extracted modules, and the link between image BOMs and host HBOMs. Parsing is romi's job ([romi-uefi-formats.md](romi-uefi-formats.md), [romi-firmware-identity.md](romi-firmware-identity.md)). Audit rules and vulnerability identifiers are in [cdxgen-firmware-audit.md](cdxgen-firmware-audit.md).

## Approach

### Identity, strongest first

romi reports every identity signal it finds with its source ([cdxgen/cdxgen-plugins-bin#152](https://github.com/cdxgen/cdxgen-plugins-bin/issues/152)). cdxgen picks the name and version from the strongest signal and keeps the rest as evidence:

| Rank | Signal | Gives | CycloneDX identity method |
| --- | --- | --- | --- |
| 1 | Embedded CoSWID tag (`.sbom` section or uSWID) | vendor's name, version, supplier, licence | `manifest-analysis` |
| 2 | CodeView debug path | EDK II release, package, module, build target | `binary-analysis` |
| 3 | Version section | build number, version string | `manifest-analysis` |
| 4 | User interface section | module name | `binary-analysis` |
| 5 | FFS GUID matched against the EDK II database | module name, package, releases containing it | `hash-comparison` |
| 6 | PE header and image hash | machine, subsystem, hash | `binary-analysis` |

Release names need normalising. Distributions write `edk2-2024.02`, while upstream tags are `edk2-stable202402`. A small, tested mapping turns one into the other for the purl `pkg:github/tianocore/edk2@<tag>#<Package>/<Module>`.

### Embedded SBOMs

CoSWID maps cleanly onto CycloneDX. The tag ID goes into the `swid` object, entities go to supplier, authors and publisher by role, links go to external references, and file entries become evidence occurrences. Imported data merges into the module component it describes, matched by the hash of the PE that carries it or by the file entries' hashes. Data that describes something cdxgen did not find becomes a nested component. Every field from the vendor is marked with `cdx:firmware:sbomSource`, and parity with `uswid --cyclonedx` is tested field by field.

### Platform blobs

Microcode, CSME, FSP, PSP, AGESA and option ROMs become `firmware` components with the silicon vendor as supplier and versions in the vendor's own notation. CPEs are added only where NVD uses a consistent pattern, which [cdxgen-firmware-audit.md](cdxgen-firmware-audit.md) settles.

### blint for deep analysis

With `--deep`, cdxgen runs `romi extract`, then blint once on the extracted module directory, and joins blint's metadata to module components by image hash. blint's firmware work ([owasp-dep-scan/blint#264](https://github.com/owasp-dep-scan/blint/issues/264)) supplies EFI-aware reviews and network module tags. cdxgen does not need blint's own unpacker, but the two unpackers are compared on the corpus.

### Linking images to hosts

FMP capsules carry an image type GUID equal to the ESRT GUID that a running host reports. cdx-hbom is adding the ESRT data to the firmware component ([cdxgen/cdx-hbom#22](https://github.com/cdxgen/cdx-hbom/issues/22)). cdxgen records the GUID and version on the image root and links host to image with a BOM-Link, comparing versions so that hosts behind the image show up as such.

## Test cases

| Case | Input | Expected |
| --- | --- | --- |
| PXE driver present | Ubuntu `qemu-efi-aarch64` 2024.02 `QEMU_EFI.fd` (`d2d1228a…cab43`) | `UefiPxeBcDxe`, GUID `B95E9FDA-26DE-48D2-8807-1F9107AC5E3A`, `device-driver`, release `edk2-2024.02`, purl `pkg:github/tianocore/edk2@edk2-stable202402#NetworkPkg/UefiPxeBcDxe` |
| Completeness | OVMF X64 RELEASE built from a pinned tag | module set equals `Guid.xref` |
| Network disabled | OVMF built with `NETWORK_ENABLE=FALSE` | no network-stack modules |
| Stripped build | OVMF built without debug directories | identity from UI name and GUID, lower confidence |
| CoSWID in PE | OVMF with a `.sbom` section added by python-uswid | merged component, vendor identity wins, source recorded |
| Multi-tag uSWID | volume with a three-tag uSWID blob, compressed with LZMA | three components imported |
| coreboot SBOM | coreboot QEMU build with uSWID enabled | coreboot components imported |
| Microcode | coreboot build with microcode | one component per update, with signature and revision |
| Option ROM | iPXE `efi-e1000.rom` (`2e100b3f…56d76`) | option ROM with PCI IDs and nested EFI driver |
| blint join | deep scan of `QEMU_EFI.fd` | blint subsystem and machine on `UefiPxeBcDxe`, matched by hash |
| HBOM link | HBOM from the AMI test host (ESRT `52bbf6bf-735d-4281-83ed-9f6848060100`, version 29) and a synthetic capsule BOM | link created, and version difference reported when versions differ |

## Deliverables

### D1. UEFI module components (cdxgen/cdxgen#4627)

Images, volumes and modules as components with ranked identity, evidence, hashes and EDK II purls where the release is known.

### D2. Embedded SBOM import (cdxgen/cdxgen#4628)

uSWID and CoSWID imported, merged with module components, and labelled by source.

### D3. Platform blobs (cdxgen/cdxgen#4629)

Microcode, CSME, FSP, PSP, AGESA and option ROMs as versioned components.

### D4. blint deep analysis (cdxgen/cdxgen#4630)

blint findings and metadata on module components in `--deep` runs.

### D5. Link to host HBOMs (cdxgen/cdxgen#4631)

ESRT GUID and version on images, and BOM-Links from host firmware components with version comparison.

## Risks and open questions

- **Vendor GUID reuse.** OEMs modify EDK II modules but keep their GUIDs, so GUID-based identity can name a module that differs from upstream. Identity confidence and the diagnostic for conflicting signals have to make this visible, and the audit plan must not treat GUID presence as a vulnerability.
- **Debug path availability.** Many vendor images strip debug paths, which leaves EDK II release unknown and purls absent. That is the honest result, but it limits automated matching for vendor firmware until vendors embed SBOMs.
- **Where linking lives.** HBOM-to-image linking could be a cdxgen option, a cdx-audit step or a cdxi command. cdxgen/cdxgen#4631 decides.

## Outcome

To be filled in when the work ends.
