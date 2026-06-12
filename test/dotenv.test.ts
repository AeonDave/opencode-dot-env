import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import OpencodeDotenv from "../src/plugin/dotenv"

// End-to-end checks of the plugin entry point: init populates process.env, the
// `config` hook substitutes placeholders, and `shell.env` injects values.

const TOUCHED = [
	"OPENCODE_DOTENV_DIR",
	"OPENCODE_DOTENV_PATH",
	"OPENCODE_CONFIG",
	"XDG_CONFIG_HOME",
	"OPENCODE_DOTENV_OVERRIDE",
	"OPENCODE_DOTENV_SILENT",
	"PLUGIN_TEST_KEY",
	"PLUGIN_TEST_TOKEN",
]

let snapshot: Record<string, string | undefined>
let dir: string

// Minimal input; the plugin only reads `client` (optional) from it here.
// biome-ignore lint: test stub
const stubInput = { client: undefined } as any

beforeEach(() => {
	snapshot = {}
	for (const key of TOUCHED) {
		snapshot[key] = process.env[key]
		delete process.env[key]
	}
	dir = mkdtempSync(path.join(os.tmpdir(), "dotenv-plugin-"))
	process.env.OPENCODE_DOTENV_DIR = dir
	process.env.OPENCODE_DOTENV_SILENT = "1"
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
	for (const key of TOUCHED) {
		const value = snapshot[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
})

function writeEnv(content: string): void {
	writeFileSync(path.join(dir, ".env"), content)
}

describe("plugin init", () => {
	test("loads .env into process.env", async () => {
		writeEnv("PLUGIN_TEST_KEY=secret-123")
		await OpencodeDotenv(stubInput)
		expect(process.env.PLUGIN_TEST_KEY).toBe("secret-123")
	})

	test("keeps existing process.env values by default", async () => {
		process.env.PLUGIN_TEST_KEY = "preexisting"
		writeEnv("PLUGIN_TEST_KEY=from-file")
		await OpencodeDotenv(stubInput)
		expect(process.env.PLUGIN_TEST_KEY).toBe("preexisting")
	})

	test("overrides existing values when OPENCODE_DOTENV_OVERRIDE is truthy", async () => {
		process.env.PLUGIN_TEST_KEY = "preexisting"
		process.env.OPENCODE_DOTENV_OVERRIDE = "1"
		writeEnv("PLUGIN_TEST_KEY=from-file")
		await OpencodeDotenv(stubInput)
		expect(process.env.PLUGIN_TEST_KEY).toBe("from-file")
	})

	test("does not throw when no .env exists", async () => {
		// No file written into dir.
		const hooks = await OpencodeDotenv(stubInput)
		expect(typeof hooks.config).toBe("function")
	})
})

describe("config hook", () => {
	test("substitutes placeholders in the merged config", async () => {
		writeEnv("PLUGIN_TEST_KEY=resolved-key\nPLUGIN_TEST_TOKEN=resolved-token")
		const hooks = await OpencodeDotenv(stubInput)
		const config = {
			somePlugin: { apiKey: "{env:PLUGIN_TEST_KEY}", token: "${PLUGIN_TEST_TOKEN}" },
		}
		// biome-ignore lint: hook stub
		await hooks.config?.(config as any)
		expect(config.somePlugin.apiKey).toBe("resolved-key")
		expect(config.somePlugin.token).toBe("resolved-token")
	})
})

describe("shell.env hook", () => {
	test("injects loaded variables into the shell environment", async () => {
		writeEnv("PLUGIN_TEST_KEY=shell-value")
		const hooks = await OpencodeDotenv(stubInput)
		const output: { env: Record<string, string> } = { env: {} }
		// biome-ignore lint: hook stub
		await hooks["shell.env"]?.({} as any, output as any)
		expect(output.env.PLUGIN_TEST_KEY).toBe("shell-value")
	})

	test("does not overwrite a value already set in the shell environment", async () => {
		writeEnv("PLUGIN_TEST_KEY=shell-value")
		const hooks = await OpencodeDotenv(stubInput)
		const output: { env: Record<string, string> } = { env: { PLUGIN_TEST_KEY: "already-set" } }
		// biome-ignore lint: hook stub
		await hooks["shell.env"]?.({} as any, output as any)
		expect(output.env.PLUGIN_TEST_KEY).toBe("already-set")
	})
})
