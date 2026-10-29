# One cdxgen plugin for Claude Code, Codex, Copilot and other agents

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4662 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

The cdxgen plugin is packaged for Claude Code only. In 2026 the other major coding agents gained plugin systems. Most of them now read the same package format, so one plugin directory can serve them all:

- **Agent Plugins** ([agent-plugins.org](https://agent-plugins.org), spec 1.0.0) is a vendor-neutral format. A plugin root holds `plugin.json` with a `$schema`, a `skills/` folder of Agent Skills, and an optional `mcp.json`. Client-specific additions go in reverse-domain namespaces such as `com.openai` or `com.github.copilot`.
- **OpenAI Codex** prefers that format. It also accepts `.codex-plugin/plugin.json` and Claude-compatible manifests, and it reads marketplaces from `.agents/plugins/marketplace.json` or `.claude-plugin/marketplace.json`. Marketplace entries need `policy.installation`, `policy.authentication` and `category`. Plugins with lifecycle hooks cannot be listed in OpenAI's public directory ([build plugins](https://developers.openai.com/codex/plugins/build)).
- **The GitHub Copilot CLI** gives a root Agent Plugins `plugin.json` precedence over `.claude-plugin/plugin.json`, and reads `.claude-plugin/marketplace.json` as a marketplace ([CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)). The Copilot app installs plugins the same way. Its security extension is itself a plugin, installed with `copilot plugin install github-security@awesome-copilot` ([view and fix security alerts](https://docs.github.com/en/copilot/how-tos/github-copilot-app/view-and-fix-security-alerts)).
- **Kiro** "powers" follow Agent Plugins. Cursor, Gemini CLI and opencode read Agent Skills from `.agents/skills` and their own folders. Cursor's GitHub import and Gemini CLI extensions each need a small manifest of their own.

The fourteen cdxgen skills are already vendor-neutral. They name commands and flags, not Claude-specific tools. The gap is packaging, testing in each client, and listing in each client's catalogue.

## Scope

In scope:

- an Agent Plugins manifest next to the existing Claude manifest, generated from one source
- a Codex marketplace file, testing in the Codex app and CLI, and submission to OpenAI's plugin directory
- testing in the Copilot CLI and the Copilot app, and submission to `awesome-copilot`
- manifests for Cursor and Gemini CLI, and a smoke check in Kiro and opencode
- vendor-neutral documentation of installation for each agent

Out of scope:

- Claude-only features: evals, hooks, `userConfig` and subagents ([cdxgen-claude-plugin-hardening.md](cdxgen-claude-plugin-hardening.md))
- the MCP server. This plan reserves the `mcp.json` slot, which is filled in by [cdxgen-mcp-server.md](cdxgen-mcp-server.md).
- contributor-facing agent files in the cdxgen repository (`AGENTS.md`, `.agents/skills`, `.github/copilot-instructions.md`)

## Approach

### Layout

The plugin directory keeps its current place, and gains a portable manifest:

```text
claude-plugin/                 (renamed in D1 if we decide to)
├── plugin.json                Agent Plugins 1.0.0 manifest
├── .claude-plugin/plugin.json Claude Code manifest (hooks, userConfig, agents)
├── skills/                    shared by every client
├── reference/                 shared
├── mcp.json                   added by the MCP server plan
├── agents/, hooks/            Claude Code only
└── com.github.copilot/        Copilot-only additions, if any
```

Claude Code reads `.claude-plugin/plugin.json` and ignores the root manifest. Codex and the Copilot CLI read the root manifest and ignore `hooks/` and `agents/` unless they are declared in their own namespaces. The Codex package therefore stays free of hooks, which keeps it eligible for OpenAI's directory.

### One source of truth

The name, version, description, author, licence and keywords appear in several manifests. A small script writes them into every manifest from `package.json` and one template. CI checks that the committed files match the script's output. The same check covers the Claude manifest version in [cdxgen-claude-plugin-hardening.md](cdxgen-claude-plugin-hardening.md) D1.

### Marketplaces

- Claude Code: `.claude-plugin/marketplace.json`, unchanged.
- Copilot CLI and app: the same file. If Copilot rejects a field in it, add `.github/plugin/marketplace.json`, which Copilot checks first.
- Codex: `.agents/plugins/marketplace.json` with `policy` and `category`. The Claude file stays as it is, so that it never has to carry Codex-only fields.

## Deliverables

### D1. Agent Plugins manifest and manifest generator

Add `plugin.json` with `"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"` to the plugin directory. Write the generator script and the CI drift check. Decide whether to rename `claude-plugin/` to a neutral name such as `agent-plugin/`. A rename changes only the marketplace `source` path, not the plugin name, so existing installs keep working. Done when the manifest validates against the published schema and CI fails on drift.

### D2. Codex

Add `.agents/plugins/marketplace.json`. Test `codex plugin marketplace add cdxgen/cdxgen`, installation in the Codex app, explicit (`$sbom-generate`) and implicit skill invocation, and the CLI. Fix anything in the skills that assumes Claude Code. Submit the plugin to OpenAI's plugin directory. Done when the install works from a clean machine and the submission is accepted, or the reviewers' requested changes are recorded as issues.

### D3. Copilot CLI and Copilot app

Test `copilot plugin marketplace add cdxgen/cdxgen` and `copilot plugin install cdxgen@cdxgen-plugins`, then installation from Customize in the Copilot app, and skill invocation in both. Open a pull request that adds the plugin to `github/awesome-copilot`. Done when both clients load all fourteen skills and the awesome-copilot pull request is open.

### D4. Cursor, Gemini CLI, Kiro and opencode

Add `.cursor-plugin/marketplace.json` for Cursor's GitHub import and `gemini-extension.json` for Gemini CLI, both generated by D1's script. Check that Kiro loads the plugin as a power, and that opencode discovers the skills. Done when each client loads the skills, with the result for each recorded in the docs.

### D5. Installation documentation

Make the plugin README vendor-neutral, and add a docs page with one section per agent: installation, update, how to invoke a skill, and known differences. Done when the page covers every client tested in D2–D4.

## Risks and open questions

- Agent Plugins does not list Anthropic among its maintainers, and Claude Code does not document support for it. The Claude manifest stays the source of Claude-specific features. If Claude Code adopts the format later, the two manifests can merge.
- Clients may treat unknown `SKILL.md` frontmatter differently. The hardening plan adds Claude-only fields, so D2–D4 must test the skills after those changes land.
- Directory reviews at OpenAI and GitHub are outside our control and may ask for changes to wording or metadata.

## Outcome

To be filled in when the work ends.
