import { AlephaError, type TObject } from "alepha";
import type { PgQueryWhere } from "../interfaces/PgQueryWhere.ts";

/**
 * Parse a string query into a PgQueryWhere object.
 *
 * Supported syntax:
 * - Simple equality: "name=John"
 * - Wildcard patterns: "name=John*" (startsWith), "name=*John" (endsWith), "name=*John*" (contains)
 * - Operators: "age>18", "age>=18", "age<65", "age<=65", "status!=active"
 * - NULL checks: "deletedAt=null", "email!=null"
 * - IN arrays: "status=[pending,active]"
 * - AND conditions: "name=John&age>18"
 * - OR conditions: "name=John|email=john@example.com"
 * - Nested AND/OR: "(name=John|name=Jane)&age>18"
 * - JSONB nested: "profile.city=Paris"
 *
 * @example
 * ```ts
 * // Simple equality
 * parseQueryString("name=John")
 * // => { name: { eq: "John" } }
 *
 * // Wildcard patterns
 * parseQueryString("name=John*")  // startsWith
 * // => { name: { startsWith: "John" } }
 * parseQueryString("name=*Smith")  // endsWith
 * // => { name: { endsWith: "Smith" } }
 * parseQueryString("name=*oh*")  // contains
 * // => { name: { contains: "oh" } }
 *
 * // Multiple conditions
 * parseQueryString("name=John&age>18")
 * // => { and: [{ name: { eq: "John" } }, { age: { gt: 18 } }] }
 *
 * // OR conditions
 * parseQueryString("status=active|status=pending")
 * // => { or: [{ status: { eq: "active" } }, { status: { eq: "pending" } }] }
 *
 * // Complex nested
 * parseQueryString("(name=John|name=Jane)&age>18&status!=archived")
 * // => { and: [
 * //      { or: [{ name: { eq: "John" } }, { name: { eq: "Jane" } }] },
 * //      { age: { gt: 18 } },
 * //      { status: { ne: "archived" } }
 * //    ] }
 *
 * // JSONB nested query
 * parseQueryString("profile.city=Paris&profile.age>25")
 * // => { profile: { city: { eq: "Paris" }, age: { gt: 25 } } }
 * ```
 */
export function parseQueryString<T extends TObject>(
  query: string,
): PgQueryWhere<T> {
  if (!query || query.trim() === "") {
    return {};
  }

  const parser = new QueryStringParser(query);
  return parser.parse() as PgQueryWhere<T>;
}

// ---------------------------------------------------------------------------------------------------------------------

class QueryStringParser {
  protected pos = 0;
  protected readonly query: string;

  constructor(query: string) {
    this.query = query.trim();
  }

  parse(): PgQueryWhere<any> {
    return this.parseExpression();
  }

  protected parseExpression(): PgQueryWhere<any> {
    return this.parseOr();
  }

  protected parseOr(): any {
    const left = this.parseAnd();

    // Check for OR operator (|)
    if (this.peek() === "|") {
      const conditions = [left];

      while (this.peek() === "|") {
        this.consume("|");
        conditions.push(this.parseAnd());
      }

      return { or: conditions };
    }

    return left;
  }

  protected parseAnd(): any {
    const left = this.parsePrimary();

    // Check for AND operator (&)
    if (this.peek() === "&") {
      const conditions = [left];

      while (this.peek() === "&") {
        this.consume("&");
        conditions.push(this.parsePrimary());
      }

      return { and: conditions };
    }

    return left;
  }

  protected parsePrimary(): any {
    this.skipWhitespace();

    // Handle parentheses
    if (this.peek() === "(") {
      this.consume("(");
      const expr = this.parseExpression();
      this.consume(")");
      return expr;
    }

    // Parse field condition
    return this.parseCondition();
  }

  protected parseCondition(): any {
    const field = this.parseFieldPath();
    this.skipWhitespace();

    // Get operator
    const operator = this.parseOperator();
    this.skipWhitespace();

    // Get value
    const value = this.parseValue();

    if (value === "") {
      throw new AlephaError(`Expected value for field '${field.join(".")}'`);
    }

    // Build the condition object
    return this.buildCondition(field, operator, value);
  }

