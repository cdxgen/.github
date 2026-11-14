# cdxgen: internal package policy, options and BOM marking

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4836 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | Shared with [internal-packages-corpus.md](internal-packages-corpus.md) |

Part of [internal-packages.md](internal-packages.md), which defines the terms, the pattern grammar, the four rules and the policy levels used here.

## Why

Every lookup and package-tool change in this program asks one question: is this identifier internal, and may it go to this host? That question needs one answer, computed once per run from every source of patterns, available to code that has no `options` argument, and isolated per request in server mode. This epic builds that answer, the options that feed it on every cdxgen command, the BOM properties that record it, and the audit rules that turn it into findings without contacting anyone.

## Scope

In scope: a policy module in `lib/core/`, the options for `cdxgen`, `cdx-audit`, `evinse`, the REPL, server mode and the MCP server when it lands, detection of exclusive routes, the `cdx:pkg:internal` properties, the `internal-packages` audit rule pack, and user documentation. Out of scope: the call-site changes, which are in [internal-packages-lookups.md](internal-packages-lookups.md) and [internal-packages-tools.md](internal-packages-tools.md).

## Approach

The module is `lib/core/packagePolicy.js`. `createPackagePolicy(options, env)` builds a frozen object from the operator's options, the environment, pattern files, project configuration, a server request and detection, using the cdx-purl matcher. It exposes `isInternal(componentOrPurl)` returning the matched source kind or `undefined`, `isTrustedHost(hostOrUrl)`, `childEnv(baseEnv, tool)` for package tools, `recordSuppressed(ecosystem, reason)`, `recordRefused(host)` and `summary()` for the egress report and BOM metadata. `withPackagePolicy(policy, fn)` runs `createBom` inside an `AsyncLocalStorage` store, and `currentPackagePolicy()` returns the store's policy, or a policy built from the environment when called outside a run, as library users and tests do. Nothing writes the patterns to `process.env`.

The public host list is data, in `data/public-registry-hosts.json`: host, ecosystem and a URL decoder name. It is used to refuse trusting a base URL override that points at a public host, by the HTTP guard to decode identifiers, and by the egress report to label hosts.

The options follow the existing plumbing: `.option()` entries in `bin/cdxgen.js` (the `.env("CDXGEN")` call maps them to `CDXGEN_*`), classification in `PROJECT_CONFIG_OPTIONS` or `OPERATOR_ONLY_OPTIONS` in `lib/core/projectConfig.js` (the test in `projectConfig.poku.js` fails for an unclassified option), pattern bounding through `lib/core/globPatterns.js`, and the option builders in `lib/cli/cliOptions.js`. A project configuration may add patterns and raise the policy level; `operatorOptionChoice` already tells an operator value from a project value, and the merge must keep the stricter of the two.

## Deliverables

### T1. Policy module and pattern sources (cdxgen/cdxgen#4809)

`lib/core/packagePolicy.js` and `data/public-registry-hosts.json` as described in the Approach section of this plan, with the cdx-purl matcher behind them. Pattern files are read as UTF-8, with a byte order mark, CRLF, blank lines and `#` comments accepted. An invalid line is reported by line number and a reason, never by echoing its content, because a mistaken path could point at a file that should not be printed. `*` alone is accepted with a warning, an empty pattern is an error, and a pattern of fewer than three characters after folding is a warning. Trusted hosts come from `--internal-registry`, from base URL overrides that are not public hosts, and from the operator's registry configuration. Golang patterns are also exported in Go glob form for `childEnv`, appended to any `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB` already set, and existing values of those variables are imported as patterns with the source kind `goprivate`, replacing the separate matcher in `isPrivateGoModule`.

Done when the module passes the cdx-purl vectors through its own API, a test runs two policies concurrently inside `withPackagePolicy` and each sees only its own patterns, and a test shows `process.env` is unchanged after a run with patterns.

### T2. Options on the cdxgen command and in project configuration (cdxgen/cdxgen#4810)

Add `--internal-package-prefix`, `--internal-package-prefix-file`, `--internal-registry`, `--internal-package-policy`, `--no-internal-package-detect` and `--egress-report`, with the environment variables and project configuration rules in the umbrella plan's table. Patterns from every source are combined and nothing subtracts; a project configuration can raise the level from `safe` to `strict` but not lower it. Update `docs/CLI.md`, `docs/ENV.md`, the skill parameter table in `SKILL.md`, and run `pnpm gen-types`.

Done when tests cover each source alone and combined, the additive rule, the level merge, file parsing edge cases, and the classification test passes. Add a test that every `CDXGEN_INTERNAL_*` variable is listed in `docs/ENV.md`, since no test keeps that file in step today.

### T3. The same options on every other entry point (cdxgen/cdxgen#4811)

