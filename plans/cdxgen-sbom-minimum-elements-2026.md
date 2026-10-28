# SBOM minimum elements 2026

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4585 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

Two sets of public requirements for SBOM contents changed in 2026. CISA published the [2026 Minimum Elements for a Software Bill of Materials](https://www.cisa.gov/resources-tools/resources/2026-minimum-elements-software-bill-materials-sbom) on 29 July 2026, replacing the NTIA 2021 elements. It adds an author signature, the data format name and version, generation context, the tool name and version, an SBOM version, component hashes with their algorithm, and component licenses. In May 2026 CISA and G7 partners published minimum elements for AI SBOMs. In the EU, the Cyber Resilience Act ([Regulation (EU) 2024/2847](https://eur-lex.europa.eu/eli/reg/2024/2847/oj)) requires an SBOM in a machine-readable format and lets the Commission specify its format and elements through implementing acts.

Users producing SBOMs for procurement or regulatory purposes need to know whether a cdxgen BOM meets these baselines, and cdxgen should meet them by default where it has the data.

## Scope

The plan extends the compliance engine in `lib/validator/complianceRules.js` and `lib/validator/complianceEngine.js`, which already holds SCVS rules and eight CRA rules, and closes gaps in the BOMs cdxgen generates: tool records in `metadata.tools` and formulation. It does not add a new output format, and it does not sign BOMs automatically; signing stays an explicit `cdx-sign` step.

## Approach

Each CISA element maps onto a CycloneDX field: authors, tools, lifecycles for generation context, version and serial number, component hashes, licenses and dependencies. The signature element maps onto the JSF signature that `cdx-sign` writes. The rules follow the pattern of the existing CRA rules, with their own standard key and ID prefix, and each rule names the cdxgen flag or command that fixes a failure. Running the new profile over default cdxgen output shows which elements cdxgen leaves empty, and those findings drive the `metadata.tools` and formulation deliverables.

The AI SBOM mapping starts as documentation that places each published element in a cdxgen AI-BOM, then turns the checkable elements into rules. The CRA deliverable waits for the implementing act and adjusts the existing CRA rules to it, using BSI TR-03183-2 as the reference until then.

## Deliverables

### D1. CISA 2026 rule set (cdxgen/cdxgen#4586)

`cdx-validate` can run the profile, every rule has passing and failing fixtures, and the docs list each rule with the field it reads.

### D2. Complete tool records (cdxgen/cdxgen#598)

Helpers and build tools that contributed to a BOM appear in `metadata.tools.components` with name and version.

### D3. AI SBOM mapping (cdxgen/cdxgen#4587)

A documented mapping from the CISA and G7 AI SBOM elements to AI-BOM fields, and rules for the checkable ones.

### D4. CRA implementing act (cdxgen/cdxgen#4588)

The CRA rules match the adopted act. Blocked until the act is published.

### D5. Formulation by default in CI (cdxgen/cdxgen#859)

Formulation is included when `CI` is set and for the BOM types named in the issue, so generation context is present without a flag.

### D6. Formulation components (cdxgen/cdxgen#740)

`formulation.components` carries the build tools and inputs cdxgen can identify for the ecosystems listed in the issue.

## Risks and open questions

The CISA document is guidance, and its elements may be read differently by different consumers; the rules should cite the element they implement so users can judge. The date and content of the CRA implementing act are not known. Making formulation the default changes BOM size and contents in CI, which may surprise existing users, so the change needs release notes.

## Outcome

To be filled in when the work ends.
