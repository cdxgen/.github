# Claude Code plugin: evals, safer invocation and configuration

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4648 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

cdxgen ships a Claude Code plugin from [`claude-plugin/`](https://github.com/cdxgen/cdxgen/tree/master/claude-plugin), listed in the marketplace at `.claude-plugin/marketplace.json`. It has fourteen Agent Skills and two shared reference files, and nothing else. The skills carry most of cdxgen's know-how about running the toolkit safely, such as dry-run first, no automatic dependency installation, absolute paths, never hand-written purls and confirmation before publishing. Nothing tests that an agent actually follows them.

Claude Code now offers several plugin features that address this directly, and the plugin uses none of them:

- `claude plugin eval` runs prompt-and-grader suites against a plugin, and `claude plugin validate --strict` checks its structure ([plugin evals](https://code.claude.com/docs/en/plugin-evals.md), [CLI reference](https://code.claude.com/docs/en/plugins/cli-reference.md)).
- Skill frontmatter can stop the model from invoking a skill on its own (`disable-model-invocation`), run a skill in a forked context (`context: fork`), and activate a skill only near matching files (`paths`) ([skills](https://code.claude.com/docs/en/skills.md)).
- `userConfig` in `plugin.json` asks the user for settings once and stores `sensitive` values in secure storage ([manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md)).
- Plugins can ship subagents with restricted tools ([subagents](https://code.claude.com/docs/en/sub-agents.md)) and hooks ([hooks](https://code.claude.com/docs/en/hooks.md)).

Two problems are visible today. The plugin version in `claude-plugin/.claude-plugin/plugin.json` is bumped by hand and can drift from `package.json`. Long-running skills such as `sbom-generate` and `container-sbom` print large outputs into the main conversation, which is the same token cost raised in cdxgen/cdxgen#1654.

## Scope

In scope:

- structural validation and version checks in CI
- an eval suite for skill selection and for the safety rules in `reference/safety.md`
- frontmatter changes to the existing skills
- `userConfig` for Dependency-Track, TEA and default generation settings
- a read-only review subagent
- two hooks: a SessionStart check for the cdxgen CLI and an opt-in reminder when lockfiles change
- the metadata needed to list the plugin in the claude.ai plugin directory

Out of scope:

- packaging for Codex, Copilot and other agents ([cdxgen-agent-plugins-portable.md](cdxgen-agent-plugins-portable.md))
- the MCP server ([cdxgen-mcp-server.md](cdxgen-mcp-server.md))
- CI recipes that run agents ([cdxgen-agent-ci-recipes.md](cdxgen-agent-ci-recipes.md))
- installing the cdxgen CLI from the plugin. The plugin keeps shipping instructions, not the tool, and no hook ever installs software.

## Approach

### Keep the skills portable

The same `SKILL.md` files will be loaded by Codex, Copilot and others once the portable plugin lands. Frontmatter fields that only Claude Code understands are ignored by the other clients, so they are safe to add. One exception matters: claude.ai uploads and the Skills API reject `argument-hint`, so the directory listing build must strip it or the skills must avoid it. Deliverable D3 decides which.

### Evals measure behaviour, not prose

Each eval case is a prompt in `claude-plugin/evals/<case>/prompt.md` with graders in `graders/`. Two kinds of case matter:

- **Selection.** A natural request ("make an SBOM for this Go service", "is this BOM CRA compliant?") must load the right skill. Graders: `tool_used` on the Skill tool, and a regex on the command that runs.
- **Safety.** The agent must run `--dry-run` before a real scan, use `--no-install-deps` or `--lifecycle pre-build` when it is told it is in CI, use absolute paths, refuse to print a Dependency-Track key, and ask before uploading. Graders: `tool_order`, regex and `llm`.

Fixtures are small projects already in `test/data` or `cdxgen-test-fixtures`. Each run makes real model calls, so the suite runs on manual dispatch and on a weekly schedule rather than on every pull request, with a pass threshold of 0.8 to start.

### Configuration replaces copy-and-paste

Today the `dependency-track-upload` skill tells the user to export environment variables. With `userConfig`, the plugin asks once for the server URL, the API key (`sensitive: true`), the TEA endpoint and token, a default `--spec-version`, and whether to prefer the container image over a local install. Skills read the values through `${user_config.KEY}`. Sensitive values appear only as placeholders in skill content.

### Side-effecting skills are user-invoked only

`bom-signing` and `dependency-track-upload` act on keys and on external servers. They get `disable-model-invocation: true`, so they run only when the user types `/cdxgen:bom-signing` or `/cdxgen:dependency-track-upload`. Generation skills stay model-invocable but move to `context: fork` so their output stays out of the main conversation, and the parent gets back a summary and the BOM path.

### Hooks warn, never act

- **SessionStart**: check that `cdxgen` is on PATH, compare its version with the plugin version, and print one line if it is missing or older. It never installs anything.
- **PostToolUse** on `Write|Edit` of lockfiles and manifests: when the user opts in through `userConfig`, add a note that the SBOM is now stale and suggest a re-scan. Off by default.

## Deliverables

### D1. Validate the plugin and keep its version in step

Add `claude plugin validate --strict ./claude-plugin` to the lint workflow. Add a check, run in CI and in the release script, that `claude-plugin/.claude-plugin/plugin.json` has the same version as `package.json`, and make the version bump update both. Done when CI fails on a malformed plugin or a version mismatch.

### D2. Eval suite for skill selection and safety rules

Create `claude-plugin/evals/` with at least one selection case per skill and one case per rule in `reference/safety.md`. Add a workflow that runs `claude plugin eval ./claude-plugin --json results.json --threshold 0.8 --trust-plugin` on manual dispatch and weekly, and uploads the results. Document how to run it locally. Done when the suite passes at the threshold on the current skills and fails when a safety instruction is deleted from a skill.

### D3. Skill frontmatter: invocation control, forked context and file triggers

- `disable-model-invocation: true` on `bom-signing` and `dependency-track-upload`.
- `context: fork` on `sbom-generate`, `container-sbom`, `os-hardware-inventory`, `bom-evidence` and `sbom-fidelity-loop`, each ending with a short summary and the output path.
- `paths` globs on `bom-explore`, `bom-audit` and `bom-convert-validate` for `*.cdx.json`, `bom.json` and `*.spdx.json`.
- Decide whether to use `argument-hint`, given that claude.ai rejects it.

Done when the D2 evals still pass and an eval shows that `bom-signing` is not invoked without the slash command.

### D4. userConfig for servers, credentials and defaults

Add `userConfig` for the Dependency-Track URL and API key, the TEA endpoint and token, the default spec version and the preferred runtime (local CLI or container image). Update `dependency-track-upload`, `sbom-generate` and `container-sbom` to use them, and update the README. Done when an upload works with the key entered only through the plugin prompt and the key never appears in the transcript.

### D5. Read-only BOM reviewer subagent

Add `claude-plugin/agents/bom-reviewer.md`: a subagent that runs `cdx-validate`, `cdx-audit --direct-bom-audit` and `cdxi` commands on an existing BOM and reports findings. `disallowedTools: Write, Edit`. It preloads the `bom-audit`, `bom-convert-validate` and `bom-explore` skills. Done when an eval delegates a review to it and the subagent makes no file changes.

### D6. SessionStart and lockfile hooks

Add `claude-plugin/hooks/hooks.json` with the two hooks described above, and a `userConfig` switch for the lockfile hook. The scripts are plain Node.js with no dependencies. Done when both hooks have tests and the SessionStart hook adds less than 200 ms to session start when cdxgen is installed.

### D7. Directory listing

Add `icon`, `documentationUrl`, `supportUrl` and `privacyPolicyUrl` to `plugin.json`, write a privacy note (the plugin sends nothing anywhere itself), and submit the plugin through the claude.ai directory portal. Done when the listing is live, or the reviewers' requested changes are recorded as issues.

## Risks and open questions

- Eval runs cost money and need an API key in the repository secrets. Who owns the budget and the key?
- Directory submission needs a paid claude.ai plan with Owner rights.
- `context: fork` changes how results reach the user. If the summaries hide information that users need, D3 may have to keep some skills in the main context.
- Hook trust prompts may annoy users. If they do, the lockfile hook stays opt-in and the SessionStart hook may move behind `userConfig` too.

## Outcome

To be filled in when the work ends.
