import { allLocales, Faker, faker } from "@faker-js/faker";
import type {
  Infer,
  ZObject,
  ZodArray,
  ZodBoolean,
  ZodNumber,
  ZodRecord,
  ZodString,
  ZType,
} from "alepha";
import { AlephaError, z } from "alepha";

export interface FakeOptions {
  /**
   * Faker locale to use for generating fake data.
   * @default "en"
   */
  locale?: string;

  /**
   * Seed for deterministic fake data generation.
   */
  seed?: number;

  /**
   * Probability (0-1) that an optional field will be undefined.
   * @default 0.3
   */
  optionalProbability?: number;

  /**
   * Probability (0-1) that a nullable field will be null.
   * @default 0.2
   */
  nullableProbability?: number;

  /**
   * Default number of items to generate for arrays when maxItems is not specified.
   * @default 5
   */
  defaultArrayLength?: number;

  /**
   * Maximum number of items to generate for arrays.
   * Set to Infinity to respect schema's maxItems without cap.
   * @default 20
   */
  maxArrayLength?: number;

  /**
   * Default number of entries to generate for record types.
   * @default { min: 2, max: 5 }
   */
  defaultRecordEntries?: { min: number; max: number };
}

/**
 * Generate fake data from Zod schemas using faker.js.
 *
 * @example
 * ```ts
 * const fake = new FakeProvider();
 * const userSchema = z.object({
 *   id: z.uuid(),
 *   name: z.text(),
 *   email: z.email(),
 * });
 * const fakeUser = fake.generate(userSchema);
 *
 * // Configure options
 * fake.configure({ seed: 99999, optionalProbability: 0.5 });
 * ```
 */
export class FakeProvider {
  protected faker = faker;
  protected readonly guard = z.schema;
  protected options: Required<FakeOptions> = {
    locale: "en",
    seed: 12345,
    optionalProbability: 0.3,
    nullableProbability: 0.2,
    defaultArrayLength: 5,
    maxArrayLength: 20,
    defaultRecordEntries: { min: 2, max: 5 },
  };

  constructor() {
    this.faker.seed(this.options.seed);
  }

  /**
   * Configure generation options.
   * If a seed is provided, the faker instance is reseeded.
   */
  public configure(options: Partial<FakeOptions>): this {
    const oldSeed = this.options.seed;

    this.options = {
      ...this.options,
      ...options,
      // Merge defaultRecordEntries if provided
      defaultRecordEntries: options.defaultRecordEntries
        ? {
            ...this.options.defaultRecordEntries,
            ...options.defaultRecordEntries,
          }
        : this.options.defaultRecordEntries,
    };

    // Swap the faker instance when the locale changes — the option is
    // documented as "Faker locale to use for generating fake data", so it has
    // to actually drive the corpus. Falls back to `en` for keys the locale
    // doesn't define.
    if (options.locale !== undefined) {
      const locale = (allLocales as Record<string, unknown>)[options.locale];
      if (!locale) {
        throw new AlephaError(
          `Unknown faker locale '${options.locale}'. Use one of: ${Object.keys(allLocales).slice(0, 8).join(", ")}, …`,
        );
      }
      this.faker = new Faker({ locale: [locale as never, allLocales.en] });
      this.faker.seed(this.options.seed);
    }

    // Reseed faker if seed is provided (allows resetting to same seed)
    if (options.seed !== undefined) {
      this.faker.seed(options.seed);
    }

    return this;
  }

  /**
   * Generate fake data matching the given Zod schema.
   *
   * For object schemas, property names are used to generate contextually
   * appropriate values. The following field name patterns are recognized
   * (case-insensitive, underscores and hyphens are ignored):
   *
   * **String fields:**
   * - `email` → email address
   * - `firstName`, `first` → first name
   * - `lastName`, `last` → last name
   * - `fullName`, `name` → full name
   * - `username` → username
   * - `phone`, `mobile` → phone number
   * - `address` → street address
   * - `city` → city name
   * - `country` → country name
   * - `state`, `province` → state/province
   * - `zip`, `postal` → postal code
   * - `company`, `organization` → company name
   * - `job`, `title`, `position` → job title
   * - `url`, `website` → URL
   * - `avatar`, `image`, `photo` → avatar URL
   * - `color`, `colour` → color name
   * - `bio`, `about`, `description` → bio text
   *
   * **Number/Integer fields:**
   * - `age` → 18-99
   * - `year` → past year
   * - `month` → 1-12
   * - `day` → 1-31
   * - `price`, `amount`, `cost` → monetary value
   *
   * @example
   * ```ts
   * const fake = new FakeProvider();
   * const schema = z.object({
   *   user_name: z.string(),  // generates username
   *   firstName: z.string(),  // generates first name
   *   "e-mail": z.string(),   // generates email
   * });
   * const result = fake.generate(schema);
   * ```
   */
  public generate<T extends ZType>(schema: T): Infer<T> {
    return this.generateValue(schema) as Infer<T>;
  }

