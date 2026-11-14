# Internal package names stay inside the organization

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4840 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | Described in [internal-packages-corpus.md](internal-packages-corpus.md). The manifest `internal-packages.corpus.json` is added with the first item stored outside git. |

## Why

cdxgen, and the tools that run it, ask public services about the packages they find. A license lookup sends an npm name to registry.npmjs.org, a Go module path to pkg.go.dev, a Maven group and artifact to Maven Central, a crate name to crates.io and a NuGet ID to api.nuget.org. The package managers that cdxgen runs do the same. `go list` asks proxy.golang.org and sum.golang.org about every module missing from the module cache, `npm install` asks registry.npmjs.org about every scope that has no registry of its own, and Maven asks Central for any artifact that the configured repositories lack. None of these paths can tell a public package from one the organization built for itself, so the names of internal packages leave the network in the URLs, access logs and caches of services the organization has no agreement with.

Three problems follow from that. The first is disclosure: internal package names describe products, teams, customers and acquisitions, and many organizations have a policy or a contract that says they stay inside. The second is dependency confusion. When an internal name is unscoped and the resolver can fall back to a public registry, the public registry answers for a name that anyone can register, and a package manager that cdxgen runs to complete a dependency tree may install the impostor, install scripts included, as Alex Birsan showed in 2021 ([Dependency Confusion](https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610)). The third is accuracy. When a public package shares the internal name, cdxgen copies the public package's license, description, repository URL and provenance into the BOM, and the SBOM then describes a different piece of software.

The research behind this plan was done by AI agents in November 2026, against cdxgen at commit e5558a6c5, cdxgen-plugins-bin at c25bb43f, cdx-purl at 6769866, safer-exec at a578ce7 and dep-scan at 6c998ee. It found about thirty places where cdxgen's own code sends a package identifier to a public host, and more than twenty package-tool invocations that can do the same. Some protection exists already. Go lookups honour `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB` (`isPrivateGoModule` in `lib/ecosystems/ecosystems.js`), npm lookups follow `.npmrc` scoped registries (`npmLookupRegistry`), and cargo and pub lookups skip packages that come from other registries. There is no general way to tell cdxgen which names are internal, and the package tools receive no help at all: `go list` runs by default, outside the `--install-deps` gate, with whatever Go environment the user happens to have. cdxgen#743 shows the cost. Users who could not resolve private Maven dependencies were told that removing the `repositories` section from pom.xml made the error go away, which is the setup that leaks internal names to Central and invites dependency confusion.

OWASP dep-scan has a related option, `--private-ns` (`PKG_PRIVATE_NAMESPACE`), that works the other way round: its risk audit sends private names to npm, PyPI and crates.io on purpose, to report a private name that also exists in public. That check has value, but it cannot be the default for an organization whose rule is that internal names never leave.

## Scope

This plan adds one way to declare internal package names and makes every component that can contact a registry respect it. That means cdxgen's own HTTP lookups, the package managers and build tools that cdxgen runs, the helpers it starts from cdxgen-plugins-bin, the cdx-audit, evinse, REPL and server entry points, safer-exec's package-tool policies, and dep-scan's risk audit and its calls to cdxgen. It also adds BOM properties that mark internal components, audit rules that find dependency confusion exposure from local evidence alone, an egress report that tells a compliance reviewer which hosts a run contacted, and a corpus and test harness that show no internal name reaches a public host.

Some things are deliberately left alone. The BOM still lists internal components, because that is its purpose; `--exclude` and the existing filters remain the way to drop them. cdxgen does not proxy or rewrite registry traffic, and it cannot stop a private registry from forwarding an unknown name to its public upstream, which the documentation covers as registry configuration. Downstream consumers such as Dependency-Track send purls to their own analyzers; the documentation shows how to mirror the patterns into Dependency-Track's internal component settings. blint and the AppThreat vulnerability-db need no change: blint sends no package identifiers anywhere, and the vulnerability database is downloaded whole and searched locally.

## Terms

The plan uses four terms in a fixed sense.

