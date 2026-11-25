// Parse recovered tool arguments with the schema for the offered tool.
// Extracted from vscode-lm.ts.

/**
 * Non-string JSON Schema types a leaked parameter may be converted into, each paired with the
 * check that a parsed value must satisfy. A null-only declaration is settled by its own branch in
 * `convertLeakedParamValue` and so has no entry here.
 */
function structuredParamCheck(declaredType: string): ((parsed: unknown) => boolean) | undefined {
	const checks: Record<string, (parsed: unknown) => boolean> = {
		object: (parsed) => typeof parsed === "object" && !Array.isArray(parsed),
		array: (parsed) => Array.isArray(parsed),
		number: (parsed) => Number.isFinite(parsed),
		integer: (parsed) => Number.isInteger(parsed),
		boolean: (parsed) => typeof parsed === "boolean",
	}
	// Own-property only: a schema declaring `"toString"` would otherwise inherit a live function
	// from Object.prototype and be treated as a supported type.
	return Object.hasOwn(checks, declaredType) ? checks[declaredType] : undefined
}

/** A resolved declaration, or `undefined` when the schema does not pin down a single type. */
type DeclaredType = { type: string; nullable: boolean }

/** Resolves a `["T","null"]` type union to `T` while reporting that null is permitted. */
function resolveTypeUnion(types: string[]): DeclaredType | undefined {
	const nullable = types.includes("null")
	const nonNullTypes = types.filter((entry) => entry !== "null")
	// A null-only union has no non-null member; leaving the type unresolved would fall back to the
	// raw string "null", so name the null type and let convertLeakedParamValue settle it.
	if (nonNullTypes.length === 0) {
		return nullable ? { type: "null", nullable } : undefined
	}
	// Two or more non-null members leave the intended type ambiguous; picking one would coerce the
	// value to a type the tool may not accept, so the raw string is kept instead.
	return nonNullTypes.length === 1 ? { type: nonNullTypes[0], nullable } : undefined
}

/**
 * Declared type of `paramName`, resolving a nullable `["T","null"]` union to `T` while reporting
 * that null is permitted, so an explicit null is not mistaken for a wrong-typed value.
 *
 * MCP schemas reach this provider already rewritten by `normalizeToolSchema`, which turns such a
 * union into typed `anyOf` branches. Without reading that form a declared array or object would
 * fall through to the raw string, and the tool would receive `'["a","b"]'` instead of a list.
 */
function declaredParamType(schema: Record<string, unknown> | undefined, paramName: string): DeclaredType | undefined {
	const properties = schema?.["properties"] as Record<string, unknown> | undefined
	const property = properties?.[paramName] as Record<string, unknown> | undefined
	const type = property?.["type"]
	if (typeof type === "string") {
		// A bare declaration permits null only when the type IS "null", which convertLeakedParamValue
		// settles on its own before reading this flag.
		return { type, nullable: false }
	}
	if (Array.isArray(type)) {
		return resolveTypeUnion(type.filter((entry): entry is string => typeof entry === "string"))
	}
	const alternatives = property?.["anyOf"]
	if (Array.isArray(alternatives)) {
		const branchTypes: string[] = []
		for (const alternative of alternatives) {
			const branchType = (alternative as Record<string, unknown> | null)?.["type"]
			// Any branch that is not a simple named type (nested composition, $ref, enum-only) makes
			// the union unsupported here; bail out rather than guess at a partial reading.
			if (typeof branchType !== "string") {
				return undefined
			}
			branchTypes.push(branchType)
		}
		return resolveTypeUnion(branchTypes)
	}
	return undefined
}

/**
 * Converts one leaked parameter's raw text to the type its schema declares.
 *
 * Leaked markup carries no types — every value arrives as text — so a tool declaring an object or
 * array (`update_todo_list.todos`, `read_file.indentation`) would otherwise receive a flat string
 * and fail downstream. Only declared non-string types are JSON-parsed; a declared (or unknown)
 * string stays literal, because parsing every value would silently turn the text `"123"` or
 * `"null"` into a number or null. A value that does not parse, or parses to the wrong type, is
 * reported as a failure so the caller can pass the block through as text rather than dispatch a
 * malformed call.
 */
function convertLeakedParamValue(raw: string, declared: DeclaredType | undefined): { value: unknown } | undefined {
	if (declared === undefined || declared.type === "string") {
		return { value: raw }
	}
	// A null-only declaration admits the literal null and nothing else, so no parse is needed.
	if (declared.type === "null") {
		return raw === "null" ? { value: null } : undefined
	}
	const matchesDeclaredType = structuredParamCheck(declared.type)
	if (!matchesDeclaredType) {
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return undefined
	}

	// Must precede the table, whose object check would otherwise accept a null.
	if (parsed === null) {
		return declared.nullable ? { value: null } : undefined
	}

	return matchesDeclaredType(parsed) ? { value: parsed } : undefined
}

/**
 * Parses the parameters of a leaked `<invoke>` body against the tool's schema. Returns `undefined`
 * when any parameter cannot be converted, so the whole block is failed closed to unchanged text.
 */
export function parseLeakedInvokeParams(
	body: string,
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const input: Record<string, unknown> = {}
	const paramPattern = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?parameter\s*>/gi
	let consumedUpTo = 0
	for (const match of body.matchAll(paramPattern)) {
		const name = match[1]
		// A `<parameter` token in the gap before this match is an opener the pattern could not
		// parse, so recovering would dispatch a call missing an argument the model wrote.
		if (/<(?:antml:)?parameter\b/i.test(body.slice(consumedUpTo, match.index ?? 0))) {
			return undefined
		}
		// A nested unclosed `<parameter` inside the captured value means the lazy pattern swallowed
		// markup as data and dropped the inner parameter, so fail closed rather than dispatch it.
		if (/<(?:antml:)?parameter\b/i.test(match[2])) {
			return undefined
		}
		// A repeated name means injected markup split the block into adjacent well-formed matches,
		// which would silently rebind an argument to an attacker-chosen value.
		if (Object.hasOwn(input, name)) {
			return undefined
		}
		const converted = convertLeakedParamValue(match[2].trim(), declaredParamType(schema, name))
		if (!converted) {
			return undefined
		}
		input[name] = converted.value
		consumedUpTo = (match.index ?? 0) + match[0].length
	}
	// An unclosed parameter tag is skipped by the pattern above, so recovering would dispatch a
	// call missing an argument the model wrote; fail closed instead.
	if (/<(?:antml:)?parameter\b/i.test(body.slice(consumedUpTo))) {
		return undefined
	}
	if (schema !== undefined) {
		const props = schema.properties
		if (props === null || props === undefined || typeof props !== "object" || Array.isArray(props)) {
			return undefined
		}
		for (const k of Object.keys(input)) {
			if (!Object.hasOwn(props as Record<string, unknown>, k)) {
				return undefined
			}
		}
	}
	return input
}
