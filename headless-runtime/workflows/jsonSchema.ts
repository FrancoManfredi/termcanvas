/**
 * Validador mínimo de JSON Schema para `output_format` de workflows.
 *
 * OpenCode desactiva su `format` por default (ver structuredOutput.ts), así que
 * el JSON llega en texto y el executor lo extrae con jsonExtract. Este módulo
 * cierra el último hueco: valida el objeto contra el esquema declarado con el
 * subconjunto que usan los workflows (type, enum, required, properties, items,
 * additionalProperties). Sin dependencias ni evaluación de `$ref`.
 * Puro, nunca lanza: devuelve el primer error legible o null.
 */

export type JsonSchemaLike = Record<string, unknown>;

const MAX_DEPTH = 20;

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, expected: unknown): boolean {
  if (typeof expected !== "string") return true;
  switch (expected) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function equalJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function validateInternal(
  value: unknown,
  schema: JsonSchemaLike,
  path: string,
  depth: number,
): string | null {
  if (depth > MAX_DEPTH) return `${path}: esquema demasiado profundo`;
  if (!schema || typeof schema !== "object") return null;

  const expected = schema.type;
  if (Array.isArray(expected)) {
    if (!expected.some((candidate) => matchesType(value, candidate))) {
      return `${path}: se esperaba ${expected.join(" | ")}, llegó ${typeName(value)}`;
    }
  } else if (typeof expected === "string" && !matchesType(value, expected)) {
    return `${path}: se esperaba ${expected}, llegó ${typeName(value)}`;
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((candidate) => equalJson(candidate, value))) {
      return `${path}: valor fuera del enum permitido`;
    }
  }

  if (Array.isArray(schema.required)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return `${path}: required exige un objeto`;
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required) {
      if (typeof key === "string" && !(key in record)) {
        return `${path}: falta el campo requerido "${key}"`;
      }
    }
  }

  if (schema.properties && typeof schema.properties === "object") {
    const props = schema.properties as Record<string, JsonSchemaLike>;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const [key, childSchema] of Object.entries(props)) {
        if (!(key in record)) continue;
        const error = validateInternal(
          record[key],
          childSchema,
          path ? `${path}.${key}` : key,
          depth + 1,
        );
        if (error) return error;
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in props)) {
            return `${path}: campo no permitido "${key}"`;
          }
        }
      }
    }
  }

  if (schema.items !== undefined && Array.isArray(value)) {
    const itemSchema = schema.items as JsonSchemaLike;
    for (let index = 0; index < value.length; index += 1) {
      const error = validateInternal(
        value[index],
        itemSchema,
        `${path}[${index}]`,
        depth + 1,
      );
      if (error) return error;
    }
  }

  return null;
}

/** Valida `value` contra `schema`. Devuelve mensaje de error o null si es válido. */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaLike | undefined,
): string | null {
  try {
    if (!schema) return null;
    return validateInternal(value, schema, "output", 0);
  } catch {
    return "output: error validando el esquema";
  }
}
