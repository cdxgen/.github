# Running cdxgen through coding agents in CI

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4668 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

Each major coding agent can now run unattended in GitHub Actions:

- Claude Code through `anthropics/claude-code-action`, which installs plugins from a marketplace ([GitHub Actions](https://code.claude.com/docs/en/github-actions.md)), and through `claude -p` ([headless mode](https://code.claude.com/docs/en/headless.md)).
- OpenAI Codex through `openai/codex-action` and `codex exec` ([non-interactive mode](https://developers.openai.com/codex/noninteractive), [codex-action](https://github.com/openai/codex-action)).
- The Copilot cloud agent, which prepares its environment from `.github/workflows/copilot-setup-steps.yml` and takes MCP servers from repository settings ([customize the agent environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/customize-the-agent-environment)).

Users are starting to ask agents to "make an SBOM and tell me what changed" or "fix the fidelity gaps in our SBOM" as part of a pull request. Each agent can do this with cdxgen's skills, but each needs a different setup, with its own permissions, sandbox settings, plugin installation and output handling. Getting these wrong is how an agent ends up installing packages on a runner or printing secrets into a log. Tested, minimal recipes prevent that.

## Scope

In scope:

- one documented, tested workflow for each agent
- a manual-dispatch workflow in cdxgen that runs the recipes against a small fixture repository

Out of scope:

- cdxgen's own non-agent GitHub Action and code scanning uploads
- agent configuration that is not specific to cdxgen

## Approach

Each recipe is a complete workflow file that a user can copy, plus a short page that explains each setting. Every recipe follows the same rules:

- least-privilege `permissions`
- no package installation by the agent: the workflow installs cdxgen in a pinned step, and the agent runs with `--no-install-deps` or `--lifecycle pre-build`
- the agent's sandbox or permission profile set to the tightest one that works
- credentials only from secrets, never echoed
- the BOM uploaded as a workflow artifact
- the agent's summary written to the job summary

The recipes depend on the plugin packaging in [cdxgen-agent-plugins-portable.md](cdxgen-agent-plugins-portable.md). The Copilot cloud agent recipe also depends on the MCP server in [cdxgen-mcp-server.md](cdxgen-mcp-server.md).

## Deliverables

### D1. Claude Code recipe

A workflow using `anthropics/claude-code-action@v1` with `plugin_marketplaces` and `plugins` set to the cdxgen plugin, and a headless `claude -p --plugin-dir` variant. The variant uses `--output-format json`, and fails the job when the `system/init` event reports `plugin_errors`. Done when both run green on the fixture repository.

### D2. Codex recipe

A workflow using `openai/codex-action@v1` with a restrictive `permission-profile` and the cdxgen plugin or skills available. The workflow writes `final-message` to the job summary. Include a `codex exec --json` variant. Done when both run green on the fixture repository.

### D3. Copilot cloud agent recipe

A `copilot-setup-steps.yml` that installs a pinned cdxgen and its build tools, the repository-settings MCP JSON for `cdxgen-mcp`, and an instructions snippet that points the agent at the skills. Done when the agent, assigned an issue that asks for an SBOM, produces a BOM through the MCP server.

### D4. Recipe smoke workflow and docs

A manual-dispatch workflow in cdxgen that runs D1 and D2 against a fixture repository, using repository secrets. D3 cannot be driven from a workflow, so it is checked by hand and the result recorded. Add a docs page that collects the recipes. Done when the workflow passes and the page is published.

## Risks and open questions

- The recipes need API keys for Anthropic and OpenAI in the cdxgen repository. Who owns them, and what budget applies?
- The agents' actions and options change quickly. The smoke workflow is there to catch breakage, and the docs pin action versions.
- The Copilot cloud agent recipe waits on the MCP server.

## Outcome

To be filled in when the work ends.
