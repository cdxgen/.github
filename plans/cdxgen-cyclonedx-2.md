# CycloneDX 2.0 adoption

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4589 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

CycloneDX [announced version 2.0](https://cyclonedx.org/news/cyclonedx-v2.0-coming-soon) on 5 August 2026, with Ecma approval expected in December. Every new capability is described as additive. Several of them describe data cdxgen already collects but can only express today through custom properties: attributed claims behind evidence, post-quantum migration details for cryptographic assets, and the declared behaviour of coding agents.

cdxgen/cdxgen#4054 bundled a pre-release 2.0 schema, generated a 2.0 validator and made 2.0 a generation target, so cdxgen can already write a valid 2.0 document. What it does not yet do is fill the new fields.

## Scope

The plan covers the bundled schema and validator, the spec-version compatibility layer in `lib/stages/postgen/specVersionCompat.js`, and the emitters for evidence, cryptographic assets and AI-BOM agent data. Output at 1.6 and 1.7 does not change. Threat models, privacy profiles, material provenance and commercial licensing are out of scope because cdxgen has no source for that data.

## Approach

The schema refresh waits for the published release. The field work can start against the bundled draft and is ordered by how much data cdxgen already holds. Evidence comes first, because identity evidence already records field, confidence, method and value, and the tools that made each determination are known. Cryptographic assets come next: the risk part of the migration details can be derived from algorithm, OID and key size, with targets from NIST [IR 8547](https://csrc.nist.gov/pubs/ir/8547/final), while owner and status are left empty because cdxgen cannot know them. Coding-agent behaviour follows the same secret-hygiene rules as the existing `cdx:agent:*` and `cdx:skill:*` properties.

Where a new 2.0 field carries what a `cdx:` property carried before, the property stays for older spec versions and the overlap is documented.

## Deliverables

### D1. Ratified schema (cdxgen/cdxgen#4590)

The bundled schema and generated validator match the published 2.0 release, and the unit and snapshot suites pass at `--spec-version 2.0`. Blocked until release.

### D2. Attributed claims (cdxgen/cdxgen#4591)

Identity and occurrence evidence are expressed as attributed claims at 2.0, naming the tool and technique.

### D3. Post-quantum migration details (cdxgen/cdxgen#4592)

Algorithm components carry a derived risk and target at 2.0, with the derivation documented.

### D4. Coding-agent declared behaviour (cdxgen/cdxgen#4593)

AI-BOMs describe the declared behaviour from instruction, skill and MCP files at 2.0, with no raw instruction text.

### D5. Default spec version decision (cdxgen/cdxgen#4594)

A recorded decision on when 2.0 becomes the default, based on consumer support and output differences.

## Risks and open questions

Field names may change between the draft and the ratified schema, which could force rework of D2 to D4; keeping the 2.0 emitters behind the spec-version switch limits the impact. Consumers such as Dependency-Track may take time to accept 2.0 uploads, which is the main input to D5.

## Outcome

To be filled in when the work ends.