  /**
   * Generate multiple fake data items.
   */
  public generateMany<T extends ZType>(schema: T, count: number): Infer<T>[] {
    return Array.from({ length: count }, () => this.generate(schema));
  }

  protected generateValue(schema: ZType): unknown {
    const s = schema as any;

    // Handle optional — peel one layer and recurse
    if (this.guard.isOptional(schema)) {
      if (
        this.faker.datatype.boolean({
          probability: this.options.optionalProbability,
        })
      ) {
        return undefined;
      }
      return this.generateValue(s.unwrap());
    }

    // Handle nullable (zod ZodNullable — distinct from a union-with-null)
    if (this.guard.isNullable(schema)) {
      if (
        this.faker.datatype.boolean({
          probability: this.options.nullableProbability,
        })
      ) {
        return null;
      }
      return this.generateValue(s.unwrap());
    }

    // Handle default — generate a value for the wrapped type
    if (z.schema.isDefault(s)) {
      return this.generateValue(s.unwrap() as ZType);
    }

    // Handle enum
    if (this.guard.isEnum(schema)) {
      const values = z.schema.enumValues(schema);
      return values[this.faker.number.int({ min: 0, max: values.length - 1 })];
    }

    // Handle union (a union containing null behaves like nullable)
    if (this.guard.isUnion(schema)) {
      const members = this.guard.options(schema);
      const hasNull = members.some((m) => this.guard.isNull(m));
      if (hasNull) {
        if (
          this.faker.datatype.boolean({
            probability: this.options.nullableProbability,
          })
        ) {
          return null;
        }
        const nonNull = members.filter((m) => !this.guard.isNull(m));
        return this.generateValue(
          nonNull[
            this.faker.number.int({ min: 0, max: nonNull.length - 1 })
          ] as ZType,
        );
      }
      return this.generateValue(
        members[
          this.faker.number.int({ min: 0, max: members.length - 1 })
        ] as ZType,
      );
    }

    // Handle null
    if (this.guard.isNull(schema)) {
      return null;
    }

    // Handle undefined / void
    if (this.guard.isUndefined(schema) || this.guard.isVoid(schema)) {
      return undefined;
    }

    // Handle literal
    if (this.guard.isLiteral(schema)) {
      return s.value;
    }

    // Handle bigint (a validated string) — must precede the plain-string check
    if (this.guard.isBigInt(schema)) {
      return this.generateBigInt(schema as ZodString);
    }

    // Handle string
    if (this.guard.isString(schema)) {
      return this.generateString(schema as ZodString);
    }

    // Handle integer — must precede the plain-number check
    if (this.guard.isInteger(schema)) {
      return this.generateInteger(schema as ZodNumber);
    }

    // Handle number
    if (this.guard.isNumber(schema)) {
      return this.generateNumber(schema as ZodNumber);
    }

    // Handle boolean
    if (this.guard.isBoolean(schema)) {
      return this.generateBoolean(schema as ZodBoolean);
    }

    // Handle array
    if (this.guard.isArray(schema)) {
      return this.generateArray(schema as ZodArray);
    }

    // Handle object
    if (this.guard.isObject(schema)) {
      return this.generateObject(schema as ZObject);
    }

    // Handle record
    if (this.guard.isRecord(schema)) {
      return this.generateRecord(schema as ZodRecord);
    }

    // Handle tuple
    if (this.guard.isTuple(schema)) {
      const items = this.guard.items(schema);
      return items.map((item) => this.generateValue(item));
    }

    // Handle any / unknown
    if (this.guard.isAny(schema) || this.guard.isUnsafe(schema)) {
      const types = ["string", "number", "boolean"];
      const kind =
        types[this.faker.number.int({ min: 0, max: types.length - 1 })];
      if (kind === "number") return this.faker.number.float();
      if (kind === "boolean") return this.faker.datatype.boolean();
      return this.faker.lorem.word();
    }

    // Fallback
    return this.faker.lorem.word();
  }

