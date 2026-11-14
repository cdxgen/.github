# Internal package names: corpus, egress harness and CI

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4839 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | `internal-packages.corpus.json`, added with T5 when the first item is stored outside git |

Part of [internal-packages.md](internal-packages.md).

## Why

A privacy feature is only as good as the evidence that it works, and the evidence here is unusual: the test has to prove that something did not happen. A test that cannot see a request reports no leak, so every test in this plan has a positive control that must see the leak when the protection is off. The corpus also has to exercise each ecosystem's own shapes (scopes, aliases, extras, parent POMs, Go case escapes, alternate Cargo registries), because the bugs live in those details rather than in the matcher.

## Requirements

The corpus and harness must meet these requirements. Each deliverable below says which ones it covers.

- **R1. No real names.** Internal package names contain the token `cdxcanary`, and trusted hosts are under `corp.invalid`, using the `.invalid` top-level domain that RFC 2606 reserves, so that a failing test leaks nothing real and no fixture can resolve on a real network. Look-alike tests use real public names declared internal (for example `left-pad` and `acme-client`) together with recorded responses, never a live registry.
- **R2. Every ecosystem shape.** Each ecosystem with a lookup or a package tool in the lookups and tools plans has a fixture with at least one internal name in each form the ecosystem allows, listed in the matrix below.
- **R3. Positive controls.** Every leak test runs twice: with the protection, asserting no canary reaches an untrusted host, and without patterns and with detection off, asserting a canary does reach one. A test whose control sees nothing fails as blind.
- **R4. Every encoding.** The canary scanner looks for the token in hosts, paths, queries, headers and bodies, after percent-decoding, lowercasing, PEP 503 folding, removing Go `!` case escapes, joining Maven paths (`io/cdxcanary/internal` as `io.cdxcanary.internal`), and decoding JSON and form bodies. It also checks DNS query names in the hermetic harness.
- **R5. Untrusted means everything else.** A request containing a canary is allowed only when its host is under `corp.invalid`. The scanner does not keep a list of forbidden hosts, so a request to a host nobody anticipated still fails the test.
- **R6. Both transports.** Tests cover cdxgen's undici-based client and the cdxrs fetch helper, and say which one served each request.
- **R7. Hermetic tools.** Package tools run in a network namespace where every DNS name resolves to a local recorder, so a tool that ignores proxy settings is still recorded rather than reaching the internet.
- **R8. Accuracy as well as privacy.** Golden BOM assertions check that internal components are marked, that a look-alike's public license, description, repository URL and provenance are absent from them, and that no pattern string or trusted host appears anywhere in the BOM or the reports.
- **R9. Every call site classified.** A ratchet test fails when an outbound call site appears in the code without an entry that says what identifier it sends and which gate protects it.
- **R10. Reproducible inputs.** Items too large for git are listed in the corpus manifest with a SHA-256 digest, a licence and a storage location, and tests refer to them by digest.

## Fixture matrix

Fixtures live in `test/data/internal-packages/<ecosystem>/<case>/` in cdxgen. Each case has a `README.md` saying what it tests and an `expect.json` with the internal names, the trusted hosts and the tool verdicts the case expects.

| Ecosystem | Internal forms | Detection sources | Tool paths exercised |
| --- | --- | --- | --- |
| npm, pnpm, yarn, bun | `@cdxcanary/billing`, unscoped `cdxcanary-utils`, an alias `"utils": "npm:@cdxcanary/utils@1.0.0"`, a `private: true` root, a workspace member, a git dependency on `git.corp.invalid` | `.npmrc` scope, `.yarnrc.yml` `npmScopes`, `bunfig.toml` scopes | Install with and without a mapped scope; lockfile `resolved` on a trusted host and on registry.npmjs.org |
| Deno and JSR | `jsr:@cdxcanary/billing` | none | Metadata only |
| PyPI | `cdxcanary_billing`, `CdxCanary.Billing` (PEP 503), an extra `cdxcanary-utils[cli]`, an import-only module `cdxcanary_billing` with no manifest | uv explicit index with `tool.uv.sources`, Poetry explicit source, pdm `include_packages`, Pipfile `index` | pip with an extra index inside the requirements file, uv with `UV_INDEX_STRATEGY`, the per-package pip path |
| Maven and Gradle | `io.cdxcanary.internal:billing-core` with a parent `io.cdxcanary.internal:parent`, an imported BOM, an internal Gradle plugin `io.cdxcanary.conventions`, an unidentified jar `cdxcanary-legacy.jar` | none (mirrors are not routes) | mvn without a mirror, with `mirrorOf *`, with repository filtering; Gradle with and without the init script |
| sbt, mill, Clojure | `io.cdxcanary::billing`, `cdxcanary/billing` | none | Skipped as unsafe without a full mirror |
| Go | `git.corp.invalid/cdxcanary/Billing` (uppercase for `!b`), `git.corp.invalid/cdxcanary/billing/v2` | `GOPRIVATE`, `GONOPROXY` only, `GONOSUMDB` only | `go list` and `go mod graph` with and without injection; golem |
| Cargo | `cdxcanary_core` and `cdxcanary-core`, one declared with `registry = "corp"` and one without | Cargo `registry =`, Cargo.lock `source` | cargo metadata online and offline; rusi |
| NuGet | `CdxCanary.Internal.Billing` | `packageSourceMapping` | dotnet restore with and without mapping, with a failing private feed |
| RubyGems | `cdxcanary-billing` | Gemfile `source` block, Gemfile.lock remote | bundle install with one and two global sources |
| Composer | `cdxcanary/billing` | repository `only` with `canonical` | composer update with packagist enabled and disabled |
| Dart, Elm, Terraform, CocoaPods, Swift | One internal name each, and a private pod on github.com | pub hosted URL | pod install with and without a private spec source; swift with a resolved file |
| GitHub, Hugging Face, containers | `cdxcanary-org/billing-core` as a git dependency, `cdxcanary/model` in an AI-BOM fixture, `cdxcanary/app:1.0` unqualified in a Kubernetes manifest | none | Licence lookups, Hugging Face remote, manifest image follow |
| Look-alikes | `left-pad` and `acme-client` declared internal, with recorded public responses | none | Metadata only, golden BOM checks |
| Mixed monorepo | npm, Python, Go and Maven sub-projects with per-directory `.npmrc` and `pyproject.toml` | All of the above | Default run with `--install-deps` |

