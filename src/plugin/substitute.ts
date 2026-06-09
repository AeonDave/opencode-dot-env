/**
 * Placeholder substitution for already-loaded config objects.
 *
 * OpenCode resolves its own `{env:VAR}` tokens at startup, but anything that
 * survives into the merged config object as a literal placeholder is rewritten
 * here using values now present in `process.env`. Both `{env:VAR}` and `${VAR}`
 * forms are supported. Unknown variables are left untouched so nothing gets
 * silently blanked.
 *
 * @module plugin/substitute
 */

// {env:NAME} or ${NAME} — NAME is a standard env identifier.
const PLACEHOLDER_RE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Replace placeholder tokens in a single string with values from `process.env`.
 *
 * @returns The substituted string and how many tokens were replaced.
 */
export function substituteString(input: string): { value: string; count: number } {
	let count = 0
	const value = input.replace(PLACEHOLDER_RE, (match, a: string | undefined, b: string | undefined) => {
		const name = a ?? b ?? ""
		const resolved = process.env[name]
		if (resolved === undefined) return match
		count++
		return resolved
	})
	return { value, count }
}

/**
 * Recursively rewrite placeholder strings inside a config object in place.
 *
 * Mutates arrays and plain objects directly so the change is visible to the
 * OpenCode `config` hook caller. Returns the total number of tokens replaced.
 */
export function substituteConfig(node: unknown): number {
	let total = 0

	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const child = node[i]
			if (typeof child === "string") {
				const { value, count } = substituteString(child)
				if (count > 0) {
					node[i] = value
					total += count
				}
			} else {
				total += substituteConfig(child)
			}
		}
		return total
	}

	if (node && typeof node === "object") {
		const obj = node as Record<string, unknown>
		for (const key of Object.keys(obj)) {
			const child = obj[key]
			if (typeof child === "string") {
				const { value, count } = substituteString(child)
				if (count > 0) {
					obj[key] = value
					total += count
				}
			} else {
				total += substituteConfig(child)
			}
		}
	}

	return total
}
