import { faker } from "@faker-js/faker";
import type {
  StaticDecode,
  TArray,
  TBoolean,
  TInteger,
  TNumber,
  TObject,
  TRecord,
  TSchema,
  TString,
  TUnion,
} from "alepha";
import { TypeGuard } from "alepha";

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
 * Generate fake data from TypeBox schemas using faker.js.
 *
 * @example
 * ```ts
 * const fake = new FakeProvider();
 * const userSchema = t.object({
 *   id: t.uuid(),
 *   name: t.text(),
 *   email: t.email(),
 * });
 * const fakeUser = fake.generate(userSchema);
 *
 * // Configure options
 * fake.configure({ seed: 99999, optionalProbability: 0.5 });
 * ```
 */
export class FakeProvider {
  protected readonly faker = faker;
  protected readonly guard = new TypeGuard();
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

    // Reseed faker if seed is provided (allows resetting to same seed)
    if (options.seed !== undefined) {
      this.faker.seed(options.seed);
    }

    return this;
  }

  /**
   * Generate fake data matching the given TypeBox schema.
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
   * const schema = t.object({
   *   user_name: t.string(),  // generates username
   *   firstName: t.string(),  // generates first name
   *   "e-mail": t.string(),   // generates email
   * });
   * const result = fake.generate(schema);
   * ```
   */
  public generate<T extends TSchema>(schema: T): StaticDecode<T> {
    return this.generateValue(schema) as StaticDecode<T>;
  }

  /**
   * Generate multiple fake data items.
   */
  public generateMany<T extends TSchema>(
    schema: T,
    count: number,
  ): StaticDecode<T>[] {
    return Array.from({ length: count }, () => this.generate(schema));
  }

  protected generateValue(schema: TSchema): unknown {
    // Handle optional
    if (this.guard.isOptional(schema)) {
      // 30% chance of being undefined
      if (
        this.faker.datatype.boolean({
          probability: this.options.optionalProbability,
        })
      ) {
        return undefined;
      }
      // Generate the inner schema
      return this.generateValue((schema as any).schema);
    }

    // Handle union (nullable or other unions)
    if (this.guard.isUnion(schema)) {
      const union = schema as TUnion;
      // Check if it's a nullable union (union with null)
      const hasNull = union.anyOf.some((s) => this.guard.isNull(s));
      if (hasNull) {
        // 20% chance of being null
        if (
          this.faker.datatype.boolean({
            probability: this.options.nullableProbability,
          })
        ) {
          return null;
        }
        // Pick a non-null option
        const nonNullOptions = union.anyOf.filter((s) => !this.guard.isNull(s));
        const randomSchema =
          nonNullOptions[
            this.faker.number.int({ min: 0, max: nonNullOptions.length - 1 })
          ];
        return this.generateValue(randomSchema);
      }
      // Pick a random union member
      const randomSchema =
        union.anyOf[
          this.faker.number.int({ min: 0, max: union.anyOf.length - 1 })
        ];
      return this.generateValue(randomSchema);
    }

    // Handle null
    if (this.guard.isNull(schema)) {
      return null;
    }

    // Handle undefined
    if (this.guard.isUndefined(schema)) {
      return undefined;
    }

    // Handle void
    if (this.guard.isVoid(schema)) {
      return undefined;
    }

    // Handle literal
    if (this.guard.isLiteral(schema)) {
      return (schema as any).const;
    }

    // Handle unsafe (but check the inner type first)
    if (this.guard.isUnsafe(schema)) {
      // For TUnsafe, the properties are directly on the schema itself
      // Check if it has enum values (from t.enum())
      const unsafeAny = schema as any;
      if (unsafeAny.enum && Array.isArray(unsafeAny.enum)) {
        return unsafeAny.enum[
          this.faker.number.int({ min: 0, max: unsafeAny.enum.length - 1 })
        ];
      }
      // Check if it's a string type
      if (unsafeAny.type === "string") {
        return this.generateString(unsafeAny as any);
      }
    }

    // Handle string
    if (this.guard.isString(schema)) {
      return this.generateString(schema as TString);
    }

    // Handle number
    if (this.guard.isNumber(schema)) {
      return this.generateNumber(schema as TNumber);
    }

    // Handle integer
    if (this.guard.isInteger(schema)) {
      return this.generateInteger(schema as TInteger);
    }

    // Handle bigint
    if (this.guard.isBigInt(schema)) {
      return this.generateBigInt(schema as TString);
    }

    // Handle boolean
    if (this.guard.isBoolean(schema)) {
      return this.generateBoolean(schema as TBoolean);
    }

    // Handle array
    if (this.guard.isArray(schema)) {
      return this.generateArray(schema as TArray);
    }

    // Handle object
    if (this.guard.isObject(schema)) {
      return this.generateObject(schema as TObject);
    }

    // Handle record
    if (this.guard.isRecord(schema)) {
      return this.generateRecord(schema as TRecord);
    }

    // Handle tuple
    if (this.guard.isTuple(schema)) {
      const tuple = schema as any;
      return tuple.items.map((item: TSchema) => this.generateValue(item));
    }

    // Handle any
    if (this.guard.isAny(schema)) {
      // Generate a random simple value for any
      const types = ["string", "number", "boolean"];
      const randomType =
        types[this.faker.number.int({ min: 0, max: types.length - 1 })];
      switch (randomType) {
        case "string":
          return this.faker.lorem.word();
        case "number":
          return this.faker.number.float();
        case "boolean":
          return this.faker.datatype.boolean();
      }
    }

    // Handle unsafe
    if (this.guard.isUnsafe(schema)) {
      // Try to generate based on the inner schema
      const unsafeSchema = schema as any;
      if (unsafeSchema.schema) {
        return this.generateValue(unsafeSchema.schema);
      }
      // Fallback to string
      return this.faker.lorem.word();
    }

    // Fallback
    return this.faker.lorem.word();
  }

  protected generateString(schema: TString): string {
    const schemaAny = schema as any;
    const format = schemaAny.format;
    const pattern = schemaAny.pattern;
    const enumValues = schemaAny.enum;
    const minLength = schemaAny.minLength;
    const maxLength = schemaAny.maxLength;

    // Handle enum
    if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
      return enumValues[
        this.faker.number.int({ min: 0, max: enumValues.length - 1 })
      ] as string;
    }

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

  protected generateNumber(schema: TNumber): number {
    const schemaAny = schema as any;
    const min = schemaAny.minimum ?? -1000000;
    const max = schemaAny.maximum ?? 1000000;
    const multipleOf = schemaAny.multipleOf;

    let value = this.faker.number.float({ min, max });

    if (multipleOf !== undefined) {
      value = Math.round(value / multipleOf) * multipleOf;
    }

    return value;
  }

  protected generateInteger(schema: TInteger): number {
    const schemaAny = schema as any;
    const min = schemaAny.minimum ?? -2147483647;
    const max = schemaAny.maximum ?? 2147483647;

    return this.faker.number.int({ min, max });
  }

  protected generateBigInt(schema: TString): string {
    return this.faker.number
      .bigInt({ min: -9007199254740991n, max: 9007199254740991n })
      .toString();
  }

  protected generateBoolean(_schema: TBoolean): boolean {
    return this.faker.datatype.boolean();
  }

  protected generateArray(schema: TArray): unknown[] {
    const schemaAny = schema as any;
    const minItems = schemaAny.minItems ?? 0;
    const maxItems = Math.min(
      schemaAny.maxItems ?? this.options.defaultArrayLength,
      this.options.maxArrayLength,
    );
    const length = this.faker.number.int({ min: minItems, max: maxItems });

    return Array.from({ length }, () => this.generateValue(schema.items));
  }

  protected generateObject(schema: TObject): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      result[key] = this.generateValueWithContext(propSchema, key);
    }

    return result;
  }

  /**
   * Generate a value with context from the property key name.
   * This helps generate more realistic fake data based on field names.
   */
  protected generateValueWithContext(
    schema: TSchema,
    keyName?: string,
  ): unknown {
    // If no key name context, use regular generation
    if (!keyName) {
      return this.generateValue(schema);
    }

    // Normalize key name: lowercase and remove underscores/hyphens
    // This allows matching "user_name", "user-name", "userName" etc.
    const normalizedKey = keyName.toLowerCase().replace(/[_-]/g, "");

    // Check if this is a string type that could benefit from context
    if (this.guard.isString(schema)) {
      const stringSchema = schema as TString;

      // Skip if it has a specific format already
      if (stringSchema.format && stringSchema.format !== "string") {
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

  protected generateRecord(schema: TRecord): Record<string, unknown> {
    const record = schema as any;
    const keySchema = record.patternProperties
      ? Object.keys(record.patternProperties)[0]
      : ".*";
    const valueSchema = record.patternProperties
      ? record.patternProperties[keySchema]
      : record.additionalProperties;

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
