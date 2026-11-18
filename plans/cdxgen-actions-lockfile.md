# GitHub Actions lockfile support in cdxgen

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4733 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

GitHub Actions pins action dependencies through a lockfile written by `gh actions-lock` ([concept](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles), [how-to](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies), [format](https://github.com/github/actions-lockfile)). For an onboarded workflow the runner executes the locked commit, and the lockfile satisfies the organization policy that requires full-length SHA pins, so workflow files may keep tag references.

cdxgen reads only the workflow files today. It reports a locked action as unpinned, which makes CI-001 and related rules raise false positives on repositories GitHub itself considers safe, and it misses the locked commits, the repository identity, and every action reached through a composite action. The lockfile does not cover reusable workflow calls, container images, inputs or secrets, and cdxgen says so rather than implying otherwise. Verification against GitHub, such as commit reachability and repository identity, stays with `gh actions-lock --verify`; cdxgen makes no network calls for this feature.

## Scope

In scope:

- reading `.github/workflows/actions.lock` schema versions v0.0.1 to v0.0.3
- joining lock entries to workflow action components, with the locked commit and repository identity as properties
- transitive actions from composite-action `uses` edges, as components and CycloneDX dependencies
- offline drift between workflow files and the lockfile
- audit rules that treat locked actions as pinned and flag lockfile gaps
- repository-scoped purls with a subpath for sub-action references
- documentation, a REPL pivot and repository tests

Out of scope:

- writing or regenerating lockfiles; that belongs to `gh actions-lock`
- network verification of commits, owners or repository ids
- onboarding the cdxgen organization's own repositories, tracked in cdxgen/cdxgen#4752

## Approach

The reader (D1) validates and normalises the lockfile to one shape: v0.0.1 pin keys and ref resolution fold into the v0.0.2 form, and v0.0.3 `hostname` entries survive as recorded. It never throws; every problem is a warning and collapses the result to an empty shape, so a corrupt lockfile degrades to today's behaviour rather than failing a scan.

The join (D2) happens in `parseWorkflowFile`, for both `-t github` and the formulation section: workflows match by repository-relative path with `/` separators, steps match by the repository-scoped pin key, so `actions/cache/save@v4` matches `actions/cache@v4`. The locked commit is recorded as a `cdx:github:lock:commit` property rather than in `hashes[]`, because it is a git object id and not a digest of the downloaded artefact.

Sub-action purls (D6) use the subpath the github purl type defines: `pkg:github/actions/cache@v4#save`, built through `tryBuildPurl`. This is the identity the join and the transitive deduplication need. It changes purls that users may match in policies or Dependency-Track, so it ships with a release note; the maintainer chose to land it in 13.9.0 rather than wait for a major release.

Drift (D4) mirrors the structural pass of `gh actions-lock --verify`, offline: references without lock entries, refs that differ, stale entries and un-onboarded workflows become properties, one console warning per workflow and counts in `metadata.properties`. The rules (D5) skip locked references and add rules for what the lockfile makes visible; the mutable-tag rule in the current rule set is CI-003 and INT-013 carries no mutable-reference selector, so the implemented set is CI-001, CI-003 and INT-012 plus the new CI-025 to CI-028.

## Deliverables

### D1. Read actions.lock files

A reader for the three schema versions, with hidden-Unicode scanning, size limits, alias rejection, cycle detection and full warning coverage. Issue cdxgen/cdxgen#4734. Done when every valid and invalid fixture parses to the expected shape.

### D2. Attach locked commits to workflow action components

The join in `parseWorkflowFile`, the `cdx:github:lock:*` and `cdx:github:action:isLocked` properties, workflow onboarding properties, `metadata.properties` counts, `$/path` and `./path` handling, SHA-256 refs in `getVersionPinningType`, and documentation in `docs/CUSTOM_PROPERTIES.md`. Issue cdxgen/cdxgen#4735.

### D3. Transitive actions and their dependency edges

Actions reached only through a lock entry's `uses` list become components with `cdx:github:action:isTransitive`, and the edges become CycloneDX dependencies, deduplicated by pin key. Issue cdxgen/cdxgen#4736.

### D4. Offline drift between workflows and actions.lock

The four drift findings as properties, warnings and counts, with one fixture tree per finding and a clean tree. Issue cdxgen/cdxgen#4737.

### D5. Audit rules that understand lockfiles

The isLocked skip in the pinning rules and the new CI-025 to CI-028 rules, with tests in `lib/stages/postgen/auditBom.poku.js` and documentation in `docs/BOM_AUDIT.md`. Issue cdxgen/cdxgen#4738.

### D6. Repository-scoped purls for sub-action paths

`pkg:github/actions/cache@v4#save` through `tryBuildPurl`, for step actions and reusable workflow calls, with a release note for the identity change. Issue cdxgen/cdxgen#4739.

### D7. Documentation, REPL pivot and repository tests

The `docs/PROJECT_TYPES.md` row, the lockfile documentation section, the `.actionslock` REPL pivot, and `repotests.yml` jobs that scan `github/gh-actions-lock` and `github/actions-lockfile` at pinned commits, including Windows. Issue cdxgen/cdxgen#4740.

## Risks and open questions

- The purl identity change can break user policies and Dependency-Track matching that key on the old form; the release note names the old and new forms.
- The lockfile schema is young. A v0.0.4 or later needs a reader update; unsupported versions already warn and degrade to an empty result.
- The rule ids in cdxgen/cdxgen#4738's text name CI-012 and INT-013 for selectors those rules do not carry; the implementation follows the real rule set, and the PR records the mapping.
- Composite-action graphs depend on lockfile completeness; entries the lockfile omits are invisible to cdxgen too.

## Outcome

D1 shipped through cdxgen/cdxgen#4768 in November 2026, with fifteen fixture trees under `test/data/actions-lock/`. D2 to D7 are implemented in cdxgen/cdxgen#4864: the join and repository-scoped purls, transitive components with edges, the four drift fixtures and their reporting, CI-025 to CI-028 plus the isLocked skips, the docs and REPL pivot, and the repository-test jobs, with the fixture corpus grown to twenty-five trees. The organization's own onboarding stays open in cdxgen/cdxgen#4752.