- An **internal name** is a package identifier matched by at least one internal pattern, whichever source the pattern came from.
- A **trusted host** is a host the operator has said may receive internal names: an internal registry, mirror or forge. Every other host is untrusted, including all of the public registries and metadata services listed in `data/public-registry-hosts.json`.
- An **exclusive route** is configuration that sends a set of names to one registry and nowhere else, such as an npm scope mapped in `.npmrc`, a NuGet `packageSourceMapping` entry, a uv index marked `explicit = true` together with `tool.uv.sources`, or a Cargo dependency with `registry = "acme"`. A mirror that proxies every package, such as an Artifactory virtual repository set as the default npm registry, is not an exclusive route.
- A **package tool** is any program cdxgen runs that can resolve or download packages: npm, pnpm, yarn, bun, pip, uv, poetry, pdm, pipenv, pixi, mvn, gradle, sbt, go, cargo, bundle, composer, dotnet, swift, pod, docker and the helpers that run them.

## Approach

### Four rules

Every deliverable in this plan applies the same four rules.

1. An internal name is sent only to trusted hosts. The test is an allowlist, so a host nobody thought of, such as a CDN, a forge API or a new metadata service, does not receive internal names either.
2. Data fetched from an untrusted host is never applied to an internal component. This keeps a public look-alike's license, description and repository out of the BOM, and it holds for responses already sitting in cdxgen's disk cache from earlier runs.
3. A package tool run by cdxgen is either shown to be unable to resolve an internal name from an untrusted host, made unable to by configuration cdxgen injects for that run, or not run. Which of the three happens depends on the policy level.
4. The patterns and the trusted host list never appear in the BOM, the egress report, the fidelity report or any other file cdxgen writes for others to read. A BOM may list `@acme/billing`; it must not list every scope the organization owns.

### Patterns

A pattern is either typed or untyped.

A **typed pattern** starts with `pkg:` and a purl type, followed by the namespace and name in purl form, for example `pkg:npm/@acme/`, `pkg:maven/com.acme`, `pkg:pypi/acme-`, `pkg:golang/git.acme.corp/`, `pkg:cargo/acme_`, `pkg:nuget/Acme.`, `pkg:gem/acme-`, `pkg:composer/acme/`, `pkg:docker/acme/`, `pkg:github/acme-corp/` or `pkg:huggingface/acme/`. A version, qualifiers or a subpath make the pattern invalid. A Maven pattern may also be written `pkg:maven/com.acme:core`, which is read as `com.acme/core`. A typed pattern applies only to components of its type.

An **untyped pattern** has no `pkg:` prefix, for example `acme-` or `@acme/`, and applies to every type. It is compared with each component's canonical name for that component's type, after folding the pattern the same way as the name. For npm, an untyped pattern without a leading `@` is also compared with the scope, so `acme` matches `@acme/billing`, which keeps dep-scan's `--private-ns` values meaning what they mean today.

A pattern without `*` is a plain prefix: `acme-` matches `acme-billing`, and `com.acme` matches `com.acme.billing/core` and also `com.acmeinc/tools`. Matching more than intended is the safe direction, because the cost is a missing license rather than a leaked name, and the documentation shows how to anchor a pattern at a separator (`@acme/`, `com.acme.`, `git.acme.corp/`). A pattern with `*` is anchored at both ends, and `*` matches any run of characters including `/`. There is no `?`, no character class and no regular expression. The same matcher must behave identically in JavaScript, Python and, where needed, Go and Rust, and regular expression dialects differ between those languages and carry a denial-of-service risk when patterns come from a server request.

Before comparing, both sides are folded per type. Folding only ever makes more names equal, never fewer.

| Type | Canonical name | Folding |
| --- | --- | --- |
| npm | `@scope/name` or `name` | Percent-decode once (`%40` to `@`, `%2F` to `/`), lowercase |
| pypi | Project name | PEP 503: lowercase and replace runs of `-`, `_` and `.` with `-` |
| maven | `group/artifact` | Lowercase, although Central is case-sensitive |
| golang | Full module path | Decode the `!x` case escape used in proxy URLs, lowercase |
| cargo | Crate name | Lowercase, `_` to `-`, as crates.io does |
| nuget | Package ID | Lowercase |
| gem, composer, pub, hex, swift, cocoapods, conan | `namespace/name` or `name` | Lowercase |
| docker, oci | `namespace/name`, and `registry/namespace/name` when the registry is known | Lowercase, `docker.io/library/` removed |
| github, huggingface, generic and other types | `namespace/name` | Lowercase |