## Harnesses

**In-process recorder.** For cdxgen's own lookups, which are most of the tests, a recorder runs cdxgen as a child process with `HTTPS_PROXY` and `HTTP_PROXY` pointing at a local forward proxy that terminates TLS with a test certificate authority, trusted through `NODE_EXTRA_CA_CERTS`. cdxgen's HTTP client honours the proxy variables (`lib/core/httpClient.js:636-650`), and so does cdxrs. The proxy records each request, answers from recorded fixtures for look-alike tests, and answers 404 otherwise. It runs on Linux, macOS and Windows and needs no privileges, so it fits the normal `poku` test runs.

**Hermetic network harness.** For package tools, which may ignore proxy settings, a Linux container image runs the tool with no route to the outside, a DNS server that answers every name with the address of a local recorder and logs the query name, and a recorder listening on ports 80 and 443 that issues a certificate for each requested name from a test authority. The authority is added to the system trust store and to the tool-specific settings that ignore it (`NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `PIP_CERT`, `SSL_CERT_FILE`, `CARGO_HTTP_CAINFO`, the JDK `cacerts` file, and Composer's `cafile`). A tool that refuses the certificate still leaves its DNS query and TLS server name in the log, so a leak in the host name is always caught, and the positive control shows whether the path level is visible for that tool. The image is built from a Dockerfile in the cdxgen repository and published to GitHub Container Registry by digest.

**Scanner.** One module, used by both harnesses, applies R4 and R5 to the recorded JSON lines and prints, for a failure, the host, the ecosystem guessed from the host, the transport and the decoded path with the canary marked.

## Deliverables

### T1. Canary fixtures (cdxgen/cdxgen#4831)

The fixture matrix above, each case with its `README.md` and `expect.json`. Covers R1, R2 and the inputs for R8. Done when every row has its fixtures, a script checks that every name listed as internal in an `expect.json` either contains `cdxcanary` or belongs to the look-alike set, every host listed as trusted is under `corp.invalid`, and the look-alike responses are recorded with their source URLs.

### T2. In-process recorder and scanner (cdxgen/cdxgen#4832)

The recording proxy, the scanner and a `poku` helper, `withEgressRecorder(fixture, options, fn)`, that runs cdxgen against a fixture twice (protected and control) and returns both recordings. One test per ecosystem in the lookups plan. Covers R3 to R6. Done when every lookup ecosystem has a passing protected test and a control that sees its canary, on Linux, macOS and Windows runners.

### T3. Hermetic network harness (cdxgen/cdxgen#4833)

The container image, the DNS server, the recorder, the trust setup and a runner script that executes a cdxgen command against a fixture inside it and writes the recording. One test per tool family in the tools plan, plus golem and rusi through evinse. Covers R3, R4, R5 and R7. Done when every tool family has a protected test and a control, and the image digest is in the corpus manifest.

### T4. Ratchet test and golden BOMs (cdxgen/cdxgen#4834)

`data/egress-sites.json` lists every outbound call site with its file, function, identifier kind (`purl`, `name`, `hash`, `repository`, `none`) and the gate or reason that protects it. A convention test in the style of `lib/boundaries.poku.js` finds every use of `cdxgenAgent`, `gatedGet`, `prefetchJson`, `pooledDocument`, `fetch(`, `got(` and the undici request functions in `lib/` and `bin/`, and fails when one is missing from the file or the file names one that no longer exists. Golden BOM assertions for every fixture check the R8 conditions. Covers R8 and R9. Done when the test passes on master and fails on a branch that adds an unclassified request.

### T5. CI job and corpus manifest (cdxgen/cdxgen#4835)

A workflow job, `internal-packages`, that runs the in-process tests on the three operating systems and the hermetic tests on Linux, on pull requests that touch `lib/`, `bin/`, `data/` or the fixtures, and nightly. `plans/internal-packages.corpus.json` in cdxgen/.github lists the harness image, the recorded look-alike responses if they outgrow the repository, and an OCI image of the mixed monorepo with its application dependencies installed, used to test a container scan where no routing configuration exists inside the image. Covers R10. Done when the job is required for merges into master and the manifest validates against `corpus-manifest.schema.json`.

## Risks and open questions

The hermetic image needs every package tool the tools plan covers, which makes it large and slow to build. It is built only when its Dockerfile changes, and test runs pull it by digest. Tools whose TLS stack cannot be made to trust the test authority (some Swift and JVM configurations) are tested at the host name level only, and their tests say so.
