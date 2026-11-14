# cdxgen-plugins-bin: helpers that keep internal names inside

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/198 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | Shared with [internal-packages-corpus.md](internal-packages-corpus.md) |

Part of [internal-packages.md](internal-packages.md). Ships in the cdxgen-plugins-bin release that cdxgen 13.9.0 depends on, milestone 4.4.0 at the time of writing.

## Why

Of the helpers in cdxgen-plugins-bin, only cdxrs has an HTTP client of its own. golem and rusi reach the network through the tools they run: golem loads packages with `go list -deps -json` through go/packages (`thirdparty/golem/internal/analyzer/report.go:71-94`), which asks the Go module proxy and checksum database about any module missing from the cache, and rusi runs `cargo metadata` without `--offline` (`crates/rusi-core/src/lib.rs:1477-1481`, `crates/rusi-driver/src/lib.rs:368-374`) and `cargo check` in the analysed project, which ask crates.io about any crate without a `registry =` key. Both inherit cdxgen's environment and set nothing themselves. kosi resolves classpaths from local caches only, trivy-cdxgen forces offline scanning and never downloads its databases, and trustinspector and cdxui make no package requests, but none of that is tested, so a future change could add a request without anyone noticing.

cdxrs is the fast transport for cdxgen's registry lookups. It receives prepared URLs over stdin (`thirdparty/cdxrs/src/fetch/batch.rs:34-52`) and knows nothing about packages, so cdxgen filters internal names before the handoff. A backstop in cdxrs itself catches a cdxgen bug that lets one through, and it costs little.

## Deliverables

### T1. cdxrs: refuse URLs that name internal packages (cdxgen/cdxgen-plugins-bin#194)

The fetch batch gains an optional `policy` object next to `requests`: `trustedHosts`, a list of host names, and `internalTokens`, the literal parts of the internal patterns after folding. A request whose host is not trusted and whose decoded path or query (percent-decoded, lowercased, Go `!` escapes removed) contains a token is not sent, gets the status `refused-internal`, and is never read from or written to the cache. stderr statistics count refusals per host without printing the URL. The protocol change is documented in `docs/CDXRS.md` and in cdxgen's `docs/CDXRS_PROTOCOL.md`, and a batch without `policy` behaves exactly as today. Separately, confirm which root store reqwest's `rustls` feature uses in the pinned version and make cdxrs trust an extra certificate authority from `SSL_CERT_FILE` or a `CDXRS_EXTRA_CA_FILE` variable, so that the test harness can see request paths through its recording proxy. Done when unit tests cover refusal, the cache bypass and a batch without a policy, and a parity test with cdxgen's JS transport gives the same refusals.

### T2. golem: an offline mode and the Go privacy variables (cdxgen/cdxgen-plugins-bin#195)

`--offline` makes golem load packages with `GOPROXY=off`, `GOSUMDB=off` and `GOTOOLCHAIN=local`, so a module missing from the cache is reported as missing rather than downloaded, and the report records the network mode. Without `--offline`, golem keeps passing `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB` and `GOPROXY` through unchanged, and the corpus environment allowlist in `internal/corpus/env.go` gains them so corpus runs behave like real ones. `README.md` and `THREAT_MODEL.md` describe both modes. Done when a test runs golem with `--offline` under safer-exec with the network disabled on a fixture with a module missing from the cache, and the run completes with that module reported missing.

### T3. rusi: an offline mode (cdxgen/cdxgen-plugins-bin#196)

`--offline` passes `--offline` to every cargo command rusi runs (metadata, check, generate-lockfile), honours `CARGO_NET_OFFLINE` and `net.offline` from Cargo configuration as the same thing, and refuses to install a toolchain through rustup, failing with a message that names the missing toolchain instead. `README.md` and `THREAT_MODEL.md` describe the mode. Done when a test runs rusi with `--offline` under safer-exec with the network disabled on a fixture whose dependencies are vendored, and on one with a crate missing from the cache, which fails with a clear message rather than a network error.

### T4. Egress tests for every helper (cdxgen/cdxgen-plugins-bin#197)

A CI job that runs each helper on its existing fixtures under safer-exec with the network disabled, on Linux and macOS: golem and rusi in offline mode, cdxrs with `--offline` against a pre-filled cache, and kosi, trivy-cdxgen, trustinspector and cdxui as they are. The job fails if a helper's run fails because of a refused connection or safer-exec records a network violation. Done when the job runs on every pull request that touches `thirdparty/`, and each helper's `THREAT_MODEL.md` or README links to it as the evidence for its network claims.

## How cdxgen uses these

cdxgen passes the Go privacy variables to golem in every run that has patterns (cdxgen/cdxgen#4825), uses golem's and rusi's offline modes when a tool cannot be made safe in any other way (cdxgen/cdxgen#4829), and sends the cdxrs `policy` object with every batch (cdxgen/cdxgen#4816). cdxgen 13.9.0 depends on that release and checks the helper versions it needs, so an older helper falls back to the JS transport or to skipping the tool, never to an unprotected run.

## Risks and open questions

`GOPROXY=off` makes golem miss modules that a normal run would download, which lowers evidence quality for projects without a warm module cache. That is the intended trade for the offline mode, and cdxgen only selects it when the alternative is an unprotected run.