  protected generateString(schema: ZodString): string {
    const schemaAny = schema as any;
    const format = z.schema.format(schema);
    const metaObj = (schemaAny.meta?.() ?? {}) as Record<string, any>;
    const rawPattern = metaObj.pattern;
    const pattern =
      typeof rawPattern === "string"
        ? rawPattern
        : (rawPattern?.source ?? undefined);
    const minLength = schemaAny.minLength ?? undefined;
    const maxLength = schemaAny.maxLength ?? undefined;

    // Handle specific formats
    if (format) {
      switch (format) {
        case "uuid":
          return this.faker.string.uuid();
        case "email":
          return this.faker.internet.email();
        case "url":
          return this.faker.internet.url();
        case "date-time":
          return this.faker.date.recent().toISOString();
        case "date":
          return this.faker.date.recent().toISOString().split("T")[0];
        case "time":
          return this.faker.date.recent().toISOString().split("T")[1];
        case "bigint":
          return this.faker.number
            .bigInt({ min: -9007199254740991n, max: 9007199254740991n })
            .toString();
        case "binary":
          return btoa(this.faker.string.alphanumeric(20));
      }
    }

    // Handle E.164 phone pattern
    if (pattern?.includes("\\+[1-9]\\d{1,14}")) {
      // Generate a proper E.164 format: + followed by 1-15 digits
      const countryCode = this.faker.number.int({ min: 1, max: 999 });
      const phoneNumber = this.faker.string.numeric({
        length: this.faker.number.int({ min: 7, max: 11 }),
      });
      return `+${countryCode}${phoneNumber}`;
    }

    // Handle BCP 47 language tag pattern
    if (pattern?.includes("[a-z]{2,3}")) {
      const locales = ["en", "en-US", "fr", "fr-CA", "es", "de", "it", "ja"];
      return locales[
        this.faker.number.int({ min: 0, max: locales.length - 1 })
      ];
    }

    // Handle snake_case pattern
    if (pattern === "^[A-Z_-]+$") {
      return this.faker.lorem
        .word()
        .toUpperCase()
        .replace(/[^A-Z]/g, "_");
    }

    // Generate text based on length constraints
    let text: string;
    if (maxLength !== undefined) {
      if (maxLength <= 10) {
        text = this.faker.lorem.word();
      } else if (maxLength <= 64) {
        text = this.faker.lorem.words(2);
      } else if (maxLength <= 255) {
        text = this.faker.lorem.sentence();
      } else if (maxLength <= 1024) {
        text = this.faker.lorem.paragraph(1);
      } else {
        text = this.faker.lorem.paragraphs(3);
      }
    } else {
      text = this.faker.lorem.sentence();
    }

    // Ensure min/max length constraints
    if (minLength !== undefined && text.length < minLength) {
      text = text.padEnd(minLength, " ");
    }
    if (maxLength !== undefined && text.length > maxLength) {
      text = text.slice(0, maxLength);
    }

    return text;
  }

  protected generateNumber(schema: ZodNumber): number {
    const schemaAny = schema as any;
    // zod exposes numeric bounds as `.minValue` / `.maxValue` (number | null).
    const min = schemaAny.minValue ?? -1000000;
    const max = schemaAny.maxValue ?? 1000000;
    // `.multipleOf` is a builder method on zod schemas, not a value — only use
    // it if it surfaces as an actual number.
    const multipleOf =
      typeof schemaAny.multipleOf === "number"
        ? schemaAny.multipleOf
        : undefined;

    let value = this.faker.number.float({ min, max });

    if (multipleOf != null) {
      value = Math.round(value / multipleOf) * multipleOf;
    }

    return value;
  }

  protected generateInteger(schema: ZodNumber): number {
    const schemaAny = schema as any;
    const min = schemaAny.minValue ?? -2147483647;
    const max = schemaAny.maxValue ?? 2147483647;

    return this.faker.number.int({ min, max });
  }

  protected generateBigInt(schema: ZodString): string {
    return this.faker.number
      .bigInt({ min: -9007199254740991n, max: 9007199254740991n })
      .toString();
  }

  protected generateBoolean(_schema: ZodBoolean): boolean {
    return this.faker.datatype.boolean();
  }

  protected generateArray(schema: ZodArray): unknown[] {
    // Native zod stores `.min()`/`.max()` length bounds in `_zod.def.checks`,
    // not in `.meta()`. Read those (falling back to legacy meta minItems/maxItems).
    const def = (schema as any)._zod?.def;
    const checks = (def?.checks ?? []) as any[];
    const readBound = (check: string, key: string): number | undefined => {
      for (const c of checks) {
        const d = c?._zod?.def;
        if (d?.check === check) return d[key];
      }
      return undefined;
    };
    const metaObj = ((schema as any).meta?.() ?? {}) as Record<string, any>;
    const minItems =
      readBound("min_length", "minimum") ?? metaObj.minItems ?? 0;
    const maxItems = Math.min(
      readBound("max_length", "maximum") ??
        metaObj.maxItems ??
        this.options.defaultArrayLength,
      this.options.maxArrayLength,
    );
    const length = this.faker.number.int({
      min: minItems,
      max: Math.max(minItems, maxItems),
    });

    const element = this.guard.element(schema) ?? def?.element;
    return Array.from({ length }, () => this.generateValue(element));
  }

