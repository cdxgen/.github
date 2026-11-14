# cdxgen: package tools that can resolve internal names

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4838 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | Shared with [internal-packages-corpus.md](internal-packages-corpus.md) |

Part of [internal-packages.md](internal-packages.md). The policy object and `childEnv` come from [internal-packages-policy.md](internal-packages-policy.md).

## Why

The package tools that cdxgen runs to complete a dependency tree contact registries on their own, with whatever configuration the user's machine has. Every one of them goes through `safeSpawnSync` (`lib/core/fs.js:1168`), which passes `options.env` or `process.env` through unchanged and injects nothing that keeps a name private. Some of them run whether or not `--install-deps` is set: `go list -deps` and `go mod graph` (`lib/cli/nativeBom.js:473`, `:559`) run for every Go project, `clj -Stree` (`nativeBom.js:2298`) is not gated at all, and `cargo metadata` runs online under `--deep`. A tool that resolves an internal name from a public registry both leaks the name and may install the wrong package.

## Inventory

The table lists the tool invocations found in cdxgen at e5558a6c5, the trigger, and how an internal name escapes. Paths are under `lib/`.

| Tool | Where | Trigger | How an internal name escapes |
| --- | --- | --- | --- |
| npm, pnpm, yarn install | `cli/jsBom.js:710` | `--install-deps` without a lockfile, up to `NPM_INSTALL_COUNT` manifests | A scope with no `@scope:registry` goes to registry.npmjs.org; unscoped names always go to the default registry |
| rush install | `cli/jsBom.js:1076` | rush.json without installed modules | As npm, through pnpm |
| `npm install` for `-t node<version>` | `stages/pregen/pregen.js:1500` | That project type, not secure mode | As npm |
| uv sync, poetry, pdm, pixi, rye, pipenv | `ecosystems/pythonutils.js:649-1042`, `cli/managedBom.js:677` | `--install-deps`, with `--deep` or an empty tree | Each tool's index configuration, with PyPI as the fallback; `UV_INDEX_STRATEGY=unsafe-*` |
| pip install -r, uv pip install | `pythonutils.js:1097` | As above | `--extra-index-url` in the requirements file or `PIP_EXTRA_INDEX_URL` |
| Per-package pip install | `pythonutils.js:1630` | `safe-pip-install` feature flag | Runs from an empty temporary directory, so the project's index settings are lost |
| mvn (cyclonedx plugin, dependency:tree, copy-dependencies) | `cli/jvmBom.js:989-1184`, `deps.js:154`, evinse | pom.xml with tooling allowed | Central is asked about anything other repositories lack unless a mirror covers `*` |
| gradle | `ecosystems/gradleutils.js:623`, `cli/jvmBom.js:2060` | `--install-deps` | `mavenCentral()` and the plugin portal without content filters |
| sbt, mill, bazel, scala-cli, lein | `cli/jvmBom.js:2384-3048`, `ecosystems/sbtutils.js`, `scalacliutils.js:333`, `nativeBom.js:2230` | Tooling allowed | Coursier, rules_jvm_external and Leiningen fall back to Central or Clojars |
| clj -Stree | `cli/nativeBom.js:2298` | Not gated | Clojars and Central |
| go list, go mod graph, go mod why | `cli/nativeBom.js:319-616` | Default for Go projects | proxy.golang.org and sum.golang.org unless the Go privacy variables are set |
| golem | `ecosystems/golem.js:1812` | evinse for Go | Runs `go list` through go/packages, as above |
| cargo metadata, check, generate-lockfile; rusi | `cli/nativeBom.js:864`, `:1260`; `ecosystems/rusi.js:858` | `--deep`, `--install-deps` without a lockfile, evinse for Rust | crates.io for crates without `registry =` |
| bundle install, gem install | `cli/managedBom.js:1569`, `stages/pregen/envcontext.js:1864-1936` | Gemfile without a lock | Gems outside a `source` block, or several global sources |
| composer update | `cli/managedBom.js:1313` | No composer.lock | packagist.org unless disabled |
| dotnet restore, nuget restore, msbuild restore | `cli/managedBom.js:2044` | No assets file or lockfile | Every source is asked about every package; `--ignore-failed-sources` falls back to nuget.org when the private feed fails |
| swift package, swift build | `cli/nativeBom.js:2553-2663`, `evinser/swiftsem.js:143` | Swift tooling allowed, evinse | A configured package registry without a scope mapping |
| pod install | `cli/nativeBom.js:2798` | No Podfile.lock | The trunk CDN for pods without a private spec repository |
| docker, podman, nerdctl pull | `managers/docker.js:1438` | `-t docker`, manifest images | Unqualified names resolve to Docker Hub |

kosi, atom, dosai, sourcekitten, osquery, blint, trivy-cdxgen and the poetry and pdm `export` commands resolve nothing remotely and need no change beyond the egress tests in the plugins plan.

## Approach

A pre-flight function per tool family, in `lib/core/packageTools.js`, takes the project directory, the tool, its arguments and the policy, and returns one of three verdicts: `safe` (configuration already routes every internal name to a trusted host or the tool resolves nothing remotely), `made-safe` (with the environment, arguments or generated files that make it so for this run), or `unsafe` (with a reason and a remediation in words a user can act on). `safeSpawnSync` calls it whenever a policy has patterns. Under `metadata-only` an unsafe tool runs with a warning; under `safe` and `strict` it is skipped and recorded with `recordDegradation`, so the fidelity report says what is missing and how to fix the route. Under `strict`, a skipped tool also makes the run exit non-zero after the BOM is written. Generated files go in cdxgen's temporary directory and are removed afterwards, and the child environment is built for that one invocation.