Unicode is not normalised beyond lowercasing, so a Cyrillic look-alike of an internal name does not match. That is correct for privacy, because the look-alike is a different name, and the audit rules below treat look-alikes as a separate finding.

The matcher, the folding rules and a set of shared test vectors live in cdx-purl. dep-scan carries a Python port that must pass the same vectors, pinned by digest. Go's `GOPRIVATE` syntax is narrower than ours, since `*` there stays inside one path element, so cdxgen converts golang patterns into Go globs that match at least as much, never less, and the vectors cover that conversion.

### Where patterns and trusted hosts come from

Patterns from every source are combined into one set. No source can remove a pattern that another source added, so a project configuration file or a server request can make a run stricter but never looser.

| cdxgen option | Environment variable | Project config (`.cdxgenrc` and friends) | Server request |
| --- | --- | --- | --- |
| `--internal-package-prefix <pattern...>` | `CDXGEN_INTERNAL_PACKAGE_PREFIX`, comma or newline separated | Allowed, adds patterns | Allowed, adds patterns, bounded in count and length |
| `--internal-package-prefix-file <path...>` | `CDXGEN_INTERNAL_PACKAGE_PREFIX_FILE` | Operator only | Not accepted |
| `--internal-registry <url-or-host...>` | `CDXGEN_INTERNAL_REGISTRY` | Operator only | Not accepted |
| `--internal-package-policy <metadata-only\|safe\|strict>` | `CDXGEN_INTERNAL_PACKAGE_POLICY` | May raise the level, never lower it | May raise the level, never lower it |
| `--no-internal-package-detect` | `CDXGEN_INTERNAL_PACKAGE_DETECT=false` | Operator only | Not accepted |
| `--egress-report <path>` | `CDXGEN_EGRESS_REPORT` | Operator only | Not accepted |
| `--internal-registry-only` | `CDXGEN_INTERNAL_REGISTRY_ONLY` | Operator only | Not accepted |

A pattern file is UTF-8 with one pattern per line. A byte order mark, CRLF line endings, blank lines and `#` comments are accepted. An empty pattern is an error rather than a silent match-all, and a pattern shorter than three characters after folding draws a warning. `*` on its own is allowed and means every package is internal, which turns off public metadata lookups for the whole run. Every command reads the `CDXGEN_INTERNAL_*` variables, including evinse, whose own options use the `EVINSE_` prefix, so one environment works for every entry point and for dep-scan.

Trusted hosts come from `--internal-registry`, from the base URL overrides cdxgen already reads (`NPM_URL`, `PYPI_URL`, `MAVEN_CENTRAL_URL`, `MAVEN_CENTRAL_MIRROR`, `NUGET_URL`, `RUST_CRATES_URL`, `RUBYGEMS_V2_URL`, `PUB_DEV_URL`, `GO_PKG_URL`, `PACKAGIST_URL`, `JSR_API_URL`) when they point at a host that is not on the public host list, and from the operator's own registry configuration (the user-level `.npmrc`, `pip.conf`, `settings.xml`, `NuGet.Config`, `.cargo/config.toml`). Hosts named only in the scanned project's files are used for routing the way they are today, but they are not trusted in secure mode or in server mode, where the project may be hostile.

With detection on, which is the default, cdxgen also reads exclusive routes from the project and the operator's configuration and treats the names they route as internal.

