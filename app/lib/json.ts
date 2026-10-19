/**
 * JSON helpers shared by the theme and store engines.
 * Everything here is pure (no Node or browser APIs) so it can run in tests, loaders and the UI.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deterministic JSON.stringify: object keys sorted, so equal values always serialize equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined) out[key] = sortKeysDeep(v);
    }
    return out;
  }
  return value;
}

/** Structural equality that ignores key order (undefined keys are treated as absent). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return stableStringify(a) === stableStringify(b);
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A path into a JSON document, e.g. ["sections", "main", "settings", "title"]. */
export type JsonPath = (string | number)[];

export function pathToString(path: JsonPath): string {
  if (path.length === 0) return "(root)";
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : /^[A-Za-z_$][\w$-]*$/.test(segment)
          ? (index === 0 ? "" : ".") + segment
          : `[${JSON.stringify(segment)}]`,
    )
    .join("");
}

export function getAtPath(root: unknown, path: JsonPath): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * Returns a copy of `root` with `value` written at `path`.
 * Writing `undefined` deletes the key (or array element).
 */
export function setAtPath<T>(root: T, path: JsonPath, value: unknown): T {
  if (path.length === 0) return value as T;
  const copy = clone(root) as unknown;
  let current = copy as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (current[segment] === undefined || current[segment] === null) {
      current[segment] = typeof path[i + 1] === "number" ? [] : {};
    }
    current = current[segment] as Record<string | number, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined) {
    if (Array.isArray(current) && typeof last === "number") current.splice(last, 1);
    else delete current[last];
  } else {
    current[last] = value;
  }
  return copy as T;
}
