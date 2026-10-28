# pnpm 12 lockfile completeness

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4583 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | none |

## Why

Since pnpm 12, a `pnpm-lock.yaml` can hold two YAML documents. The first, the boot document, holds the project's config dependencies and the pnpm version resolved for it. The project lockfile is always the last document ([pnpm lockfile documentation](https://pnpm.io/lockfile)). cdxgen reads every document and uses the last one, so the project graph is complete, but the config dependencies in the boot document never reach the BOM. They are real npm packages that pnpm installs before anything else.

Two older requests sit next to this one. Patched dependencies (cdxgen/cdxgen#803) change the code of a dependency without changing its version, and catalogs (cdxgen/cdxgen#1222) move version ranges out of `package.json` into `pnpm-workspace.yaml`. Users also report empty `dependsOn` entries in pnpm monorepos (cdxgen/cdxgen#2020).

## Scope

The plan covers the pnpm lockfile parser in `lib/ecosystems/parsers-js.js`, the pnpm path of `lib/cli/jsBom.js`, the fixtures under `test/data`, and the documentation of any new property. It does not change how cdxgen runs `pnpm install`, and it does not touch npm, Yarn or Bun lockfiles.

## Approach

The parser already calls `parseAllDocuments`. When there are two documents, it will read the first as the boot document and the last as the project lockfile, keeping today's behaviour for single-document files. Config dependencies become components with their integrity hashes, marked so that they can be told apart from runtime dependencies, and the resolved pnpm version goes into the formulation section alongside the other build tools.

Patched dependencies are listed in the lockfile's `patchedDependencies` section with a hash of the patch file. The patched component keeps its purl, because the upstream package is still the source, and records that a patch was applied and the patch hash, so that vulnerability matching stays correct while the change is visible.

For catalogs, cdxgen already reads the `catalog` section of `pnpm-workspace.yaml`. The work is to confirm that `catalog:` and named catalog specifiers resolve to locked versions in lockfile v9 projects and to add fixtures. For cdxgen/cdxgen#2020, the first step is a reproduction from the reporter's layout.

## Deliverables

### D1. Boot document support (cdxgen/cdxgen#4584)

Config dependencies and the pnpm version appear in the BOM. A two-document fixture and a single-document fixture both pass.

### D2. Patched dependencies (cdxgen/cdxgen#803)

Patched components carry the patch hash and a documented property. A fixture with a patched dependency passes.

### D3. Catalogs (cdxgen/cdxgen#1222)

Fixtures for default and named catalogs pass, or the issue is closed with a note that the existing support covers it.

### D4. Monorepo dependency tree (cdxgen/cdxgen#2020)

A reproduction exists, and the BOM for it has no empty `dependsOn` entries for packages that have dependencies.

## Risks and open questions

The two-document format is new, and the pnpm documentation does not say which version introduced it. Fixtures should be generated with the pnpm version cdxgen pins in `package.json`. Whether config dependencies use the CycloneDX `scope` field or only a property is a modelling choice for the maintainer.

## Outcome

To be filled in when the work ends.
