# cdxgen: metadata lookups and the egress report

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4837 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | Shared with [internal-packages-corpus.md](internal-packages-corpus.md) |

Part of [internal-packages.md](internal-packages.md). The policy object used here comes from [internal-packages-policy.md](internal-packages-policy.md).

## Why

cdxgen asks public registries and metadata services about packages in about thirty places. Most of them already have a gate function that decides whether a public registry can answer for a component, and those gates are where an exact decision can be made, because they hold the namespace and name in structured form. The rest need a second line of defence at the fetch layer and in the HTTP client, because a forgotten call site, a redirect or the cdxrs fast path would otherwise get through.

## Inventory

The table lists every call site found in cdxgen at e5558a6c5 that sends a package identifier, with the gate that decides it today. Paths are under `lib/`. META means `shouldFetchPackageMetadata()` (`FETCH_LICENSE` or `CDXGEN_FETCH_PKG_METADATA`), FL means `FETCH_LICENSE` only.

| Ecosystem | Call site | Host and identifier | Trigger | Gate today | Gap |
| --- | --- | --- | --- | --- | --- |
| npm | `getNpmMetadata`, `ecosystems/ecosystems.js:533` | `NPM_URL` or registry.npmjs.org, `.npmrc` scope registry, or the tarball's registry; scope and name | META; also `--bom-audit` and cdx-audit | `npmLookupRegistry` :358, `npmMetadataComplete` :430 | Unscoped packages ignore a private `resolved` host and the `.npmrc` `registry=` line; several callers pass no `npmrcConfig` |
| Deno and JSR | `getJsrMetadata`, `ecosystems/denoutils.js:592` | npm.jsr.io and api.jsr.io; scope, name, version | META | Components with `cdx:deno:jsrKey` only | No name check |
| Maven POM | `getMvnMetadata` :1160, `composePomXmlUrl` :1291, `pooledDocument` :1332, `fetchPomXml` :1393, parent chain `loadPomChain` :899 | Central or `MAVEN_CENTRAL_MIRROR`, maven.google.com for Android groups; group, artifact, version and the parent's coordinates | FL | `mavenRepositoryFor` :738 skips own modules, snapshots and `file:` repositories | A private `repository_url` is ignored and the lookup goes to Central |
| Jar SHA-1 | `extractJarArchive`, `ecosystems.js:3407-3437` | central.sonatype.com search; SHA-1 | On by default for unidentified jars (`SEARCH_MAVEN_ORG`) | Skipped when the manifest, `pom.properties`, path or local index identifies the jar | Internal jars are the likeliest to be unidentified |
| PyPI | `getPyMetadata` :1599 | `PYPI_URL` or pypi.org; name and version, then `django-<name>` after a 404 (:1658) | META, and `fetchDepsInfo` from `getPyModules` (`pythonutils.js:603`) under `--deep` or without a manifest | `canPypiServe` :1489, `pypiAnsweredLocally` :1528 | Names guessed from imports; the `django-` retry; a requirements file `--index-url` is not recorded |
| Go | `getGoPkgLicense` :2431, `getGoPkgVCSUrl` :2489 | `GO_PKG_URL` or pkg.go.dev; module path and version | FL, `GO_FETCH_VCS` | `isPrivateGoModule` :2662 (GOPRIVATE family), main module and local `replace` | Patterns other than the Go variables |
| Cargo | `getCratesMetadata` :2750 | `RUST_CRATES_URL` or crates.io, plus `/owners` in audit; name | FL, cdx-audit | `canCratesIoServe` :2710 | Internal crates declared without `registry =` |
| Dart | `getDartMetadata` :3037 | `PUB_DEV_URL` or pub.dev; name and version | FL | `canPubRegistryServe` (`parsers-misc.js:92`), `pubHostedRegistry` :3012 | No name check |
| NuGet | `getNugetMetadata` :4157, `queryNuget` :3849 | `NUGET_URL` or api.nuget.org; lowercased ID | FL | Local nuspec files only | No `nuget.config` awareness |
| RubyGems | `getRubyGemsMetadata`, `ecosystems/rubyutils.js:1152` | `RUBYGEMS_*` or rubygems.org; name and version | FL | Project gem, GIT and PATH sections skipped | Gems from a private `remote:` still go to rubygems.org |
| Elm | `ecosystems/parsers-elm.js:688` | package.elm-lang.org; author, name, version | META | Semver versions, missing fields only | No name check |
| Terraform | `ecosystems/terraformRegistry.js:68` | registry.terraform.io, api.opentofu.org; namespace, name, version | META | Public registry addresses only | No name check for public addresses with an internal namespace |
| CocoaPods | `fullScanCocoaPod`, `ecosystems/parsers-misc.js:4301` | The pod's `:git` host, github.com rewritten to raw.githubusercontent.com; repository and pod name | On by default (`COCOA_FULL_SCAN`) | `:path` and `:podspec` pods read locally | Internal pods on github.com |
| Swift and GitHub licences | `ecosystems.js:191`, `getRepoLicense` :2268 | api.github.com; owner and repository taken from registry documents and lockfiles | Same as the caller | github.com URLs only, error and quota pauses | Private repositories of internal packages |
| Purl as source | `registryLookupForPurl`, `inventory/source.js:1472` | npm, PyPI, RubyGems, crates.io, pub, Packagist, Maven; full coordinates, followed by a git clone | `cdxgen pkg:...`, server mode, predictive audit | None | No name check |
| Audit enrichment | `audit/targets.js:438`, `buildRegistryMetadataCandidate` :394 | npm, PyPI, crates.io; every versioned purl in the input BOM | cdx-audit unless `--dry-run` | Trusted-publishing components skipped | No `npmrcConfig`; runs before `--allowlist-file` is applied |
| Hugging Face | `ecosystems/remote/huggingface.js:705-738` | huggingface.co; repository ID and revision | Opt-in (`--ai-huggingface-remote`) | None | Internal model IDs |
| Manifest images | `isFollowableManifestImage`, `managers/docker.js:1151` | The image's registry, Docker Hub when unqualified | Images named in compose or Kubernetes files | `CDXGEN_ALLOWED_HOSTS` | Unqualified internal images |

