# Supply-chain integrity of cdxgen's own releases

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4595 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

In March 2026 an attacker force-pushed almost every version tag of `aquasecurity/trivy-action` and `setup-trivy` to malicious commits, published a malicious Trivy binary, and later pushed malicious Trivy images ([Aqua Security](https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know), [Snyk](https://snyk.io/articles/trivy-github-actions-supply-chain-compromise/)). Pipelines pinned to tags picked up the change with no edit on their side. cdxgen bundles a Trivy build and other third-party helpers through cdxgen-plugins-bin, and cdxgen itself runs inside many pipelines, so both what it consumes and what it publishes need to be verifiable.

## Scope

The plan covers the helper downloads and vendored sources in cdxgen-plugins-bin, the runtime use of the post-build SBOMs that plugins-bin publishes, npm publishing for cdxgen, VEX documents for releases, and signing of the distributed binaries. It does not change how cdxgen scans other projects.

## Approach

Some protection exists already. Workflows pin actions by SHA, `scripts/thirdparty-downloads.sh` in plugins-bin pins downloads by SHA-256, and plugins-bin npm packages include a post-build SBOM. The first step adds what a digest cannot show: that the first copy came from the publisher. Where publishers offer signatures or attestations, version bumps check them, and vendored source trees record the upstream commit they came from. Both facts go into the post-build SBOM.

cdxgen can then read that SBOM at runtime and compare the helper on disk with it before running it (cdxgen/cdxgen#3772). npm [staged publishing](https://docs.npmjs.com/staged-publishing) adds a review step between building and making a version public (cdxgen/cdxgen#4101). VEX documents tell users which reported vulnerabilities in cdxgen's dependencies affect cdxgen (cdxgen/cdxgen#2367). Signed binaries need a signing identity that OWASP does not currently provide, so they come last (cdxgen/cdxgen#1608).

## Deliverables

### D1. Helper provenance (cdxgen/cdxgen-plugins-bin#137)

Version bumps check publisher signatures where they exist, vendored sources record their commit, and the post-build SBOM carries both.

### D2. Runtime use of post-build SBOMs (cdxgen/cdxgen#3772)

cdxgen checks a helper against the post-build SBOM before running it and reports a mismatch.

### D3. Staged npm publishing (cdxgen/cdxgen#4101)

A documented release flow that uses staged publishing for npm, with a note on how the Deno, GHCR and GitHub releases fit around it.

### D4. VEX for releases (cdxgen/cdxgen#2367)

Each release publishes a VEX document in a documented location.

### D5. Signed binaries (cdxgen/cdxgen#1608)

Distributed binaries are signed, with a documented way to verify them.

## Risks and open questions

Not every upstream publisher offers signatures, so D1 may only cover some helpers. Runtime checks in D2 must not slow down scans noticeably or break offline use. D5 depends on who holds the signing key, which is a maintainer and OWASP decision.

## Outcome

To be filled in when the work ends.