  protected parseFieldPath(): string[] {
    const path: string[] = [];
    let current = "";

    while (this.pos < this.query.length) {
      const ch = this.query[this.pos];

      if (ch === "." && current) {
        path.push(current);
        current = "";
        this.pos++;
        continue;
      }

      if (ch === "=" || ch === "!" || ch === ">" || ch === "<" || ch === " ") {
        break;
      }

      current += ch;
      this.pos++;
    }

    if (current) {
      path.push(current);
    }

    return path;
  }

  protected parseOperator(): string {
    this.skipWhitespace();

    const remaining = this.query.slice(this.pos);

    // Two-character operators
    if (remaining.startsWith(">=")) {
      this.pos += 2;
      return ">=";
    }
    if (remaining.startsWith("<=")) {
      this.pos += 2;
      return "<=";
    }
    if (remaining.startsWith("!=")) {
      this.pos += 2;
      return "!=";
    }

    // Single-character operators
    const ch = this.query[this.pos];
    if (ch === "=" || ch === ">" || ch === "<") {
      this.pos++;
      return ch;
    }

    throw new AlephaError(`Expected operator at position ${this.pos}`);
  }

  protected parseValue(): any {
    this.skipWhitespace();

    // Handle null
    if (this.query.slice(this.pos, this.pos + 4).toLowerCase() === "null") {
      this.pos += 4;
      return null;
    }

    // Handle arrays [value1,value2,...]
    if (this.query[this.pos] === "[") {
      return this.parseArray();
    }

    // Handle quoted strings
    if (this.query[this.pos] === '"' || this.query[this.pos] === "'") {
      return this.parseQuotedString();
    }

    // Parse unquoted value (until &, |, or ))
    let value = "";
    while (this.pos < this.query.length) {
      const ch = this.query[this.pos];
      if (ch === "&" || ch === "|" || ch === ")") {
        break;
      }
      value += ch;
      this.pos++;
    }

    return this.coerceValue(value.trim());
  }

  protected parseArray(): any[] {
    this.consume("[");
    const values: any[] = [];

    while (this.pos < this.query.length && this.query[this.pos] !== "]") {
      this.skipWhitespace();

      // Handle quoted values
      if (this.query[this.pos] === '"' || this.query[this.pos] === "'") {
        values.push(this.parseQuotedString());
      } else {
        // Parse until comma or ]
        let value = "";
        while (
          this.pos < this.query.length &&
          this.query[this.pos] !== "," &&
          this.query[this.pos] !== "]"
        ) {
          value += this.query[this.pos];
          this.pos++;
        }
        values.push(this.coerceValue(value.trim()));
      }

      this.skipWhitespace();
      if (this.query[this.pos] === ",") {
        this.pos++;
      }
    }

    this.consume("]");
    return values;
  }

  protected parseQuotedString(): string {
    const quote = this.query[this.pos];
    this.pos++; // Skip opening quote

    let value = "";
    let escaped = false;

    while (this.pos < this.query.length) {
      const ch = this.query[this.pos];

      if (escaped) {
        value += ch;
        escaped = false;
        this.pos++;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        this.pos++;
        continue;
      }

      if (ch === quote) {
        this.pos++; // Skip closing quote
        break;
      }

      value += ch;
      this.pos++;
    }

    return value;
  }

  protected coerceValue(value: string): any {
    // Try to parse as number
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    if (/^-?\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // Try to parse as boolean
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }

    return value;
  }

