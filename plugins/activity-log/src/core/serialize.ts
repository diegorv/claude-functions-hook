// Turns any value a hook sees into plain JSON data, whole: nothing is cut.
// What JSON cannot hold gets a stand-in (a cycle, a function, a host object),
// and nothing here throws: a getter that does is a "[Thrown: ...]" string.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// btoa takes one char per byte; chunked so a large buffer does not overflow the call's arguments.
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

// By shape: the environment's AbortSignal is a global the types give no `instanceof` to.
const isAbortSignal = (value: object) =>
  typeof (value as { aborted?: unknown }).aborted === "boolean" &&
  typeof (value as { addEventListener?: unknown }).addEventListener === "function";

// The class's name, or the tag a generator carries (its constructor has no name).
const tag = (value: object) => `[${value.constructor?.name || Object.prototype.toString.call(value).slice(8, -1)}]`;

export function errorData(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { name: typeof error, message: String(error) };
}

// One field of an object; a getter that throws gives a "[Thrown: ...]" string.
function field(value: object, key: string, ancestors: Set<object>): Json | undefined {
  try {
    return plain((value as Record<string, unknown>)[key], ancestors);
  } catch (error) {
    return `[Thrown: ${errorData(error).message}]`;
  }
}

// `ancestors` holds the objects on the path down to `value`: one seen twice
// side by side is kept twice, only one inside itself is a cycle.
function plain(value: unknown, ancestors: Set<object>): Json | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (ancestors.has(value)) return "[Circular]";
  if (value instanceof Uint8Array) return { base64: base64(value) };
  if (value instanceof ArrayBuffer) return { base64: base64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value))
    return { base64: base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (value instanceof Promise || isAbortSignal(value)) return tag(value);
  if (Symbol.asyncIterator in (value as object) || Symbol.iterator in (value as object)) {
    if (!Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set)) return tag(value);
  }
  ancestors.add(value);
  try {
    if (value instanceof Error) {
      // name, message, stack, then its own other fields (code, cause, errno...), enumerable or not.
      const out: { [key: string]: Json } = { ...errorData(value) };
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key in out) continue;
        const item = field(value, key, ancestors);
        if (item !== undefined) out[key] = item;
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((item) => plain(item, ancestors) ?? null);
    if (value instanceof Map)
      return [...value].map(([key, item]) => [plain(key, ancestors) ?? null, plain(item, ancestors) ?? null]);
    if (value instanceof Set) return [...value].map((item) => plain(item, ancestors) ?? null);
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
      return plain((value as { toJSON: () => unknown }).toJSON(), ancestors);
    }
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value)) {
      const item = field(value, key, ancestors);
      if (item !== undefined) out[key] = item;
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

// The value as JSON data; undefined when the value is undefined (a field left out).
export function toPlain(value: unknown): Json | undefined {
  try {
    return plain(value, new Set());
  } catch (error) {
    return `[Unserializable: ${errorData(error).message}]`;
  }
}
