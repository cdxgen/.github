# OWASP dep-scan: internal package names

| | |
| --- | --- |
| Epic | https://github.com/owasp-dep-scan/dep-scan/issues/662 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | Shared with [internal-packages-corpus.md](internal-packages-corpus.md), plus the cdx-purl pattern vectors |

Part of [internal-packages.md](internal-packages.md), which defines the pattern grammar and the four rules. Research was done against dep-scan at 6c998ee17d9b.

## Why

dep-scan generates BOMs with cdxgen and then analyses them, so it inherits every lookup and package tool covered by the cdxgen plans, and it adds two paths of its own. The risk audit (`--risk-audit`, `ENABLE_OSS_RISK`, and implied by `--purl`) sends every npm, PyPI and crates.io package name it audits to registry.npmjs.org, pypi.org and crates.io, with hosts that cannot be overridden (`depscan/lib/config.py:137-141`, `depscan/lib/package_query/metadata.py:20-44`). Go reachability with golem lets `go` download missing modules through the default proxy (`--go-analyzer-network auto`, `packages/xbom-lib/src/xbom_lib/golem.py:219-240`), and the rusi compiler backend can fetch crates.

dep-scan already has `--private-ns` (`PKG_PRIVATE_NAMESPACE`, `private_ns` in `.config/depscan.toml`), but it means the opposite of this program. The risk audit looks the private name up on the public registry and, if the registry answers, reports "Private package is public" (`npm_pkg.py:107-110`, `pypi_pkg.py:74-77`, `cargo_pkg.py:80-83`). That is a dependency confusion check, and it works by sending the names. Its matcher also has two bugs: it splits on commas without trimming, so a trailing comma creates an empty entry that matches every package, and it has no boundary, so `acme` matches `acmeish` (`metadata.py:45-51`).

## Approach

dep-scan reads the same settings as cdxgen, passes them to cdxgen in every engine, and applies them to its own lookups. The matcher is a Python port of the cdx-purl one, tested against the same vector file pinned by digest. The leak-free confusion check comes from cdxgen's `internal-packages` audit rules, which look at where the lockfile says each internal package came from, and dep-scan reports their findings next to its own. The old behaviour of `--private-ns`, probing public registries, stays available under an explicit, clearly named option, because some users rely on it and it does find registered look-alikes that the lockfile cannot show.

## Deliverables

### T1. Matcher and settings (owasp-dep-scan/dep-scan#658)

A Python module with the pattern grammar and folding rules, tested against the cdx-purl vectors copied into the repository with their SHA-256 recorded, and a test that fails when the copy differs from the recorded digest. Options `--internal-package-prefix` and `--internal-package-prefix-file`, the environment variables `CDXGEN_INTERNAL_PACKAGE_PREFIX` and `CDXGEN_INTERNAL_PACKAGE_PREFIX_FILE` read as they are, and `internal_package_prefix` in the TOML configuration. Done when the vectors pass, the empty-entry and missing-boundary bugs in today's `--private-ns` matcher (`metadata.py:45-51`) have regression tests, and the README documents the options.

### T2. Passing the settings to cdxgen (owasp-dep-scan/dep-scan#659)

The local engine (`packages/xbom-lib/src/xbom_lib/cdxgen.py`, `CdxgenGenerator`) already copies the environment, so it needs only the variables set from the options. The container engine (`CdxgenImageBasedGenerator`) forwards only `CDXGEN_*`, `GIT*` and `FETCH_LICENSE`, so inline patterns pass through, and a pattern file is mounted read-only into the container and its in-container path passed in `CDXGEN_INTERNAL_PACKAGE_PREFIX_FILE`, since an environment variable cannot carry a long list on every platform. The server engine (`CdxgenServerGenerator`) sends `internalPackagePrefix` in the request body. dep-scan's own server mode (`packages/server-lib/src/server_lib/simple.py:716-727`) passes the settings into `create_bom`, which it does not do for any option today. Done when a test for each engine shows cdxgen receiving the patterns, using a stub cdxgen or a recorded request.

### T3. Risk audit honours internal names (owasp-dep-scan/dep-scan#660)

The risk audit skips any package that matches a pattern or carries `cdx:pkg:internal` in the BOM, and reports it as skipped rather than as risk-free. `--private-ns` values are treated as internal patterns and are no longer sent anywhere, with a deprecation note pointing to `--internal-package-prefix`. A new option, `--probe-public-registries-for-internal`, restores the public probe for the listed names, prints a warning that the names leave the network, and keeps the "Private package is public" finding. The findings of cdxgen's `internal-packages` rules appear in dep-scan's report. Done when a test with a recorded registry stub shows no request for an internal name by default, one request per name with the probe option, and the cdxgen rule findings in the output. Because this changes what `--private-ns` does, it targets dep-scan 7.0.0.

### T4. Go and Rust reachability (owasp-dep-scan/dep-scan#661)

`_build_hardened_go_env` sets `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB` from golang patterns, appended to existing values, in every network mode, and the offline mode also sets `GOSUMDB=off` and `GOTOOLCHAIN=local` and uses golem's `--offline` once the cdxgen-plugins-bin release with it is available. The rusi compiler backend runs with rusi's `--offline` when an internal crate has no `registry =` key. Done when tests check the environment and arguments passed to golem and rusi for each mode.

## Risks and open questions

The dep-scan maintainers decide whether `--private-ns` changes meaning in 7.0.0 or keeps its current meaning with a deprecation warning until a later release. The risk audit covers only npm, PyPI and cargo today, and the BOM path audits only npm components, so the internal-name check adds nothing for other ecosystems until the audit grows.
