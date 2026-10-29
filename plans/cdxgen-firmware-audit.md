# Firmware audit in cdxgen

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4637 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | See [cdxgen-firmware-corpus.md](cdxgen-firmware-corpus.md) |

## Why

A firmware SBOM becomes useful when it answers three questions: what in this image needs attention, which advisories apply to it, and which update fixes them. Firmware makes each question harder than it is for source projects:

- **Advisories do not reach SBOM matching.** EDK II publishes advisories as GitHub repository advisories ([GHSA-99cj-7hg9-mp4m](https://github.com/tianocore/edk2/security/advisories/GHSA-99cj-7hg9-mp4m) for CVE-2026-97631, for example), and EDK II has no package registry, so there is no purl ecosystem for scanners to match against.
- **OEM firmware is identified by product.** NVD describes it with product-specific CPEs (`cpe:2.3:o:<vendor>:<product>_firmware`), which cannot be derived from what is inside the image.
- **Fixes are backported.** Vendors fix modules without changing GUIDs or names, so a module being present is a reason to look, not a verdict.
- **Some serious problems are not version problems.** PKfail ([CVE-2024-8105](https://nvd.nist.gov/vuln/detail/CVE-2024-8105)) was a test platform key shipped in production. Debug builds, missing signatures, out-of-date revocation lists and network stacks left enabled are similar. They are visible in the image and need rules.

## Scope

In scope: a firmware rule pack, Secure Boot key and revocation list checks, the identifiers firmware components carry for vulnerability tools, VEX-ready facts, and LVFS metadata enrichment (cdxgen/cdxgen#1665).

Out of scope: vulnerability matching inside cdxgen. That stays with Dependency-Track, OWASP dep-scan and OSV-based tools, and this plan makes sure they have what they need. Verifying signatures against trust anchors at runtime is also out of scope, because that depends on the platform's configuration rather than the image.

## Approach

### Rules

Rules are YAML in `data/rules/firmware-security.yaml`, in the same JSONata-based format as the HBOM and OBOM packs, so `--bom-audit`, cdx-audit, dry-run mode and SARIF output work unchanged. Each rule is grounded in a fact the BOM already records, and none of them claims a vulnerability from module presence alone.

| Rule | Severity | Fact used |
| --- | --- | --- |
| EDK II network boot stack present | info | module GUIDs and names (PXE, HTTP boot, IP, UDP, DHCP, TFTP) |
| Debug or NOOPT build in a release image | medium | build target from debug paths |
| UEFI Shell or diagnostic applications present | medium | module identity |
| Unsigned capsule, or Authenticode digest mismatch | high | romi signature facts |
| Test or sample platform key (PKfail) | critical | `PK` and `KEK` certificate subjects and fingerprints |
| `dbx` behind the UEFI revocation list | medium | revocation list version or set difference |
| Only 2011 Microsoft UEFI CAs, without 2023 replacements | info | `db` and `KEK` certificates |
| RSA under 2048 bits or SHA-1 in Secure Boot databases | medium | certificate properties |
| No embedded SBOM | info | `cdx:firmware:sbomSource` absent everywhere |
| Content not inventoried | info | romi diagnostics |
| Embedded Linux: telnetd or root shell on a network service | high | extracted init scripts and inetd configuration |

Standards mappings use NIST SP 800-193 (platform firmware resiliency), NIST SP 800-53 (SI-7, CM-7, SC-12) and the EU Cyber Resilience Act's essential requirements where they fit.

### Identifiers for matching

| Component | purl | CPE |
| --- | --- | --- |
| EDK II module, release known | `pkg:github/tianocore/edk2@<tag>#<Package>/<Module>` | `cpe:2.3:a:tianocore:edk2:<version>`, with the version form confirmed against NVD's existing EDK II entries |
| EDK II module, release unknown | none | none |
| Vendor capsule or BIOS image | none | `cpe:2.3:o:<vendor>:<product>_firmware:<version>` only when LVFS or capsule metadata names vendor and product |
| Embedded CoSWID component | `pkg:swid/...` | from the tag, if present |
| Kernel, U-Boot, BusyBox | none, or distribution purl | standard CPEs |
| Microcode, CSME, AGESA | none | only where NVD uses a consistent pattern |

The plan also checks, with OWASP dep-scan and Dependency-Track maintainers, how EDK II repository advisories can be picked up, and opens issues there where they cannot.

### VEX-ready facts

Some rule results settle exploitability. If an image has no PXE or HTTP boot modules, an advisory in `UefiPxeBcDxe` cannot apply. cdxgen records these facts in a form from which a VEX `not_affected` statement with `vulnerable_code_not_present` can be generated, rather than writing VEX documents itself.

### LVFS metadata

The [LVFS metadata](https://lvfs.readthedocs.io/en/latest/metainfo.html) keys firmware releases by the ESRT and capsule GUIDs that cdxgen now reads, and lists vendor, product, version, urgency and fixed issues. Fetching it is opt-in, cached and signature-checked. Whether a snapshot may be bundled for offline use depends on the metadata's terms, which cdxgen/cdxgen#1665 checks first.

## Test cases

| Case | Input | Expected |
| --- | --- | --- |
| Network stack info | OVMF with and without `NETWORK_ENABLE` | rule fires only for the first |
| Debug build | OVMF DEBUG build | medium finding naming modules |
| PKfail | synthetic variable store with "DO NOT TRUST - AMI Test PK" | critical finding |
| Old dbx | variable store built from an older revocation list | medium finding with the gap |
| Microsoft CA rollover | OVMF `.ms.fd` stores of different ages | info finding where 2023 CAs are missing |
| Unsigned capsule | capsule built without signing | high finding |
| No embedded SBOM | plain OVMF, and OVMF with uSWID | rule fires only for the first |
| Identifier snapshot | all corpus images | purls and CPEs match the table above |
| Matching | `QEMU_EFI.fd` BOM through dep-scan | CVE-2026-97631 and PixieFail matched once their advisories are in its data |
| LVFS | recorded metadata fixture and an HBOM | vendor, product, latest version and fixed CVEs attached |

## Deliverables

### D1. Firmware rule pack (cdxgen/cdxgen#4638)

`firmware-security.yaml` with positive and negative fixtures for every rule, documented with the other packs.

### D2. Secure Boot keys and revocation lists (cdxgen/cdxgen#4639)

Certificates as cryptographic assets, and the PKfail, `dbx`, CA rollover and weak key rules.

### D3. Identifiers for vulnerability tools (cdxgen/cdxgen#4640)

The identifier table implemented and documented, confirmed against at least one matching tool, with VEX-ready facts.

### D4. LVFS metadata (cdxgen/cdxgen#1665)

Opt-in enrichment with vendor, product, latest release and fixed issues, after the licence and network questions are settled.

## Risks and open questions

- **Known-key lists need care.** A list of leaked or sample platform keys must cite a source for every entry, and must be easy to update without a release.
- **Revocation list licensing and freshness.** The UEFI revocation list is published by the UEFI Forum. Check whether it can be bundled, or whether only a digest and version can be, with the list fetched on demand.
- **NVD version forms.** If NVD's EDK II entries use inconsistent version strings, emitting the CPE may cause more confusion than it solves. In that case, the purl and the release property are enough, and the gap should be documented.

## Outcome

To be filled in when the work ends.