Three shared layers sit under these call sites: `prefetchJson` (`inventory/fetchBatch.js:606`), `gatedGet` (:1513) and the rate layer, which every registry and GitHub lookup passes through on both transports; the cdxrs fetch helper, used when installed unless dry run, secure mode or `CDXGEN_ALLOWED_HOSTS` is set (`cdxrsMayFetch` :675); and `cdxgenAgent` (`core/activity.js:1096`), whose `beforeRequest` hook (:1110-1195) runs before the in-memory cache and again on every redirect.

## Approach

Each gate calls `currentPackagePolicy().isInternal(component)` first. An internal component is looked up only when the registry it came from is a trusted host, and then only there; otherwise the gate records a suppressed lookup and returns. The fetch layer takes an optional `identifier` with each request, `{ type, namespace, name }` in purl form, and drops internal ones before batching, before reading or writing the disk cache, and before handing a batch to cdxrs. The HTTP guard decodes requests to hosts in `data/public-registry-hosts.json` with one small decoder per host (npm packument paths, PyPI JSON paths, Maven repository paths, Go proxy and pkg.go.dev paths with `!` case escapes, crates.io API and sparse index paths, NuGet registration and flat container paths, RubyGems API paths, pub.dev, Packagist, JSR, the GitHub repository API, the Hugging Face API, OCI distribution paths) and refuses a request that names an internal package. A refusal is counted and logged at warning level with the host and ecosystem, never with the name; in `strict` it also fails the run once the BOM is written.

## Deliverables

### T1. Fetch layer filter and HTTP guard (cdxgen/cdxgen#4816)

The `identifier` field on `prefetchJson`, `gatedGet`, `pooledDocument` and `fetchPomXml` requests, the filter before batching, caching and the cdxrs handoff, the URL decoders and the `beforeRequest` refusal, including on redirects. Done when a unit test per decoder shows it extracts the identifier from real URL shapes, a test shows a refused request never reaches cdxrs, the disk cache or the network, and a redirect from a trusted host to a public URL naming an internal package is refused.

### T2. npm, Deno, JSR, Bun and caxa (cdxgen/cdxgen#4817)