  protected generateObject(schema: ZObject): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, propSchema] of Object.entries(this.guard.shape(schema))) {
      result[key] = this.generateValueWithContext(propSchema, key);
    }

    return result;
  }

  /**
   * Generate a value with context from the property key name.
   * This helps generate more realistic fake data based on field names.
   */
  protected generateValueWithContext(schema: ZType, keyName?: string): unknown {
    // If no key name context, use regular generation
    if (!keyName) {
      return this.generateValue(schema);
    }

    // Normalize key name: lowercase and remove underscores/hyphens
    // This allows matching "user_name", "user-name", "userName" etc.
    const normalizedKey = keyName.toLowerCase().replace(/[_-]/g, "");

    // Check if this is a string type that could benefit from context
    if (this.guard.isString(schema)) {
      const stringSchema = schema as ZodString;

      // Skip if it has a specific format already
      if (
        z.schema.format(stringSchema) &&
        z.schema.format(stringSchema) !== "string"
      ) {
        return this.generateValue(schema);
      }

      // Skip if it has enum values
      if ((stringSchema as any).enum) {
        return this.generateValue(schema);
      }

      // Generate based on common field name patterns
      if (normalizedKey.includes("email")) {
        return this.faker.internet.email();
      }
      if (normalizedKey.includes("firstname") || normalizedKey === "first") {
        return this.faker.person.firstName();
      }
      if (normalizedKey.includes("lastname") || normalizedKey === "last") {
        return this.faker.person.lastName();
      }
      if (normalizedKey.includes("fullname") || normalizedKey === "name") {
        return this.faker.person.fullName();
      }
      if (normalizedKey.includes("phone") || normalizedKey.includes("mobile")) {
        return this.faker.phone.number();
      }
      if (normalizedKey.includes("address")) {
        return this.faker.location.streetAddress();
      }
      if (normalizedKey.includes("city")) {
        return this.faker.location.city();
      }
      if (normalizedKey.includes("country")) {
        return this.faker.location.country();
      }
      if (
        normalizedKey.includes("state") ||
        normalizedKey.includes("province")
      ) {
        return this.faker.location.state();
      }
      if (normalizedKey.includes("zip") || normalizedKey.includes("postal")) {
        return this.faker.location.zipCode();
      }
      if (
        normalizedKey.includes("company") ||
        normalizedKey.includes("organization")
      ) {
        return this.faker.company.name();
      }
      if (
        normalizedKey.includes("job") ||
        normalizedKey.includes("title") ||
        normalizedKey.includes("position")
      ) {
        return this.faker.person.jobTitle();
      }
      if (normalizedKey.includes("username")) {
        return this.faker.internet.username();
      }
      if (normalizedKey.includes("url") || normalizedKey.includes("website")) {
        return this.faker.internet.url();
      }
      if (
        normalizedKey.includes("avatar") ||
        normalizedKey.includes("image") ||
        normalizedKey.includes("photo")
      ) {
        return this.faker.image.avatar();
      }
      if (normalizedKey.includes("color") || normalizedKey.includes("colour")) {
        return this.faker.color.human();
      }
      if (
        normalizedKey.includes("bio") ||
        normalizedKey.includes("about") ||
        normalizedKey.includes("description")
      ) {
        return this.faker.person.bio();
      }
    }

    // For number/integer fields, check for common patterns
    if (this.guard.isInteger(schema) || this.guard.isNumber(schema)) {
      if (normalizedKey.includes("age")) {
        return this.faker.number.int({ min: 18, max: 99 });
      }
      if (normalizedKey.includes("year")) {
        return this.faker.date.past().getFullYear();
      }
      if (normalizedKey.includes("month")) {
        return this.faker.number.int({ min: 1, max: 12 });
      }
      if (normalizedKey.includes("day")) {
        return this.faker.number.int({ min: 1, max: 31 });
      }
      if (
        normalizedKey.includes("price") ||
        normalizedKey.includes("amount") ||
        normalizedKey.includes("cost")
      ) {
        return this.faker.number.float({ min: 1, max: 1000, multipleOf: 0.01 });
      }
    }

    // Fallback to regular generation
    return this.generateValue(schema);
  }

  protected generateRecord(schema: ZodRecord): Record<string, unknown> {
    const record = schema as any;
    // zod stores the value schema on `.valueType` (def.valueType internally).
    const valueSchema =
      record.valueType ?? record._zod?.def?.valueType ?? z.any();

    // Generate 2-5 random key-value pairs
    const count = this.faker.number.int(this.options.defaultRecordEntries);
    const result: Record<string, unknown> = {};

    for (let i = 0; i < count; i++) {
      const key = this.faker.lorem.word();
      result[key] = this.generateValue(valueSchema);
    }

    return result;
  }
}