| Source | What becomes internal |
| --- | --- |
| `.npmrc` `@scope:registry=` (project and user) | The scope |
| `.yarnrc.yml` `npmScopes`, `bunfig.toml` `[install.scopes]` | The scope |
| `nuget.config` `packageSourceMapping` under a non-public source | Each `<package pattern>` |
| `pyproject.toml` `tool.uv.sources` pointing at an `explicit = true` index | Those packages |
| Poetry dependencies with `source` set to a source of priority `explicit` | Those packages |
| `[[tool.pdm.source]]` with `include_packages` | Those patterns |
| Pipfile packages with their own `index` | Those packages |
| Cargo dependencies with `registry =`, and Cargo.lock entries whose `source` is not crates.io | Those crates |
| Gemfile `source "..." do` blocks, and Gemfile.lock `GEM` sections whose `remote` is not rubygems.org | Those gems |
| composer.json repositories with `only` and `canonical` set | Those patterns |
| `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB` | Those Go globs |

Detection only adds patterns, and because the names it finds are routed to a private registry by construction, it never makes a package tool unsafe. A component's `repository_url` qualifier, an npm `resolved` URL or a Maven mirror that serves every package is a routing hint, not a sign that the package is internal. Treating it as one would mark every public package internal in an organization that mirrors everything.

### Enforcement in layers

No single check can see every request, so the rules are enforced at five places, and each one stops what the layer before it missed.

1. **Component gates.** The per-ecosystem functions that already decide whether a public registry can answer for a component (`npmLookupRegistry`, `canPypiServe`, `mavenRepositoryFor`, `isPrivateGoModule`, `canCratesIoServe`, `canPubRegistryServe` and the rest) ask the policy first. They hold the namespace and name in structured form, so the decision is exact. An internal component whose source registry is a trusted host is looked up there; otherwise it is not looked up at all.
2. **The fetch layer.** `prefetchJson`, `gatedGet`, `pooledDocument` and `fetchPomXml` in `lib/inventory/fetchBatch.js` and `lib/ecosystems/ecosystems.js` carry the identifier with each request and drop internal ones before batching, before the disk cache is read or written, and before a batch is handed to the cdxrs fetch helper, which sees only URLs.
3. **The HTTP client.** The `beforeRequest` hook of `cdxgenAgent` in `lib/core/activity.js`, which already enforces `CDXGEN_ALLOWED_HOSTS` and runs again on every redirect, decodes requests to known public registries with a small URL decoder per host and refuses any that name an internal package. This catches a call site that forgot to ask, and a private registry that redirects to a public CDN.
4. **Package tools.** Before cdxgen runs a package tool, a pre-flight check reads the tool's effective configuration and either shows that internal names are routed only to trusted hosts, injects configuration for this run that makes it so (Go privacy variables, a Maven repository filter, a Gradle init script with content filters), or skips the tool. The child environment is built per invocation and never by changing `process.env`.
5. **Helpers and sandboxes.** golem and rusi gain offline modes, cdxrs can refuse URLs that contain internal names as a backstop, and safer-exec keeps registry settings when it sandboxes a package tool, so that a run confined with `--internal-registry-only` can reach the trusted hosts and nothing else.

### Policy levels

`--internal-package-policy` sets how much a run gives up to keep internal names inside. It has an effect only when at least one pattern exists.

| Level | cdxgen's own lookups | Package tools | Name guessing and hash lookups | Run result |
| --- | --- | --- | --- | --- |
| `metadata-only` | Internal names suppressed | Run as today, with Go privacy variables injected and a warning for each unsafe tool | As today, except for names that match | Success |
| `safe` (default) | Internal names suppressed | Shown safe, made safe or skipped, with a degradation entry that says how to make the tool safe | Skipped for names that match | Success |
| `strict` | Internal names suppressed | As `safe` | Off: no PyPI lookups for names guessed from imports, no Maven Central SHA-1 searches for unidentified jars | Non-zero exit after the BOM is written if any tool was skipped or the HTTP guard refused a request |

`strict` is meant for CI jobs whose output is evidence for an auditor. The non-zero exit means either that a tool could not be made safe, so the BOM is incomplete, or that a call site reached the HTTP guard, which is a cdxgen bug worth reporting.

### What the BOM records