Policy checks in `npmLookupRegistry` and every caller of `getNpmMetadata` (`parsers-js.js`, `cli/jsBom.js`, `bunutils.js`, `caxa.js`, `audit/targets.js`), with `npmrcConfig` passed everywhere it is missing today. An internal unscoped package whose `resolved` host is trusted is looked up there; otherwise it is skipped. npm aliases are checked under both names. `getJsrMetadata` checks the JSR scope and name. Done when fixtures cover a scoped internal package, an unscoped one, an alias, a `private: true` root and a workspace package, each with and without a trusted host.

### T3. Python (cdxgen/cdxgen#4818)

Policy checks in `canPypiServe`; the `django-` retry asks the policy about the original name and is skipped for internal names; `getPyModules` skips guessed names that match, and `strict` turns off lookups for guessed names entirely; `--index-url` and `--extra-index-url` lines in requirements files are recorded as `cdx:pypi:registry` so that the routing and audit rules can see them. Done when fixtures cover a requirements file with an internal name, an import-only project with an internal module, a uv project with an explicit index, and the `django-` retry.

### T4. JVM: POMs, parent chains and jar hashes (cdxgen/cdxgen#4819)

Policy checks in `mavenRepositoryFor` and `loadPomChain`, so neither an internal artifact nor its internal parent is fetched from Central; a component whose `repository_url` is a trusted host is fetched from there. Android and Google groups follow the same rule. The jar SHA-1 search skips jars whose file name, manifest `Implementation-Vendor-Id`, `Bundle-SymbolicName` or `pom.properties` group matches a pattern, and `strict` turns the search off. Done when fixtures cover an internal dependency with an internal parent POM, a component from a trusted Nexus, and an unidentified internal jar under each policy level.

### T5. Go, Cargo, Dart, NuGet, RubyGems, Elm, Terraform and CocoaPods (cdxgen/cdxgen#4820)

`isPrivateGoModule` is replaced by the policy, which already imports the Go variables. `canCratesIoServe`, `canPubRegistryServe`, the NuGet loop, the RubyGems lookup list (which also learns to skip gems from a non-rubygems.org `remote`), the Elm target filter, the Terraform address check and the CocoaPods podspec fetch ask the policy. Done when each ecosystem has a fixture with an internal package and a test that shows no request for it, and the existing GOPRIVATE tests still pass.

### T6. GitHub licences, forges, Hugging Face and manifest images (cdxgen/cdxgen#4821)

`getRepoLicense` and its batch skip owner and repository pairs that belong to internal components, or that match a `pkg:github/` pattern, unless the forge host is trusted. The forge enricher and future GitHub Actions lookups (cdxgen#4733) use the same check. Hugging Face remote lookups skip IDs that match `pkg:huggingface/` patterns. `isFollowableManifestImage` refuses internal images whose registry is public or missing. Done when fixtures cover each case.

### T7. Purl as source and cdx-audit (cdxgen/cdxgen#4822)

`registryLookupForPurl` refuses internal purls unless the registry is trusted, for `cdxgen pkg:...`, server requests with a purl `url`, and predictive audit targets, and the refusal is a clear error rather than an empty BOM. `audit/targets.js` honours `cdx:pkg:internal` from the input BOM, passes `npmrcConfig`, and applies `--allowlist-file` before enrichment instead of after. Done when cdx-audit on a BOM with internal components makes no request for them, and `cdxgen pkg:npm/%40acme/billing@1.0.0` with a matching pattern exits with the refusal message.

### T8. Egress report (cdxgen/cdxgen#4823)

`--egress-report <path>` writes JSON with the cdxgen version, the policy level, whether detection was on, the number of patterns by source kind, every host contacted with a request count and its label from the public host list, suppressed lookups by ecosystem and reason, skipped and modified package tools, and refused requests by host. It contains no package names, patterns or trusted host names beyond those contacted. The same counts go into BOM metadata, and a one-line summary is printed at the end of a run that has patterns. The report records cdxgen's own requests and the tools it ran; it does not claim to know what a package tool contacted unless the tool ran under `--internal-registry-only`, in which case the safer-exec proxy log supplies the hosts. Done when a test validates the report against a JSON schema in `data/` and shows it contains no canary names.

## Risks and open questions

The HTTP guard's decoders must keep up with registries that change their URL shapes. A decoder that fails to parse a URL lets the request through with a debug log rather than refusing it, because refusing unparseable URLs would break public lookups. Under `strict` the trade goes the other way and an unparseable request to a public registry host is refused. The ratchet test in the corpus plan and the gates are the primary defence, and the guard is the backstop.
