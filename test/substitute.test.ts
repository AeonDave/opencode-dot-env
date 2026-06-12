import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { substituteConfig, substituteString } from "../src/plugin/substitute"

const TOUCHED = ["SUBST_A", "SUBST_B", "SUBST_MISSING"]

let snapshot: Record<string, string | undefined>

beforeEach(() => {
	snapshot = {}
	for (const key of TOUCHED) {
		snapshot[key] = process.env[key]
		delete process.env[key]
	}
	process.env.SUBST_A = "alpha"
	process.env.SUBST_B = "beta"
})

afterEach(() => {
	for (const key of TOUCHED) {
		const value = snapshot[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
})

describe("substituteString", () => {
	test("resolves the {env:VAR} form", () => {
		expect(substituteString("{env:SUBST_A}")).toEqual({ value: "alpha", count: 1 })
	})

	test("resolves the ${VAR} form", () => {
		expect(substituteString("${SUBST_A}")).toEqual({ value: "alpha", count: 1 })
	})

	test("resolves multiple placeholders and counts each", () => {
		expect(substituteString("{env:SUBST_A}-${SUBST_B}")).toEqual({ value: "alpha-beta", count: 2 })
	})

	test("substitutes inside surrounding text", () => {
		expect(substituteString("key=${SUBST_A};")).toEqual({ value: "key=alpha;", count: 1 })
	})

	test("leaves unknown variables untouched", () => {
		expect(substituteString("{env:SUBST_MISSING}")).toEqual({
			value: "{env:SUBST_MISSING}",
			count: 0,
		})
	})

	test("leaves strings without placeholders unchanged", () => {
		expect(substituteString("plain value")).toEqual({ value: "plain value", count: 0 })
	})

	test("substitutes empty-string env values", () => {
		process.env.SUBST_A = ""
		expect(substituteString("x={env:SUBST_A}")).toEqual({ value: "x=", count: 1 })
	})
})

describe("substituteConfig", () => {
	test("rewrites string values in a plain object in place", () => {
		const config: Record<string, unknown> = { apiKey: "{env:SUBST_A}", token: "${SUBST_B}" }
		const count = substituteConfig(config)
		expect(count).toBe(2)
		expect(config).toEqual({ apiKey: "alpha", token: "beta" })
	})

	test("recurses into nested objects and arrays", () => {
		const config = {
			mcp: { server: { env: { KEY: "{env:SUBST_A}" } } },
			list: ["${SUBST_B}", "literal", "{env:SUBST_A}"],
		}
		const count = substituteConfig(config)
		expect(count).toBe(3)
		expect(config.mcp.server.env.KEY).toBe("alpha")
		expect(config.list).toEqual(["beta", "literal", "alpha"])
	})

	test("returns 0 and leaves the object unchanged when nothing matches", () => {
		const config = { a: "plain", b: 42, c: true, d: null }
		expect(substituteConfig(config)).toBe(0)
		expect(config).toEqual({ a: "plain", b: 42, c: true, d: null })
	})

	test("leaves unknown placeholders intact", () => {
		const config = { a: "{env:SUBST_MISSING}", b: "{env:SUBST_A}" }
		const count = substituteConfig(config)
		expect(count).toBe(1)
		expect(config).toEqual({ a: "{env:SUBST_MISSING}", b: "alpha" })
	})

	test("ignores non-string scalar values", () => {
		const config = { num: 1, bool: false, nothing: null, nested: { also: 2 } }
		expect(substituteConfig(config)).toBe(0)
	})
})
