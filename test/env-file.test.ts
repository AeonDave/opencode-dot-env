import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
	applyToProcessEnv,
	candidateEnvFiles,
	loadEnvFiles,
	parseEnv,
	resolveConfigDir,
} from "../src/plugin/env-file"

// Keys this suite reads/writes; snapshotted and restored around every test so
// nothing leaks into the real process environment or across tests.
const TOUCHED = [
	"OPENCODE_DOTENV_DIR",
	"OPENCODE_CONFIG",
	"OPENCODE_DOTENV_PATH",
	"XDG_CONFIG_HOME",
	"DOTENV_TEST_A",
	"DOTENV_TEST_B",
]

let snapshot: Record<string, string | undefined>

beforeEach(() => {
	snapshot = {}
	for (const key of TOUCHED) {
		snapshot[key] = process.env[key]
		delete process.env[key]
	}
})

afterEach(() => {
	for (const key of TOUCHED) {
		const value = snapshot[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
})

describe("parseEnv", () => {
	test("parses plain KEY=value", () => {
		expect(parseEnv("FOO=bar")).toEqual({ FOO: "bar" })
	})

	test("strips the export prefix", () => {
		expect(parseEnv("export FOO=bar")).toEqual({ FOO: "bar" })
	})

	test("ignores comments and blank lines", () => {
		const content = ["# a comment", "", "  ", "FOO=bar", "# trailing"].join("\n")
		expect(parseEnv(content)).toEqual({ FOO: "bar" })
	})

	test("keeps '=' that appears inside the value", () => {
		expect(parseEnv("URL=a=b=c")).toEqual({ URL: "a=b=c" })
	})

	test("trims whitespace around key and value", () => {
		expect(parseEnv("  FOO  =  bar  ")).toEqual({ FOO: "bar" })
	})

	test("does not strip inline '#' (taken literally)", () => {
		expect(parseEnv("FOO=bar # not a comment")).toEqual({ FOO: "bar # not a comment" })
	})

	test("skips lines without '=' or with an empty key", () => {
		const content = ["NOEQUALS", "=novalue", "FOO=bar"].join("\n")
		expect(parseEnv(content)).toEqual({ FOO: "bar" })
	})

	test("skips invalid identifiers", () => {
		const content = ["1BAD=x", "BAD-KEY=y", "GOOD_KEY=z"].join("\n")
		expect(parseEnv(content)).toEqual({ GOOD_KEY: "z" })
	})

	test("handles CRLF line endings", () => {
		expect(parseEnv("A=1\r\nB=2")).toEqual({ A: "1", B: "2" })
	})

	test("later duplicate key wins", () => {
		expect(parseEnv("FOO=first\nFOO=second")).toEqual({ FOO: "second" })
	})

	describe("quoting", () => {
		test("strips surrounding double quotes", () => {
			expect(parseEnv('FOO="bar"')).toEqual({ FOO: "bar" })
		})

		test("strips surrounding single quotes", () => {
			expect(parseEnv("FOO='bar'")).toEqual({ FOO: "bar" })
		})

		test("unescapes \\n \\r \\t and \\\" inside double quotes", () => {
			expect(parseEnv('FOO="a\\nb\\tc\\rd\\"e"')).toEqual({ FOO: 'a\nb\tc\rd"e' })
		})

		test("treats a literal escaped backslash as a single backslash", () => {
			// "a\\nb" in the file means: a, backslash, n, b — NOT a newline.
			expect(parseEnv('FOO="a\\\\nb"')).toEqual({ FOO: "a\\nb" })
		})

		test("does not process escapes inside single quotes", () => {
			expect(parseEnv("FOO='a\\nb'")).toEqual({ FOO: "a\\nb" })
		})

		test("leaves an unmatched leading quote untouched", () => {
			expect(parseEnv('FOO="bar')).toEqual({ FOO: '"bar' })
		})
	})
})

describe("resolveConfigDir", () => {
	test("prefers OPENCODE_DOTENV_DIR", () => {
		process.env.OPENCODE_DOTENV_DIR = "/tmp/custom-dir"
		expect(resolveConfigDir()).toBe(path.resolve("/tmp/custom-dir"))
	})

	test("uses the directory of OPENCODE_CONFIG", () => {
		const cfg = path.join("/tmp", "place", "opencode.json")
		process.env.OPENCODE_CONFIG = cfg
		expect(resolveConfigDir()).toBe(path.dirname(path.resolve(cfg)))
	})

	test("uses XDG_CONFIG_HOME/opencode", () => {
		process.env.XDG_CONFIG_HOME = "/tmp/xdg"
		expect(resolveConfigDir()).toBe(path.join(path.resolve("/tmp/xdg"), "opencode"))
	})

	test("falls back to ~/.config/opencode", () => {
		expect(resolveConfigDir()).toBe(path.join(os.homedir(), ".config", "opencode"))
	})

	test("override precedence: DOTENV_DIR beats CONFIG and XDG", () => {
		process.env.OPENCODE_DOTENV_DIR = "/tmp/win"
		process.env.OPENCODE_CONFIG = "/tmp/lose/opencode.json"
		process.env.XDG_CONFIG_HOME = "/tmp/also-lose"
		expect(resolveConfigDir()).toBe(path.resolve("/tmp/win"))
	})
})

describe("candidateEnvFiles", () => {
	test("returns the config-dir .env by default", () => {
		expect(candidateEnvFiles("/cfg")).toEqual([path.join("/cfg", ".env")])
	})

	test("appends OPENCODE_DOTENV_PATH last so it wins", () => {
		process.env.OPENCODE_DOTENV_PATH = "/extra/.env.local"
		expect(candidateEnvFiles("/cfg")).toEqual([
			path.join("/cfg", ".env"),
			path.resolve("/extra/.env.local"),
		])
	})
})

describe("loadEnvFiles", () => {
	let dir: string

	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), "dotenv-test-"))
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	test("reads an existing file", () => {
		const file = path.join(dir, ".env")
		writeFileSync(file, "FOO=bar\nBAZ=qux")
		expect(loadEnvFiles([file])).toEqual({ vars: { FOO: "bar", BAZ: "qux" }, loaded: [file] })
	})

	test("ignores missing files", () => {
		const missing = path.join(dir, "does-not-exist")
		expect(loadEnvFiles([missing])).toEqual({ vars: {}, loaded: [] })
	})

	test("merges files with later files overriding earlier ones", () => {
		const a = path.join(dir, ".env")
		const b = path.join(dir, ".env.local")
		writeFileSync(a, "FOO=first\nONLY_A=a")
		writeFileSync(b, "FOO=second\nONLY_B=b")
		expect(loadEnvFiles([a, b])).toEqual({
			vars: { FOO: "second", ONLY_A: "a", ONLY_B: "b" },
			loaded: [a, b],
		})
	})
})

describe("applyToProcessEnv", () => {
	test("sets new variables and returns the applied keys", () => {
		const applied = applyToProcessEnv({ DOTENV_TEST_A: "1", DOTENV_TEST_B: "2" }, false)
		expect(applied.sort()).toEqual(["DOTENV_TEST_A", "DOTENV_TEST_B"])
		expect(process.env.DOTENV_TEST_A).toBe("1")
		expect(process.env.DOTENV_TEST_B).toBe("2")
	})

	test("preserves existing variables when override is false", () => {
		process.env.DOTENV_TEST_A = "existing"
		const applied = applyToProcessEnv({ DOTENV_TEST_A: "new" }, false)
		expect(applied).toEqual([])
		expect(process.env.DOTENV_TEST_A).toBe("existing")
	})

	test("replaces existing variables when override is true", () => {
		process.env.DOTENV_TEST_A = "existing"
		const applied = applyToProcessEnv({ DOTENV_TEST_A: "new" }, true)
		expect(applied).toEqual(["DOTENV_TEST_A"])
		expect(process.env.DOTENV_TEST_A).toBe("new")
	})
})