The pre-flight checks read the tool's effective configuration rather than guessing it. They prefer asking the tool (`npm config get`, `pip config list`, `go env -json`, `dotnet nuget list source`), fall back to reading the user and project configuration files, and treat a check they cannot complete as `unsafe` rather than `safe`.

## Deliverables

### T1. Pre-flight framework and child environments (cdxgen/cdxgen#4824)

`lib/core/packageTools.js`, the hook in `safeSpawnSync`, verdict recording, degradation entries with remediations, the `strict` exit, and gating for the commands that bypass `--install-deps` today (`clj -Stree`). Done when a test with a stub tool shows each verdict under each policy level, a test shows `process.env` unchanged after a `made-safe` run, and the fidelity report lists a skipped tool with its remediation.

### T2. Go (cdxgen/cdxgen#4825)

`go list`, `go mod graph`, `go mod why` and the golem launch get `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB` from `childEnv`, appended to any values the user set, which makes them `made-safe` for every internal module path. Nothing else in the Go environment changes: `GOFLAGS=-mod=mod` is not an offline setting and is not set. Done when the hermetic harness shows `go list` on a fixture with internal modules sends no request naming them to the proxy or the checksum database, and a positive control without patterns shows that it does.

### T3. JavaScript package managers (cdxgen/cdxgen#4826)

Pre-flight for npm, pnpm, yarn (classic and berry), bun, rush and the `-t node<version>` install. A scoped internal pattern is safe when the effective configuration maps the scope to a trusted host (project and user `.npmrc`, `npm_config_@scope:registry` in the environment, `.yarnrc.yml` `npmScopes`, `bunfig.toml` scopes). An unscoped internal pattern is safe only when the default registry is a trusted host. Done when fixtures cover each package manager with a mapped scope, an unmapped scope and an unscoped internal name, and the unsafe cases skip the install.

### T4. Python tools (cdxgen/cdxgen#4827)

Pre-flight for pip, uv, poetry, pdm, pipenv, pixi and rye. pip is safe only with a single trusted index and no extra index anywhere: environment, `pip.conf`, or `--index-url` and `--extra-index-url` lines inside the requirements files it will read. uv is safe when every internal name is pinned to an explicit index in `tool.uv.sources`, or the only index is trusted, and `UV_INDEX_STRATEGY` is not one of the unsafe values. Poetry, pdm and pipenv are safe when their per-package sources route internal names to trusted indexes. The per-package `safe-pip-install` path never installs an internal name. Done when fixtures cover each tool's safe and unsafe forms, including an extra index inside a requirements file.

### T5. JVM tools (cdxgen/cdxgen#4828)

Extend the injection that `MAVEN_CENTRAL_MIRROR` already performs in `lib/inventory/mavenCentralMirror.js`. Maven is safe when the effective settings mirror `*` or `external:*` to a trusted host. Otherwise, on Maven 3.9 or later, cdxgen enables remote repository filtering for Central using Central's published prefix file, downloaded whole so that no name is sent, which keeps requests for unpublished groups away from Central; the deliverable confirms the property names and behaviour against each Maven version in the corpus before relying on them. Gradle gets an init script that adds `content { excludeGroupByRegex(...) }` for internal groups to every repository whose host is not trusted, including `pluginManagement` and settings-level repositories through `beforeSettings`. sbt, mill, bazel, scala-cli, Leiningen and the Clojure CLI are unsafe unless a mirror covers everything, because their resolvers have no per-group routing that cdxgen can inject reliably. Done when the hermetic harness shows Maven and Gradle fixtures with internal groups make no request for them to Central or the plugin portal, with positive controls.

### T6. .NET, Ruby, PHP, Swift, CocoaPods, Cargo and container images (cdxgen/cdxgen#4829)

dotnet restore is safe when `packageSourceMapping` routes every internal pattern to a trusted source, and `--ignore-failed-sources` is dropped whenever internal names are present. bundle install is safe when internal gems are inside a `source` block for a trusted host and there is a single global source. composer is safe when a trusted repository is `canonical` with `only` covering the internal names, or packagist is disabled. Swift runs with `--only-use-versions-from-resolved-file` when internal packages are present. pod install is safe when the Podfile's `source` lines put a trusted spec repository first and internal pods are in it. cargo metadata and check run with `--offline` when an internal crate lacks a `registry =` key, and skip when the lockfile is also missing. Pulls of unqualified internal images are refused. Done when each tool has a safe and an unsafe fixture.

### T7. Confining package tools to trusted registries (cdxgen/cdxgen#4830)

`--internal-registry-only` (`CDXGEN_INTERNAL_REGISTRY_ONLY`) runs every package tool under safer-exec with proxy egress limited to the trusted hosts and loopback, for organizations whose mirrors serve everything. It reuses the safer-exec driver in `lib/inventory/traceRunner.js`, needs the registry settings preset from cdxgen/safer-exec#17, and fails closed: if safer-exec is not installed, or the platform cannot enforce proxy egress (Linux with explicit ports), the tool is skipped. Proxy violations go into the egress report by host. Done when a test on Linux and macOS shows a tool trying to reach a public host gets a refusal recorded in the report, and a tool using only the trusted host completes.

## Risks and open questions

Skipping a tool lowers BOM fidelity, sometimes a lot, as for Go projects without a module cache or Maven projects without a mirror. The default level is `safe` because the user asked for privacy by declaring patterns, but the degradation entries and the end-of-run summary must make the cost plain, and the guide must show how to make each tool safe rather than how to turn the check off.
