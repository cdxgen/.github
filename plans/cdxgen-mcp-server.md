# An MCP server for cdxgen

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4656 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

Agents reach cdxgen today in one way: a skill tells the agent which shell command to run, and the agent reads what the command prints. That works in Claude Code and, once the portable plugin lands, in Codex and the Copilot CLI. It does not work where an agent has no shell, or where the only extension point is the Model Context Protocol. The main example is the Copilot cloud agent and Copilot code review, which take MCP servers from repository settings ([configure MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)). Many other clients, such as ChatGPT connectors, IDE agents and internal agent platforms, also accept MCP but have no notion of a plugin.

cdxgen/cdxgen#1654 asked for an MCP server in 2025. It stalled on cost: when a tool returns a whole BOM, the BOM fills the agent's context. A BOM for a medium-sized service is easily several megabytes. This plan designs around that from the start. Tools return summaries, counts, and paths to files on disk. Agents ask for detail with narrow queries, the way a person uses `cdxi`.

## Scope

In scope:

- a stdio MCP server, started with a new `cdxgen-mcp` command in the existing npm package
- read-only tools over existing BOMs, built on the same code as `cdxi`, `cdx-validate` and `cdx-audit --direct-bom-audit`
- a generation tool that runs a dry run by default
- configuration snippets for Claude Code, Codex, the Copilot CLI and the Copilot cloud agent, plus an entry in the official MCP registry
- tests, including a response-size budget

Out of scope:

- a hosted or remote MCP endpoint. Public directories that want a remote HTTPS server, such as OpenAI's plugin directory, are not a goal for this release.
- MCP prompts and resources. The Copilot cloud agent supports only tools, so tools come first.
- enriching MCP server components in AI-BOMs from the registry, which is cdxgen/cdxgen#4604

## Approach

### Tool surface

| Tool | Does | Returns |
| --- | --- | --- |
| `bom_summary` | Load a BOM and describe it | spec version, component counts by type and ecosystem, dependency counts, licences, metadata |
| `bom_search` | Find components by name, purl, type, licence or property | a page of matching components (bom-ref, purl, version, licence) with a cursor |
| `bom_component` | Show one component | the full component, its direct dependencies and dependents, and its evidence |
| `bom_tree` | Show the dependency path to a component | the paths from the root, capped in depth and count |
| `bom_validate` | Run schema, deep and benchmark checks | findings grouped by rule, with counts, and a path to the full report |
| `bom_audit` | Run the direct BOM audit rules | findings grouped by severity, and a path to the full report |
| `bom_generate` | Generate a BOM for a local path | a dry run by default: the activity report summary. With `execute: true`: the output path and a `bom_summary` |

Every response has a size cap, 32 KB to start. Lists are paged. Anything bigger is written to disk and returned as a path. The same rule shows up in the response-size test in D5.

### Safety

The server inherits cdxgen's safety posture:

- `bom_generate` defaults to dry run, and passes `--no-install-deps` unless the caller sets `installDeps: true`.
- Paths must be absolute, and they must sit inside the roots the client declares through MCP roots, or inside `CDXGEN_MCP_ALLOWED_DIRS`.
- The server never uploads anything. Publishing to Dependency-Track stays with the CLI and the user-invoked skill.
- Secure mode works as it does for the CLI. With `CDXGEN_SECURE_MODE=true` the server runs under the Node.js permission model.
- Data-flow values from Golem are reported as counts and categories only, as in the skills.

### Implementation choices

The official TypeScript SDK (`@modelcontextprotocol/sdk`) is the obvious route, but it brings a dependency tree into a package that works hard to keep its own small. For a stdio server with tools only, the protocol needs JSON-RPC framing, `initialize`, `tools/list` and `tools/call`. D1 records the decision: the SDK as an optional dependency, loaded only by `cdxgen-mcp`, or a minimal in-tree implementation tested against the SDK's client.

The tools call library functions, not the CLI. `bom_search`, `bom_component` and `bom_tree` reuse the query helpers behind `cdxi` (`bin/repl.js`). `bom_validate` and `bom_audit` call the validator and audit modules in `lib/validator` and `lib/audit`. `bom_generate` calls `createBom` with the same options object the CLI builds.

## Deliverables

### D1. Design and decision record

Write `docs/MCP_SERVER.md` describing the tool surface, limits and safety rules above. Add a decision record on the SDK question, and choose the command name and the transports. Done when the record is merged and the tool schemas are fixed.

### D2. Read-only BOM tools

Implement `cdxgen-mcp` with `bom_summary`, `bom_search`, `bom_component`, `bom_tree`, `bom_validate` and `bom_audit`, with paging and the size cap. Done when every tool works over the test BOMs in `test/data` and every response for a 10,000-component BOM fits the cap.

### D3. BOM generation tool

Add `bom_generate` with dry run by default, `--no-install-deps` by default, root checks and progress notifications for long scans. Done when a dry run, a real run, and a run outside the allowed roots all behave as documented, with tests.

### D4. Client configuration and registry listing

Ship ready-to-use configuration for each client:

- `mcpServers` in the Claude Code plugin
- `mcp.json` in the portable plugin
- a `[mcp_servers.cdxgen]` example for Codex `config.toml`
- the repository-settings JSON for the Copilot cloud agent

Publish a `server.json` to the official MCP registry as `io.github.cdxgen/cdxgen` with `mcp-publisher`, from the release workflow. Done when each configuration is tested by hand and the registry entry resolves.

### D5. Protocol and budget tests, and documentation

Add protocol tests that drive the server with an MCP client over stdio. Add a size-budget test over a large generated BOM, and a test that the server writes nothing outside its output directory. Add a docs page with setup for each client. Close cdxgen/cdxgen#1654 when this lands.

## Risks and open questions

- The SDK dependency question (D1) affects package size and supply-chain exposure.
- Long generations may exceed some clients' tool-call timeouts. Progress notifications help where clients support them. Otherwise the agent should call `bom_generate` with a dry run first, and use the CLI for long scans.
- Clients differ in their support for MCP roots. Where a client sends none, the allowed directories must come from configuration, and the default must be safe: the current working directory only.

## Outcome

To be filled in when the work ends.
