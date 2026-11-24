# Pet-Zoo-Code

Pet-Zoo-Code is an independently maintained fork of [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code). It uses the Apache 2.0 license. Build and install the [local VSIX](#manual-vsix-installation) to use the fork.

## About the upstream project

> Zoo Code continues development of this project after the Roo team wound down
> active Roo Code work to focus on [Roomote](https://roomote.dev/). Thank you
> to the Roo team for everything they built.
>
> The core team is a group of developers who contributed to Roo previously and
> care deeply about this plugin. We will continue to make model updates, fix
> bugs, and release features, and we plan to listen closely to the community
> that made this plugin so special. Join us on
> [Discord](https://discord.gg/VxfP4Vx3gX),
> [Reddit](https://www.reddit.com/r/ZooCode), or
> [open a PR or issue](https://github.com/Zoo-Code-Org/Zoo-Code).
>
> _-Zoo Code Team_

## Roo Code to Zoo Code migration

The upstream [Roo Code to Zoo Code migration guide](https://docs.zoocode.dev/roo-to-zoo-migration) covers those two extensions.

## What Zoo Code Has Added Since Roo Code

Zoo Code builds on the foundation created by Roo Code and continues to expand it with:

- **Semble codebase intelligence** — semantic code search on demand. Use an existing installation or set `SEMBLE_BINARY_PATH` to the absolute path of a locally installed executable.
- **Stronger Orchestrator workflows** — safer delegation, parallel task coordination, reliable parent/child task recovery, and better isolation between subtasks and provider profiles.
- **Longer autonomous runs with Destructive Command Guard (DCG)** — automatically block dangerous commands while trusted work continues without repeated approval prompts.
- **The latest models** — ongoing support for new Claude, GPT, Gemini, Kimi, GLM, Grok, MiniMax, and other model families.
- **More ways to connect** — new and expanded providers including Moonshot, Kimi Code, Kenari, Friendli, OpenCode Go, and many more.
- **More dependable terminal and editing workflows** — fixes for premature terminal completion, task-state races, context management, diff editing, and provider-specific tool use.
- **More control over your workspace** — rules management, per-mode MCP restrictions, multi-root path controls, model reasoning options, and completion change review actions.

## What is new in Zoo Code v3.98.2

- 🔌 Models: Use Gemini 3.8 Flash and the new Gemini 4 Carbon, Hydrogen, and Neon models, with `xhigh` thinking levels on Gemini.
- 🔧 Fixes and provider support: Stop Vertex Gemini requests that end with a model turn, keep Gemini thought signatures intact through LiteLLM, condense Ollama tasks at the configured context limit, and turn on Responses API support for OpenAI Compatible providers.

<details>
  <summary>🌐 Available languages</summary>

- [English](README.md)
- [Català](locales/ca/README.md)
- [Deutsch](locales/de/README.md)
- [Español](locales/es/README.md)
- [Français](locales/fr/README.md)
- [हिंदी](locales/hi/README.md)
- [Bahasa Indonesia](locales/id/README.md)
- [Italiano](locales/it/README.md)
- [日本語](locales/ja/README.md)
- [한국어](locales/ko/README.md)
- [Nederlands](locales/nl/README.md)
- [Polski](locales/pl/README.md)
- [Português (BR)](locales/pt-BR/README.md)
- [Русский](locales/ru/README.md)
- [Türkçe](locales/tr/README.md)
- [Tiếng Việt](locales/vi/README.md)
- [简体中文](locales/zh-CN/README.md)
- [繁體中文](locales/zh-TW/README.md)

</details>

---

## What Can Zoo Code Do For YOU?

- Generate Code from natural language descriptions and specs
- Adapt with Modes: Code, Architect, Ask, Debug, and Custom Modes
- Refactor & Debug existing code
- Write & Update documentation
- Answer Questions about your codebase
- Automate repetitive tasks
- Utilize MCP Servers

## Modes

Zoo Code adapts to how you work:

- Code Mode: everyday coding, edits, and file ops
- Architect Mode: plan systems, specs, and migrations
- Ask Mode: fast answers, explanations, and docs
- Debug Mode: trace issues, add logs, isolate root causes
- Custom Modes: build specialized modes for your team or workflow

Learn more: [Using Modes](https://docs.zoocode.dev/basic-usage/using-modes) •
[Custom Modes](https://docs.zoocode.dev/advanced-usage/custom-modes)

## Resources

- **[Documentation](https://docs.zoocode.dev):** The official guide to
  installing, configuring, and mastering Zoo Code.
- **[Discord Server](https://discord.gg/VxfP4Vx3gX):** Join the community for
  real-time help and discussion.
- **[Reddit Community](https://www.reddit.com/r/ZooCode/):** Share your
  experiences and see what others are building.
- **[GitHub Issues](https://github.com/Zoo-Code-Org/Zoo-Code/issues):** Report
  bugs and track development.
- **[Feature Requests](https://github.com/Zoo-Code-Org/Zoo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop):**
  Have an idea? Share it with the developers.

---

## Local Setup & Development

1. **Clone** the repo:

```sh
git clone https://github.com/e3742526/Pet-Zoo-Code.git
```

2. **Install dependencies**:

```sh
pnpm install
```

3. **Run the extension**:

There are several ways to run the Pet Zoo Code extension.

### Development Mode (F5)

For active development, use VSCode's built-in debugging:

Press `F5` (or go to **Run** → **Start Debugging**) in VSCode. This will open a
new VS Code window with the Pet Zoo Code extension running.

- Changes to the webview will appear immediately.
- Changes to the core extension will also hot reload automatically.

### Automated VSIX Installation

To build and install the extension as a VSIX package directly into VSCode:

```sh
pnpm install:vsix [-y] [--editor=<command>]
```

This command will:

- Ask which editor command to use (code/cursor/code-insiders) - defaults to
  'code'
- Replace an existing Pet Zoo Code installation.
- Build the latest VSIX package.
- Install the newly built VSIX.
- Prompt you to restart VS Code for changes to take effect.

Options:

- `-y`: Skip all confirmation prompts and use defaults
- `--editor=<command>`: Specify the editor command (e.g., `--editor=cursor` or
  `--editor=code-insiders`)

### Manual VSIX Installation

If you prefer to install the VSIX package manually:

1. First, build the VSIX package:
    ```sh
    pnpm vsix
    ```
2. A `.vsix` file will be generated in the `bin/` directory (e.g.,
   `bin/pet-zoo-code-<version>.vsix`).
3. Install it manually using the VSCode CLI:
    ```sh
    code --install-extension bin/pet-zoo-code-<version>.vsix
    ```

---

We use [changesets](https://github.com/changesets/changesets) for versioning and
publishing. Check our `CHANGELOG.md` for release notes.

---

## Disclaimer

**Please note** that Zoo Code does **not** make any representations or
warranties regarding any code, models, or other tools provided or made available
in connection with Zoo Code, any associated third-party tools, or any resulting
outputs. You assume **all risks** associated with the use of any such tools or
outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis.
Such risks may include, without limitation, intellectual property infringement,
cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses,
downtime, property loss or damage, and/or personal injury. You are solely
responsible for your use of any such tools or outputs (including, without
limitation, the legality, appropriateness, and results thereof).

---

## Contributing

We love community contributions! Get started by reading our
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[Apache 2.0 © 2026 Zoo Code Org](./LICENSE)

---

**Enjoy Zoo Code!** Whether you keep it on a short leash or let it roam
autonomously, we can’t wait to see what you build. If you have questions or
feature ideas, drop by our [Reddit community](https://www.reddit.com/r/ZooCode/)
or [Discord](https://discord.gg/VxfP4Vx3gX), or open an
[issue](https://github.com/Zoo-Code-Org/Zoo-Code/issues). Happy coding!
