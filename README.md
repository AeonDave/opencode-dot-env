# opencode-dot-env

> Load a `.env` next to your OpenCode config and resolve `{env:VAR}` placeholders — no shell wrapper, no profile alias.

A plugin for [OpenCode](https://github.com/sst/opencode) that reads a `.env` file from your config directory into the running process, so `{env:VAR}` placeholders in `opencode.json`, MCP definitions, provider options, and other plugins resolve automatically. Cross-platform (Linux, macOS, Windows) with zero runtime dependencies.

Repository: [AeonDave/opencode-dot-env](https://github.com/AeonDave/opencode-dot-env)

## Why This Exists

OpenCode resolves `{env:VAR}` from the **process environment** at startup. Without help, that means exporting every secret beforehand — a shell wrapper script, a profile alias, or system-wide environment variables. That is fragile and easy to forget.

This plugin removes the wrapper: drop a `.env` next to `opencode.json` and the variables are loaded for you, on every OS, every launch.

- **One `.env`, everywhere** — Keep values like `API_KEY`, `ACCESS_TOKEN`, and other secrets in a single gitignored file beside your config.
- **Placeholders just work** — `{env:VAR}` and `${VAR}` in config files resolve from the loaded `.env`.
- **Shells inherit it too** — Loaded variables are injected into the `bash` tool and terminal sessions.

## How It Works

The plugin runs at three points, earliest first:

1. **Plugin init** — before MCP servers spawn and providers initialize, it parses the `.env` and populates `process.env`. This is what makes OpenCode's own `{env:VAR}` resolution succeed.
2. **`config` hook** — rewrites any `{env:VAR}` / `${VAR}` literals that survived into the merged config object (covers `opencode.json`, `dcp.jsonc`, and other plugins' config).
3. **`shell.env` hook** — injects the loaded variables into shell executions (bash tool + user terminals).

Unknown variables are left untouched, so a typo never silently blanks a value.

## .env Resolution

The plugin looks for a `.env` in your OpenCode config directory, resolved in this order:

1. `OPENCODE_DOTENV_DIR` — explicit directory to search.
2. `OPENCODE_CONFIG` — explicit config file; its directory is used.
3. `XDG_CONFIG_HOME/opencode`.
4. `~/.config/opencode` (OpenCode's default on every OS, including Windows).

An optional `OPENCODE_DOTENV_PATH` points at a specific `.env` file, which is loaded last and wins.

### Supported `.env` syntax

```bash
# comments and blank lines are ignored
export FOO=bar
API_KEY="example-key"
QUOTED='single quoted'
MULTILINE="line1\nline2"   # \n \t \r \\ \" unescaped inside double quotes
```

## Installation

### From npm (recommended)

Add the package to the `plugin` array in your OpenCode config at `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": ["@aeondave/opencode-dotenv@latest"]
}
```

OpenCode installs the plugin automatically on the next start. To pin a version, replace `@latest` with a specific version (e.g. `@0.1.0`).

### From a local clone (shim)

Run from a local checkout — useful before publishing or while hacking on the plugin:

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/AeonDave/opencode-dot-env.git
   cd opencode-dot-env
   npm install
   ```

2. Create a shim file in your global plugin directory that re-exports the checkout's entry point. The plugin directory is `plugins` (plural):

   - Path: `~/.config/opencode/plugins/dotenv.ts`
   - Content — a single line pointing at the absolute path of the cloned entry point:

   ```ts
   export { default } from "/absolute/path/to/opencode-dot-env/src/plugin/dotenv.ts"
   ```

   On Windows, use forward slashes and include the drive letter, for example:

   ```ts
   export { default } from "C:/path/to/opencode-dot-env/src/plugin/dotenv.ts"
   ```

3. Restart OpenCode. The plugin loads from your working tree, so edits to `src/` take effect on the next restart. Delete the shim file to uninstall.

> Use one method at a time. If you add the npm entry, remove the local shim (and vice versa) so the plugin is not loaded twice.

> **Directory name:** current OpenCode scans `plugins` (plural) — `~/.config/opencode/plugins/` and `.opencode/plugins/`. Some older builds used the singular `plugin/`. If the shim doesn't load, check your version (`opencode --version`) and try the other spelling.

## Usage

1. Put a `.env` next to your config:

   ```bash
   # ~/.config/opencode/.env
   API_KEY=your-api-key
   ACCESS_TOKEN=your-access-token
   ```

2. Reference the variables in your config as usual:

   ```jsonc
   // Example excerpt
   {
     "somePlugin": {
       "apiKey": "{env:API_KEY}",
       "accessToken": "${ACCESS_TOKEN}"
     }
   }
   ```

3. Start OpenCode normally — no wrapper script, no alias.

> Add `.env` to your `.gitignore`. Never commit real secrets.

## Configuration

| Environment variable | Default | Effect |
|----------------------|---------|--------|
| `OPENCODE_DOTENV_DIR` | unset | Directory to search for `.env` (overrides config-dir detection). |
| `OPENCODE_DOTENV_PATH` | unset | Path to an extra `.env` file, loaded last (highest priority). |
| `OPENCODE_DOTENV_OVERRIDE` | `0` | When truthy (`1`/`true`/`yes`/`on`), `.env` values replace existing process variables. By default existing variables are kept. |
| `OPENCODE_DOTENV_SILENT` | `0` | When truthy, suppress info/debug logs (warnings still shown). |

## Development

```bash
npm install      # install dev dependencies
npm run typecheck
```

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://github.com/sst/opencode).

## License

MIT
