# Contributing to cdxgen

Thanks for helping out. This guide applies to every repository in the cdxgen organization that does not have its own CONTRIBUTING.md. Each repository's README, and its AGENTS.md where there is one, explains how to build and test it.

## Before you start

- Open an issue in the relevant repository for bugs and feature requests. For questions and ideas, use [Discussions](https://github.com/cdxgen/cdxgen/discussions) on the main cdxgen repository.
- Do not report security issues in public. See [SECURITY.md](SECURITY.md).
- For larger changes, open an issue or a discussion first so we can agree on the approach before you put in the work.

## Pull requests

- Keep each pull request focused on one change, and explain what changed and why in plain words.
- Add or update tests and documentation along with the change, and make sure the required checks pass.
- A maintainer merges pull requests from outside contributors. The maintainers' own agent-made changes, and routine dependency updates from bots such as Renovate, may merge automatically once the required checks pass.

## Using AI tools

AI coding assistants and agents are welcome here, and the maintainers use them for most of their own work. What we ask in return:

- **Disclose material AI use.** Pick the level that fits in the pull request template, and a maintainer will add the matching label below. Spelling and grammar fixes, translating your own words, and trivial autocomplete do not need disclosure.
- **Own the change.** You are responsible for everything you submit, including anything an agent did on your behalf. Make sure the change works and the tests pass, and be ready to explain and maintain it.
- **Agents act on behalf of a person.** An agent may open pull requests or issues under your own account as long as its AI use is disclosed, and you are the responsible person. A separate automated account must say that it is automated and name the person responsible for it.
- **Respect licenses and privacy.** Only submit content you have the right to contribute. Do not put secrets, credentials or other people's private data into prompts.
- **No low-effort output.** Unreviewed or unverified AI output may be closed without review. This includes AI-generated vulnerability reports without a working reproduction.

| Label        | Meaning                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `ai-assist`  | A person did the task, and AI did part of it                                              |
| `ai-pair`    | A person and AI did the task together, and the person understands the internals in detail |
| `ai-copilot` | AI did the whole task and asked a person for decisions and approval along the way         |
| `ai-auto`    | A person set the task, and AI agents carried it through to completion                     |

These levels follow [AI-DECLARATION.md](https://ai-declaration.md). Each repository also has an AI-DECLARATION.md file that describes AI involvement in the repository as a whole.

## Code of conduct

cdxgen is an OWASP project. Everyone who takes part in cdxgen repositories, issues, discussions and community channels is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