An internal component gets `cdx:pkg:internal` set to `true` and `cdx:pkg:internalSource` set to the kind of source that matched it (`operator`, `project-config`, `server-request`, `bom-input`, `npmrc-scope`, `yarnrc-scope`, `bunfig-scope`, `nuget-source-mapping`, `uv-index`, `poetry-source`, `pdm-source`, `pipfile-index`, `cargo-registry`, `gemfile-source`, `composer-repository` or `goprivate`). The pattern text itself is never recorded. BOM metadata carries counts only: internal components, suppressed lookups per ecosystem, package tools skipped and requests refused. `cdx-audit`, dep-scan and the cdxgen server read `cdx:pkg:internal` from an input BOM, so a BOM generated with patterns keeps its internal components private when another tool reads it later without them.

Audit rules in a new `data/rules/internal-packages.yaml` pack find dependency confusion exposure without asking anyone. An internal component whose lockfile says it was resolved from a public registry (an npm `resolved` URL on registry.npmjs.org, a Cargo.lock `source` of crates.io, a uv.lock or poetry.lock source on pypi.org, a Gemfile.lock section under rubygems.org) is a high finding, because the build already installed the public package. An internal name with no exclusive route, such as an unscoped npm package whose default registry is public, is a medium finding, because a resolver could fall back. A component whose name differs from an internal name only by a confusable character or a separator is reported for review.

### Commands and integrations