`cdx-audit` (`bin/audit.js`) accepts the same options, and `buildChildOptions` in `lib/audit/index.js` passes the policy into the `createBom` options it builds. `evinse` (`bin/evinse.js`) accepts the options and also reads the `CDXGEN_INTERNAL_*` variables, since its own prefix is `EVINSE_`. The REPL's `createBom` call in `bin/repl.js` runs inside the policy built from the environment. Server mode (`lib/server/server.js`) treats the operator's policy as a floor: `internalPackagePrefix` is added to `ALLOWED_PARAMS` as an additive, bounded list, `internalPackagePolicy` may only raise the level, the file, registry, detection and report options are not accepted from requests, and `lib/server/openapi.yaml` and `docs/SERVER.md` say so. When the MCP server from cdxgen#4656 lands, its tools take the same two request parameters with the same rules.

Done when a server test sends two concurrent requests with different patterns and each BOM is marked only by its own, a test shows a request cannot lower the operator's level or remove an operator pattern, and `cdx-audit` and `evinse` tests show the policy reaches a child `createBom`.

### T4. Detection of exclusive routes (cdxgen/cdxgen#4812)

Read the sources in the umbrella plan's detection table, for the project directory and, in a monorepo, every sub-project directory cdxgen visits, and add what they route as patterns with their source kind. Parsing reuses the existing readers where they exist (`lib/parsers/npmrc.js`, the uv and poetry parsers in `parsers-python.js`, Cargo.lock source kinds in `parsers-rust.js`, Gemfile.lock sections in `rubyutils.js`) and adds small readers for `.yarnrc.yml` `npmScopes`, `bunfig.toml` scopes, `nuget.config` `packageSourceMapping`, Pipfile `index`, `[[tool.pdm.source]]` and composer `repositories`. A mirror for every package, an npm `resolved` host, a `repository_url` qualifier or a Maven repository list is not a route and adds nothing. `--no-internal-package-detect` turns detection off. Each detected pattern is logged at debug level with its source file.

Done when each source has a fixture and a test, a monorepo test shows detection in a sub-project, and a test with an Artifactory-style default registry for every package shows no package marked internal.

### T5. BOM properties and hygiene (cdxgen/cdxgen#4813)

Add `cdx:pkg:internal` and `cdx:pkg:internalSource` to internal components, and count properties to BOM metadata (`cdx:pkg:internalCount`, `cdx:pkg:suppressedLookupCount`, `cdx:pkg:skippedToolCount`, `cdx:pkg:refusedRequestCount`). Read `cdx:pkg:internal` from input BOMs in `cdx-audit` and anywhere cdxgen loads a BOM it did not generate, with source kind `bom-input`. Document the properties in `docs/CUSTOM_PROPERTIES.md`, and note there that they are unrelated to cdxgen's `internal:` bookkeeping properties.

Done when a test generates a BOM with patterns whose text is distinctive and asserts that no pattern string and no trusted host appears anywhere in the BOM JSON, including formulation, metadata properties and annotations, and the same for the fidelity report.

### T6. Audit rules for dependency confusion exposure (cdxgen/cdxgen#4814)

A rule pack `data/rules/internal-packages.yaml`, loaded by `--bom-audit` and `cdx-audit`, that uses only what is in the BOM. Rules: an internal component resolved from a public registry according to its lockfile (high); an internal name without an exclusive route, such as an unscoped npm name with a public default registry (medium); a component whose folded name equals an internal pattern's literal prefix after replacing confusable characters (review). The lockfile evidence comes from properties cdxgen already writes (`internal:ResolvedUrl` for npm, `cdx:cargo:sourceKind` and `cdx:cargo:registry`, `cdx:pypi:registry` and `cdx:pypi:resolved`, `cdx:gem:remote`, `cdx:pub:registry`). Where an `internal:` property is the only record, as for npm, the deliverable adds a stable `cdx:` property, because `internal:` properties are not a stable interface. Document the rules in `docs/BOM_AUDIT.md`.

Done when each rule has a positive and a negative fixture, and a test shows the rule pack makes no network request.

### T7. User guide and registry-side guidance (cdxgen/cdxgen#4815)

A new `docs/INTERNAL_PACKAGES.md` that explains the patterns, the options, detection, the policy levels and the egress report, with recipes for npm scopes, NuGet source mapping, uv explicit indexes, Poetry sources, `GOPRIVATE`, Maven mirrors and remote repository filtering, and Gradle content filters. It covers the registry side (Artifactory exclude patterns on remote repositories, Nexus routing rules, Verdaccio `proxy` per package pattern), deleting the disk cache once after adopting patterns, mirroring the patterns into Dependency-Track's internal component settings, and passing them through dep-scan. Update `docs/ALLOWED_HOSTS_AND_COMMANDS.md`, `docs/THREAT_MODEL.md`, `docs/PERMISSIONS.md`, the agent skills in `agent-plugin/skills/` that set `FETCH_LICENSE` or install dependencies, and the sbom-fidelity-loop remediation catalog so that it never recommends removing repositories or installing without a route.

Done when the docs build, the profile and option documentation tests pass, and the fidelity loop has a test that its remediations for a project with internal names contain no step that routes them publicly.

## Risks and open questions

The default for detection and the property names are open questions in the umbrella plan. A second open question belongs here: whether `internalPackagePrefix` should be accepted from server requests at all. Accepting it lets a client protect its own names on a shared server, which is the reason to allow it; the bound on count and length keeps it from being used to slow the server down.
