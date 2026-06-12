/**
 * .env discovery and parsing.
 *
 * Pure Node (fs/os/path) so it runs identically on Linux, macOS, and Windows
 * under the Bun runtime that OpenCode ships.
 *
 * @module plugin/env-file
 */

import { existsSync, readFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/** A single resolved key/value pair parsed from a .env file. */
export type EnvVars = Record<string, string>

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Resolve the OpenCode configuration directory in a cross-platform way.
 *
 * Resolution order:
 * 1. `OPENCODE_DOTENV_DIR` — explicit override of the directory to search.
 * 2. `OPENCODE_CONFIG` — explicit config file; its directory is used.
 * 3. `XDG_CONFIG_HOME/opencode`.
 * 4. `~/.config/opencode` (OpenCode's default on every OS, including Windows).
 */
export function resolveConfigDir(): string {
	const dirOverride = process.env.OPENCODE_DOTENV_DIR?.trim()
	if (dirOverride) return path.resolve(dirOverride)

	const configFile = process.env.OPENCODE_CONFIG?.trim()
	if (configFile) return path.dirname(path.resolve(configFile))

	const xdg = process.env.XDG_CONFIG_HOME?.trim()
	if (xdg) return path.join(path.resolve(xdg), "opencode")

	return path.join(os.homedir(), ".config", "opencode")
}

/**
 * Build the ordered list of candidate `.env` file paths.
 *
 * Later entries override earlier ones when the same key appears in multiple
 * files. By default only the OpenCode config dir `.env` is considered; an
 * explicit `OPENCODE_DOTENV_PATH` (a file) is appended last so it wins.
 *
 * @param configDir - Resolved OpenCode config directory.
 */
export function candidateEnvFiles(configDir: string): string[] {
	const files = [path.join(configDir, ".env")]

	const explicit = process.env.OPENCODE_DOTENV_PATH?.trim()
	if (explicit) files.push(path.resolve(explicit))

	return files
}

/**
 * Parse `.env` file content into a flat key/value map.
 *
 * Supported syntax:
 * - `KEY=value` and `export KEY=value`
 * - blank lines and lines starting with `#` are ignored
 * - surrounding single or double quotes are stripped
 * - inside double quotes, `\n`, `\t`, `\r`, `\\`, and `\"` are unescaped
 *
 * Values are taken literally otherwise (no inline comment stripping, no
 * variable expansion) to keep behavior predictable.
 */
export function parseEnv(content: string): EnvVars {
	const vars: EnvVars = {}

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith("#")) continue

		const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line
		const eq = withoutExport.indexOf("=")
		if (eq < 1) continue

		const key = withoutExport.slice(0, eq).trim()
		if (!KEY_RE.test(key)) continue

		let value = withoutExport.slice(eq + 1).trim()
		value = unquote(value)
		vars[key] = value
	}

	return vars
}

function unquote(value: string): string {
	if (value.length < 2) return value
	const first = value[0]
	const last = value[value.length - 1]

	if (first === '"' && last === '"') {
		// Single left-to-right pass so an escaped backslash (\\) consumes the
		// following character correctly: "a\\nb" yields a literal `a\nb`, not a
		// newline. A trailing lone backslash is left as-is.
		return value.slice(1, -1).replace(/\\([nrt"\\])/g, (_, ch: string) => {
			switch (ch) {
				case "n":
					return "\n"
				case "r":
					return "\r"
				case "t":
					return "\t"
				default:
					return ch // " or \
			}
		})
	}
	if (first === "'" && last === "'") {
		return value.slice(1, -1)
	}
	return value
}

/**
 * Load and merge all existing candidate `.env` files.
 *
 * @returns The merged variables and the list of files that were actually read.
 */
export function loadEnvFiles(files: string[]): { vars: EnvVars; loaded: string[] } {
	const vars: EnvVars = {}
	const loaded: string[] = []

	for (const file of files) {
		if (!existsSync(file)) continue
		try {
			const parsed = parseEnv(readFileSync(file, "utf8"))
			Object.assign(vars, parsed)
			loaded.push(file)
		} catch {
			// Ignore unreadable files; the caller reports what was loaded.
		}
	}

	return { vars, loaded }
}

/**
 * Apply parsed variables to `process.env`.
 *
 * By default existing real environment variables are preserved (standard
 * dotenv semantics). Set `override` to replace them.
 *
 * @returns The keys that were actually written.
 */
export function applyToProcessEnv(vars: EnvVars, override: boolean): string[] {
	const applied: string[] = []
	for (const [key, value] of Object.entries(vars)) {
		if (!override && process.env[key] !== undefined) continue
		process.env[key] = value
		applied.push(key)
	}
	return applied
}