| Entry point | Change |
| --- | --- |
| `cdxgen` | All options above |
| `cdxgen --server` | Operator settings are the floor, a request may add patterns or raise the level, and each request has its own policy even when requests run concurrently |
| `cdx-audit` | Same options. The policy is passed into `buildChildOptions`, input BOM flags are honoured, and the allowlist is applied before registry enrichment rather than after |
| `evinse` | Same options, plus the `CDXGEN_INTERNAL_*` variables |
| `cdxi` (REPL) | Its `createBom` call carries the policy from the environment |
| MCP server (cdxgen#4656) | Same parameters as server mode, once it lands |
| cdxgen-plugins-bin helpers | Offline modes in golem and rusi, a URL backstop in cdxrs, egress tests for all helpers |
| safer-exec | The `gomod` policy keeps the user's Go privacy settings, and package-tool sandboxes keep registry settings |
| dep-scan | Reads and passes the same settings to cdxgen in every engine, and its risk audit skips internal names unless a public probe is requested explicitly |

## Order of work

The cdx-purl matcher and its vectors come first, because everything else calls them. The cdxgen policy core follows, with the options for every command and the BOM properties. Lookups and package tools can then proceed in parallel, one pull request per ecosystem group. The corpus and harness start with the core, so that each ecosystem change lands with a test that fails without it, and the ratchet test that classifies every outbound call site lands before the last lookup change, so that nothing is missed. The helper changes in cdxgen-plugins-bin ship in the release that cdxgen 13.9.0 depends on (milestone 4.4.0 at the time of writing). safer-exec's changes ship before cdxgen's `--internal-registry-only` option. dep-scan's changes need the cdxgen options to exist, but not to be released, since dep-scan can be tested against a cdxgen checkout.

## Deliverables

### D1. Purl pattern matcher and shared test vectors (cdxgen/cdx-purl#13)

A matcher API in cdx-purl (`compilePurlPatterns`, `matchesPurlPattern`), the folding rules from the Patterns section of this plan, and a JSON vector file with its schema. Done when the vectors cover every row of the folding table, the npm scope convenience, plain prefix and `*` patterns, invalid patterns, and golang-to-GOPRIVATE conversion, and cdx-purl releases 0.0.7 with the matcher.

### D2. cdxgen policy core, options and BOM marking (cdxgen/cdxgen#4836)

The plan: [internal-packages-policy.md](internal-packages-policy.md).

### D3. cdxgen metadata lookups and the egress report (cdxgen/cdxgen#4837)

The plan: [internal-packages-lookups.md](internal-packages-lookups.md).

### D4. Package tools run by cdxgen (cdxgen/cdxgen#4838)

The plan: [internal-packages-tools.md](internal-packages-tools.md).

### D5. Corpus, egress harness and CI (cdxgen/cdxgen#4839)

The plan: [internal-packages-corpus.md](internal-packages-corpus.md).

### D6. cdxgen-plugins-bin helpers (cdxgen/cdxgen-plugins-bin#198)

The plan: [internal-packages-plugins.md](internal-packages-plugins.md).

### D7. safer-exec: Go privacy settings in the gomod policy (cdxgen/safer-exec#16)

The built-in `gomod` policy sets `GOFLAGS=-mod=mod` and `GOPROXY=https://proxy.golang.org,direct` (`npm/src/policies/gomod.js:51-52`), which overrides a user's private proxy and sends every module path to the public proxy. The policy should keep `GOPROXY`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOSUMDB`, `GOINSECURE`, `GOTOOLCHAIN` and `GOFLAGS` from the caller when they are set, and fall back to the current values only when they are not. Done when a test runs the policy with `GOPRIVATE=git.example.invalid/*` and a private `GOPROXY` and shows both reach the child unchanged.

### D8. safer-exec: registry settings survive package-tool sandboxes (cdxgen/safer-exec#17)

safer-exec sanitises the child environment, so a package tool run inside it loses the variables and files that route internal names to private registries (`NPM_CONFIG_*`, `npm_config_*`, `PIP_*`, `UV_*`, `POETRY_*`, `PDM_*`, `PIPENV_*`, `CARGO_*`, `NUGET_*`, `BUNDLE_*`, `GEM_*`, `COMPOSER_*`, `MAVEN_OPTS`, `GRADLE_*`, and the Go variables `GOPROXY`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOSUMDB` and `GOFLAGS`, plus read access to `~/.npmrc`, `pip.conf`, `uv.toml`, `~/.m2/settings.xml`, `~/.gradle/init.d`, `~/.cargo/config.toml`, `NuGet.Config`, `~/.bundle/config` and `auth.json`). It then falls back to the public default, which is the leak this plan exists to prevent. A `registry-settings` preset for the policies that run package tools keeps them, without allowing the rest of the environment. Done when the npm, pip, Maven, Gradle, Go and Cargo policies keep a private registry setting in a test, and the preset is documented with the credentials it may expose to the sandboxed tool.

### D9. OWASP dep-scan (owasp-dep-scan/dep-scan#662)

The plan: [internal-packages-depscan.md](internal-packages-depscan.md).

## Edge cases and gotchas

These are the cases most likely to break an implementation, or to make a test pass while the leak stays. Each deliverable's issue repeats the ones that concern it.

### Names and matching

- **Derived names.** Several code paths ask about a name the project never mentioned. The PyPI lookup retries `django-<name>` after a 404 (`ecosystems.js:1658`), so an internal name is sent twice, and the derived name no longer matches `acme-`. DefinitelyTyped turns `@acme/billing` into `@types/acme__billing`, Scala appends `_2.13`, Gradle plugin markers become `<id>:<id>.gradle.plugin`, and Go major versions add `/v2`. The policy is always asked about the identifier the derivation started from.
- **Aliases.** An npm alias such as `"billing": "npm:@acme/billing@1.0.0"` puts `billing` in `node_modules` and `@acme/billing` in the lockfile. Both are checked, and a match on either is a match.
- **Names guessed from imports.** Without a manifest, or with `--deep`, cdxgen infers PyPI names from Python imports (`getPyModules` with `fetchDepsInfo`) and looks them up even when `FETCH_LICENSE` is off. An internal module `acme_billing` becomes a PyPI query, and a squatted package of that name would be recorded as the dependency. Guessed names are checked, and `strict` turns the lookups off.
- **Hashes of unidentified artifacts.** cdxgen searches Maven Central by SHA-1 for jars it cannot identify (`SEARCH_MAVEN_ORG`, on by default). Internal jars are the ones most likely to be unidentified. A jar whose file name, manifest or `pom.properties` matches a pattern is not searched, and `strict` turns the search off entirely.
- **Case and separators.** PyPI, crates.io, NuGet and Composer compare names case-insensitively or treat separators as equal. cdx-purl's own pypi rule is not PEP 503 (it does not collapse runs), and its cargo and nuget rules do not fold at all, so the matcher must apply its own folding rather than reuse purl normalisation.
- **Go case encoding.** Proxy URLs write uppercase letters as `!` plus the lowercase letter, so `git.acme.corp/Billing` appears as `git.acme.corp/!billing`. The URL decoder must undo that before matching. cdx-purl lowercases golang paths and splits `/v2` into the name, so the matcher must rejoin namespace and name.
- **Over-broad and empty patterns.** A trailing comma in dep-scan's `--private-ns` creates an empty entry that matches every package. An empty pattern is an error here, and a short one a warning.
- **Pattern scope of the root component.** The project being scanned may itself match a pattern. Its own metadata is then never looked up, which matters for npm and Maven roots.

### Routing and registries

- **Mirrors are not exclusive routes.** An organization that sends all npm traffic to Artifactory has every `resolved` URL on Artifactory. Marking those packages internal would remove public enrichment for every public package. Only exclusive routes become internal names.
- **Private registries forward to public upstreams.** A virtual repository that combines a local and a remote repository asks the public upstream about any name the local one lacks, including internal names that were never published. cdxgen cannot see that hop. The documentation shows the registry-side fix: Artifactory's exclude patterns on remote repositories, Nexus routing rules, and Verdaccio's `proxy` per package pattern.
- **The pip extra index.** `--extra-index-url`, in a requirements file or `PIP_EXTRA_INDEX_URL`, makes pip ask PyPI as well and take the highest version, which is the original dependency confusion setup. A requirements file can carry index options of its own, so the pre-flight check reads them.
- **uv's index strategy.** uv stops at the first index that has a name by default, which is safe, but `UV_INDEX_STRATEGY=unsafe-best-match` or `unsafe-first-match` restores pip's behaviour.
- **NuGet without source mapping.** dotnet asks every source about every package unless `packageSourceMapping` is set. cdxgen's restore passes `--ignore-failed-sources`, which quietly falls back to nuget.org when the private feed is down, so that flag is dropped whenever internal names are present.
- **Maven always has Central.** Unless settings.xml has a mirror with `mirrorOf` of `*` or `external:*`, Maven adds Central and asks it about artifacts the other repositories lack, including parent POMs and imported BOMs. Maven 3.9 added remote repository filtering, which can stop requests for groups that Central has never published; the tool deliverable must confirm the exact properties against the Maven versions in the corpus.
- **Gradle plugin markers.** Internal Gradle plugins resolve through `pluginManagement` repositories and the Gradle Plugin Portal, which settings-level and project-level content filters do not cover unless the init script handles `beforeSettings` as well.
- **Go toolchain and checksum database.** `GOPRIVATE` covers both the proxy and the checksum database, but a user who sets only `GONOPROXY` still sends paths to sum.golang.org. cdxgen sets `GONOSUMDB` and `GONOPROXY` as well as `GOPRIVATE`, appending to existing values rather than replacing them.
- **Unqualified image names.** An image reference such as `acme/app:1.0` in a Kubernetes manifest means Docker Hub. cdxgen follows manifest images (`isFollowableManifestImage` in `lib/managers/docker.js`), so an internal image without a registry host would be pulled from Docker Hub, which is dependency confusion for containers.
- **Private repositories on public forges.** An internal package hosted on github.com has a public owner and a private repository. The GitHub licence lookup would send `acme/billing-core` to api.github.com. That is skipped unless `github.com` is a trusted host, which an organization using GitHub Enterprise Cloud may choose with a token.
- **Lockfiles from untrusted projects.** In server mode, or when scanning a third-party repository, the project's `.npmrc` may route an internal scope to a host the operator does not know. Hosts named only in project files are not trusted in secure mode or server mode.

### Inside cdxgen

- **The cdxrs fast path.** cdxrs receives prepared URLs and makes its own requests with its own HTTP stack, so the agent's `beforeRequest` hook never sees them. Filtering must happen in `prefetchJson` before the handoff.
- **Server concurrency.** Some cross-cutting flags are bridged into `process.env` so that helpers without an `options` argument can read them (`--no-rust`, `--no-cache`). Doing that with patterns would let one server request's patterns leak into another's, or vanish halfway through. The policy lives in an `AsyncLocalStorage` store for the run, and child processes receive it in their own environment only.
- **cdx-audit builds fresh options.** `buildChildOptions` in `lib/audit/index.js` starts from defaults and passes none of the user's options, so the policy must be added explicitly. The predictive audit also enriches targets before it applies `--allowlist-file`.
- **The disk cache.** `<cacheDir>/cdxrs-fetch/<host>/<hash>.json` stores full URLs, including internal names queried by earlier runs, and CI systems often upload cache directories. Suppressed lookups neither read nor write it, and the documentation tells users to delete the cache once after adopting patterns.
- **Commands outside the install gate.** `go list -deps` and `clj -Stree` run whether or not `--install-deps` is set, and `cargo metadata` runs online under `--deep`. They need the pre-flight check as much as the install paths do.
- **The per-package pip path.** The `safe-pip-install` feature installs packages one at a time from an empty temporary directory (`pythonutils.js:1610-1630`), which drops the project's own index settings. Internal names are never installed that way.
- **Fidelity remediations.** The introspection report suggests fixes for a poor BOM. It must not suggest one that routes internal names to a public registry, such as removing Maven repositories or installing without a scoped registry. It suggests configuring the route instead.
- **Logs and traces.** `CDXGEN_TRACE_LOG` records the host and path of each HTTP request. With the policy in place, internal names never reach that log through cdxgen's own requests, but error messages from package tools may still print them, which is acceptable because logs stay with the operator.
- **Size limits.** A long pattern list in an environment variable can exceed Windows' 32,767 character limit or Linux's 128 KiB per variable. Large lists belong in a file, and dep-scan's container engine, which forwards only `CDXGEN_*` variables, must mount the file or inline a short list.

### Testing

- **Tests that pass because they saw nothing.** A harness that cannot see a request reports no leaks. Every leak test has a positive control: the same fixture without patterns must show the canary names in the recorded traffic, or the test fails.
- **Helpers that bypass the recorder.** eBPF URL tracing in safer-exec sees dynamically linked OpenSSL in Node, but not cdxrs (rustls), the Go toolchain, cargo or the JVM. Tests that use it must either route those through the hermetic harness or turn the fast path off with `CDXGEN_RS_DISABLE=fetch`.
- **Encodings.** A canary may appear lowercased, percent-encoded, PEP 503 folded, Go case-escaped, as a Maven path (`io/cdxcanary/internal`) or inside a JSON body. The scanner looks for all of them.
- **Real names in fixtures.** Canary names use the `cdxcanary` token and the reserved `.invalid` top-level domain, so a failing test leaks nothing real. Fixtures that test look-alike collisions use public names declared as internal and recorded responses, never live registries.

## Risks and open questions

- **Behaviour change from detection.** With detection on by default, packages routed by `.npmrc` scopes or explicit uv indexes lose public enrichment that they get today, which is the point, but a release note must say so. The maintainer decides whether detection is on by default in 13.9.0 or in 14.0.0.
- **dep-scan's `--private-ns`.** Its current meaning is "probe public registries for these names". The dep-scan plan recommends that it becomes an alias for internal patterns, with the probe moved behind an explicit option. That changes what existing users see, so it belongs in dep-scan 7.0.0, and the dep-scan maintainers decide.
- **Property names.** `cdx:pkg:` is a new cross-ecosystem property family. cdxgen already uses `internal:` for its own bookkeeping properties, which are a different thing, and the names must not be confused. The maintainer confirms the names before the policy deliverable merges.
- **Marking may itself be sensitive.** Some organizations may not want a BOM shared with customers to say which components are internal. If that comes up, a flag to leave the marking out can follow; it is not planned.
- **Maven repository filtering.** If the remote repository filter cannot be enabled reliably across the Maven versions users run, the Maven pre-flight can only verify `mirrorOf` and skip unsafe runs, which loses JVM fidelity for organizations without a full mirror.
- **Leak-free squatting checks.** A check for whether an internal name is registered publicly, done by downloading a full public name index (PyPI's simple index, the Go module index, a crates.io database dump) and searching it locally, would keep dep-scan's detection without sending names. It is not planned for 13.9.0.

## Outcome

Filled in when the work ends.