  protected buildCondition(path: string[], operator: string, value: any): any {
    // Map operator to filter operator
    let filterOp: any;

    if (operator === "=") {
      if (value === null) {
        filterOp = { isNull: true };
      } else if (Array.isArray(value)) {
        // Arrays should be treated as inArray regardless of content
        filterOp = { inArray: value };
      } else if (typeof value === "string" && value.includes("*")) {
        // Handle wildcard patterns
        const startsWithAsterisk = value.startsWith("*");
        const endsWithAsterisk = value.endsWith("*");
        const cleanValue = value.replace(/^\*|\*$/g, ""); // Remove leading/trailing asterisks

        if (startsWithAsterisk && endsWithAsterisk) {
          // *text* -> contains
          filterOp = { contains: cleanValue };
        } else if (startsWithAsterisk) {
          // *text -> endsWith
          filterOp = { endsWith: cleanValue };
        } else if (endsWithAsterisk) {
          // text* -> startsWith
          filterOp = { startsWith: cleanValue };
        } else {
          // Has asterisk in the middle, treat as literal
          filterOp = { eq: value };
        }
      } else {
        filterOp = { eq: value };
      }
    } else if (operator === "!=") {
      if (value === null) {
        filterOp = { isNotNull: true };
      } else {
        filterOp = { ne: value };
      }
    } else if (operator === ">") {
      filterOp = { gt: value };
    } else if (operator === ">=") {
      filterOp = { gte: value };
    } else if (operator === "<") {
      filterOp = { lt: value };
    } else if (operator === "<=") {
      filterOp = { lte: value };
    } else {
      throw new AlephaError(`Unsupported operator: ${operator}`);
    }

    // Build nested object for path
    if (path.length === 1) {
      return { [path[0]]: filterOp };
    }

    // Handle nested paths (JSONB)
    let result: any = filterOp;
    for (let i = path.length - 1; i >= 0; i--) {
      result = { [path[i]]: result };
    }

    return result;
  }

  protected peek(): string {
    this.skipWhitespace();
    return this.query[this.pos] || "";
  }

  protected consume(expected: string): void {
    this.skipWhitespace();
    if (this.query[this.pos] !== expected) {
      throw new AlephaError(
        `Expected '${expected}' at position ${this.pos}, got '${this.query[this.pos]}'`,
      );
    }
    this.pos++;
  }

  protected skipWhitespace(): void {
    while (this.pos < this.query.length && /\s/.test(this.query[this.pos])) {
      this.pos++;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Helper function to build query strings programmatically
 *
 * @example
 * ```ts
 * buildQueryString({
 *   and: [
 *     { name: "eq:John" },
 *     { age: "gt:18" }
 *   ]
 * })
 * // => "name=John&age>18"
 * ```
 */
export function buildQueryString(where: any): string {
  if (!where || typeof where !== "object") {
    return "";
  }

  // Handle logical operators
  if ("and" in where && Array.isArray(where.and)) {
    return where.and.map((w: any) => buildQueryString(w)).join("&");
  }

  if ("or" in where && Array.isArray(where.or)) {
    const parts = where.or.map((w: any) => buildQueryString(w));
    return parts.length > 1 ? `(${parts.join("|")})` : parts[0];
  }

  if ("not" in where) {
    // Not operator is harder to represent in string form
    // For now, we'll skip it or you could add a syntax like "!field=value"
    return "";
  }

  // Handle field conditions
  const parts: string[] = [];

  for (const [field, condition] of Object.entries(where)) {
    if (typeof condition !== "object" || condition === null) {
      parts.push(`${field}=${condition}`);
      continue;
    }

    if ("eq" in condition) {
      parts.push(`${field}=${condition.eq}`);
    } else if ("ne" in condition) {
      parts.push(`${field}!=${condition.ne}`);
    } else if ("gt" in condition) {
      parts.push(`${field}>${condition.gt}`);
    } else if ("gte" in condition) {
      parts.push(`${field}>=${condition.gte}`);
    } else if ("lt" in condition) {
      parts.push(`${field}<${condition.lt}`);
    } else if ("lte" in condition) {
      parts.push(`${field}<=${condition.lte}`);
    } else if ("contains" in condition) {
      parts.push(`${field}=*${condition.contains}*`);
    } else if ("startsWith" in condition) {
      parts.push(`${field}=${condition.startsWith}*`);
    } else if ("endsWith" in condition) {
      parts.push(`${field}=*${condition.endsWith}`);
    } else if ("isNull" in condition && condition.isNull) {
      parts.push(`${field}=null`);
    } else if ("isNotNull" in condition && condition.isNotNull) {
      parts.push(`${field}!=null`);
    } else if ("inArray" in condition && Array.isArray(condition.inArray)) {
      const values = condition.inArray.map((v: any) =>
        typeof v === "string" ? `"${v}"` : v,
      );
      parts.push(`${field}=[${values.join(",")}]`);
    } else {
      // Nested object (JSONB)
      const nested = buildQueryString(condition);
      if (nested) {
        parts.push(`${field}.${nested}`);
      }
    }
  }

  return parts.join("&");
}
