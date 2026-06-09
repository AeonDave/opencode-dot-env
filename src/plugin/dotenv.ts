/**
 * opencode-dotenv
 *
 * Loads a `.env` file located next to your OpenCode config into the running
 * process, so `{env:VAR}` placeholders in `opencode.json`, MCP definitions,
 * provider options, and other plugins' config resolve without a shell wrapper.
 *
 * What it does, in order:
 * 1. On plugin init (earliest plugin entry point, before MCP servers spawn and
 *    providers initialize): parse the `.env` and populate `process.env`.
 * 2. `config` hook: rewrite any `{env:VAR}` / `${VAR}` literals still present in
 *    the merged config object.
 * 3. `shell.env` hook: inject the loaded variables into bash and user terminals.
 *
 * Cross-platform (Linux, macOS, Windows) and zero runtime dependencies.
 *
 * @module plugin/dotenv
 */

import type { Plugin } from "@opencode-ai/plugin"
import {
	applyToProcessEnv,
	candidateEnvFiles,
	type EnvVars,
	loadEnvFiles,
	resolveConfigDir,
} from "./env-file"
import { substituteConfig } from "./substitute"

interface LogClient {
	app?: {
		log?: (opts: {
			body: { service: string; level: "debug" | "info" | "warn" | "error"; message: string }
		}) => Promise<unknown>
	}
}

const SERVICE = "dotenv"

function isTruthy(value: string | undefined): boolean {
	if (!value) return false
	const v = value.trim().toLowerCase()
	return v === "1" || v === "true" || v === "yes" || v === "on"
}

function makeLogger(client: LogClient | undefined, silent: boolean) {
	return (level: "debug" | "info" | "warn", message: string): void => {
		if (silent && level !== "warn") return
		// Call through the client object so the SDK method keeps its `this`
		// binding (it references an internal client); a detached reference throws.
		if (client?.app?.log) {
			client.app.log({ body: { service: SERVICE, level, message } }).catch(() => {})
			return
		}
		const line = `[${SERVICE}] ${message}`
		if (level === "warn") console.warn(line)
		else console.error(line)
	}
}

const OpencodeDotenv: Plugin = async (input) => {
	const override = isTruthy(process.env.OPENCODE_DOTENV_OVERRIDE)
	const silent = isTruthy(process.env.OPENCODE_DOTENV_SILENT)
	const log = makeLogger(input.client as LogClient | undefined, silent)

	// Step 1: load .env and populate process.env as early as possible.
	const configDir = resolveConfigDir()
	const files = candidateEnvFiles(configDir)
	const { vars, loaded } = loadEnvFiles(files)
	const loadedVars: EnvVars = vars

	if (loaded.length === 0) {
		log("debug", `no .env found (looked in: ${files.join(", ")})`)
	} else {
		const applied = applyToProcessEnv(vars, override)
		log(
			"info",
			`loaded ${Object.keys(vars).length} var(s) from ${loaded.join(", ")}; ` +
				`set ${applied.length} into process.env${override ? " (override)" : ""}`,
		)
	}

	return {
		// Step 2: rewrite placeholders that survived into the merged config.
		config: async (config) => {
			const replaced = substituteConfig(config)
			if (replaced > 0) log("debug", `substituted ${replaced} placeholder(s) in config`)
		},

		// Step 3: inject loaded values into shell executions (bash tool + terminals).
		"shell.env": async (_input, output) => {
			for (const key of Object.keys(loadedVars)) {
				const value = process.env[key]
				if (value === undefined) continue
				if (!override && output.env[key] !== undefined) continue
				output.env[key] = value
			}
		},
	}
}

export default OpencodeDotenv
