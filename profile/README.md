# cdxgen

cdxgen is an OWASP project that creates CycloneDX Bills of Materials for source code, container images, binaries and live systems: SBOM, CBOM, OBOM, SaaSBOM and more. Read the [documentation](https://cdxgen.github.io/cdxgen/) to get started.

```sh
npm install -g @cdxgen/cdxgen
```

## Repositories

| Repository                                                         | What it is                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| [cdxgen](https://github.com/cdxgen/cdxgen)                         | The BOM generator: CLI, library, HTTP server and REPL        |
| [cdxgen-plugins-bin](https://github.com/cdxgen/cdxgen-plugins-bin) | Native helper binaries that cdxgen uses for deeper analysis  |
| [cdx-purl](https://github.com/cdxgen/cdx-purl)                     | Strict package-url parser and builder for Node.js            |
| [cdx-proto](https://github.com/cdxgen/cdx-proto)                   | Read and write CycloneDX BOMs as protocol buffers            |
| [cdx-hbom](https://github.com/cdxgen/cdx-hbom)                     | Hardware Bill of Materials library                           |
| [safer-exec](https://github.com/cdxgen/safer-exec)                 | OS-level sandboxing with tracing and auditing for any binary |
| [caxa](https://github.com/cdxgen/caxa)                             | Packages Node.js applications into single executables        |

## Getting involved

- Ask questions and share ideas in [Discussions](https://github.com/cdxgen/cdxgen/discussions).
- Read the [contributing guide](https://github.com/cdxgen/.github/blob/main/CONTRIBUTING.md) before opening a pull request.
- Report vulnerabilities privately, as described in the [security policy](https://github.com/cdxgen/.github/blob/main/SECURITY.md).

We build cdxgen with the help of AI coding agents and say so openly. Each repository has an AI-DECLARATION.md that describes how AI is used there, and pull requests made with AI carry an `ai-*` label for the level of AI involvement.
