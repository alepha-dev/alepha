import * as Value from "typebox/value";
import { describe, test } from "vitest";
import { jsonSchemaToTypeBox } from "../helpers/jsonSchemaToTypeBox.ts";
import { t } from "../providers/TypeProvider.ts";

describe("jsonSchemaToTypeBox", () => {
  describe("reserved/special property names", () => {
    test("should handle properties with JSON Schema reserved names", ({
      expect,
    }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          type: { type: "string" },
          properties: { type: "string" },
          required: { type: "boolean" },
          items: { type: "string" },
          enum: { type: "string" },
          format: { type: "string" },
          default: { type: "string" },
        },
        required: ["type", "properties"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      expect(result.properties.type).toBeDefined();
      expect(result.properties.type.type).toBe("string");
      expect(result.properties.properties).toBeDefined();
      expect(result.properties.required).toBeDefined();
      expect(result.properties.items).toBeDefined();
      expect(result.properties.enum).toBeDefined();
      expect(result.properties.format).toBeDefined();
      expect(result.properties.default).toBeDefined();

      const validData = {
        type: "user",
        properties: "some value",
        required: true,
        items: "item",
        enum: "value",
        format: "custom",
        default: "def",
      };
      expect(Value.Check(result, validData)).toBe(true);

      // Missing required field
      const invalidData = { type: "user" };
      expect(Value.Check(result, invalidData)).toBe(false);
    });

    test("should handle 'description' property alongside other fields", ({
      expect,
    }) => {
      const jsonSchema = {
        type: "object",
        title: "Form Schema",
        description: "This is the schema-level description",
        properties: {
          id: { type: "integer" },
          name: { type: "string", minLength: 1 },
          description: {
            type: "string",
            description: "User-provided description",
          },
          email: { type: "string", format: "email" },
          active: { type: "boolean" },
        },
        required: ["id", "name", "description"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      // Schema-level metadata preserved
      expect(result.title).toBe("Form Schema");
      expect(result.description).toBe("This is the schema-level description");

      // All properties converted correctly
      expect(result.properties.id.type).toBe("integer");
      expect(result.properties.name.type).toBe("string");
      expect(result.properties.description.type).toBe("string");
      expect(result.properties.description.description).toBe(
        "User-provided description",
      );
      expect(result.properties.email.format).toBe("email");
      expect(result.properties.active.type).toBe("boolean");

      const validData = {
        id: 1,
        name: "Test",
        description: "My description",
        email: "test@example.com",
        active: true,
      };
      expect(Value.Check(result, validData)).toBe(true);

      // Wrong type for description
      const invalidData = {
        id: 1,
        name: "Test",
        description: 123,
      };
      expect(Value.Check(result, invalidData)).toBe(false);
    });

    test("should handle 'disabled' property in a form-like schema", ({
      expect,
    }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          label: { type: "string" },
          value: { type: "string" },
          disabled: { type: "boolean", default: false },
          readonly: { type: "boolean" },
          hidden: { type: "boolean" },
          required: { type: "boolean" },
        },
        required: ["id", "label", "disabled"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      expect(result.properties.id.format).toBe("uuid");
      expect(result.properties.label.type).toBe("string");
      expect(result.properties.value.type).toBe("string");
      expect(result.properties.disabled.type).toBe("boolean");
      expect(result.properties.disabled.default).toBe(false);
      expect(result.properties.readonly.type).toBe("boolean");
      expect(result.properties.hidden.type).toBe("boolean");
      expect(result.properties.required.type).toBe("boolean");

      const validData = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        label: "Username",
        disabled: false,
      };
      expect(Value.Check(result, validData)).toBe(true);

      // disabled should be boolean, not string
      const invalidData = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        label: "Username",
        disabled: "false",
      };
      expect(Value.Check(result, invalidData)).toBe(false);
    });

    test("should handle both 'description' and 'disabled' with nested objects", ({
      expect,
    }) => {
      const jsonSchema = {
        type: "object",
        description: "Root schema description",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          disabled: { type: "boolean" },
          settings: {
            type: "object",
            description: "Nested settings description",
            properties: {
              description: { type: "string" },
              disabled: { type: "boolean" },
              theme: { type: "string" },
            },
            required: ["theme"],
          },
        },
        required: ["name", "description", "disabled"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      // Root level
      expect(result.description).toBe("Root schema description");
      expect(result.properties.description.type).toBe("string");
      expect(result.properties.disabled.type).toBe("boolean");

      // Nested level
      const settingsSchema = result.properties.settings;
      expect(settingsSchema.description).toBe("Nested settings description");
      expect(settingsSchema.properties.description.type).toBe("string");
      expect(settingsSchema.properties.disabled.type).toBe("boolean");
      expect(settingsSchema.properties.theme.type).toBe("string");

      const validData = {
        name: "Config",
        description: "Main config",
        disabled: false,
        settings: {
          description: "Settings desc",
          disabled: true,
          theme: "dark",
        },
      };
      expect(Value.Check(result, validData)).toBe(true);
    });
  });

  describe("basic type conversion", () => {
    test("should convert all basic types", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          stringField: { type: "string" },
          numberField: { type: "number" },
          integerField: { type: "integer" },
          booleanField: { type: "boolean" },
          nullField: { type: "null" },
        },
        required: [
          "stringField",
          "numberField",
          "integerField",
          "booleanField",
          "nullField",
        ],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      expect(result.properties.stringField.type).toBe("string");
      expect(result.properties.numberField.type).toBe("number");
      expect(result.properties.integerField.type).toBe("integer");
      expect(result.properties.booleanField.type).toBe("boolean");
      expect(result.properties.nullField.type).toBe("null");

      const validData = {
        stringField: "test",
        numberField: 3.14,
        integerField: 42,
        booleanField: true,
        nullField: null,
      };
      expect(Value.Check(result, validData)).toBe(true);
    });

    test("should handle string formats", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          uuid: { type: "string", format: "uuid" },
          datetime: { type: "string", format: "date-time" },
          date: { type: "string", format: "date" },
          time: { type: "string", format: "time" },
          url: { type: "string", format: "url" },
          uri: { type: "string", format: "uri" },
        },
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      expect(result.properties.email.format).toBe("email");
      expect(result.properties.uuid.format).toBe("uuid");
      expect(result.properties.datetime.format).toBe("date-time");
      expect(result.properties.date.format).toBe("date");
      expect(result.properties.time.format).toBe("time");
      expect(result.properties.url.format).toBe("url");
      expect(result.properties.uri.format).toBe("url");
    });

    test("should handle validation constraints", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          username: {
            type: "string",
            minLength: 3,
            maxLength: 20,
            pattern: "^[a-z]+$",
          },
          age: { type: "integer", minimum: 0, maximum: 120 },
          score: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100 },
          tags: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 5,
          },
        },
        required: ["username", "age"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      expect(result.properties.username.minLength).toBe(3);
      expect(result.properties.username.maxLength).toBe(20);
      expect(result.properties.username.pattern).toBe("^[a-z]+$");
      expect(result.properties.age.minimum).toBe(0);
      expect(result.properties.age.maximum).toBe(120);
      expect(result.properties.score.exclusiveMinimum).toBe(0);
      expect(result.properties.score.exclusiveMaximum).toBe(100);
      expect(result.properties.tags.minItems).toBe(1);
      expect(result.properties.tags.maxItems).toBe(5);

      const validData = {
        username: "john",
        age: 25,
        score: 50,
        tags: ["a", "b"],
      };
      expect(Value.Check(result, validData)).toBe(true);

      // username too short
      const invalidUsername = { username: "ab", age: 25 };
      expect(Value.Check(result, invalidUsername)).toBe(false);

      // age negative
      const invalidAge = { username: "john", age: -1 };
      expect(Value.Check(result, invalidAge)).toBe(false);
    });
  });

  describe("enums and const", () => {
    test("should handle string enums", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "active", "inactive"] },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          name: { type: "string" },
        },
        required: ["status", "name"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      const validData = { status: "active", name: "Test" };
      expect(Value.Check(result, validData)).toBe(true);

      const invalidData = { status: "unknown", name: "Test" };
      expect(Value.Check(result, invalidData)).toBe(false);
    });

    test("should handle const values", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          version: { const: "1.0.0" },
          type: { const: "config" },
          count: { const: 42 },
          enabled: { const: true },
        },
        required: ["version", "type"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      const validData = {
        version: "1.0.0",
        type: "config",
        count: 42,
        enabled: true,
      };
      expect(Value.Check(result, validData)).toBe(true);

      const invalidData = { version: "2.0.0", type: "config" };
      expect(Value.Check(result, invalidData)).toBe(false);
    });
  });

  describe("anyOf/oneOf nullable patterns", () => {
    test("should handle anyOf with nullable string", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
          description: {
            anyOf: [
              {
                type: "string",
                maxLength: 255,
                "~options": { trim: true, lowercase: false },
              },
              { type: "null" },
            ],
          },
        },
        required: ["name"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      // description should be a union of [null, string]
      expect(result.properties.description).toBeDefined();
      expect(result.properties.description.anyOf).toBeDefined();

      // Valid with string
      const validWithString = { name: "Test", description: "A description" };
      expect(Value.Check(result, validWithString)).toBe(true);

      // Valid with null
      const validWithNull = { name: "Test", description: null };
      expect(Value.Check(result, validWithNull)).toBe(true);

      // Valid without description (optional)
      const validWithout = { name: "Test" };
      expect(Value.Check(result, validWithout)).toBe(true);

      // Invalid with number
      const invalidData = { name: "Test", description: 123 };
      expect(Value.Check(result, invalidData)).toBe(false);
    });

    test("should handle anyOf with nullable boolean", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          disabled: {
            anyOf: [
              { type: "boolean", description: "If true, access is disabled." },
              { type: "null" },
            ],
          },
        },
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      // Valid with boolean
      expect(Value.Check(result, { disabled: true })).toBe(true);
      expect(Value.Check(result, { disabled: false })).toBe(true);

      // Valid with null
      expect(Value.Check(result, { disabled: null })).toBe(true);

      // Invalid with string
      expect(Value.Check(result, { disabled: "yes" })).toBe(false);
    });

    test("should handle complex schema with multiple anyOf nullable fields", ({
      expect,
    }) => {
      const jsonString = `{"type":"object","required":["contracts"],"properties":{"name":{"type":"string","maxLength":64,"~options":{"trim":true,"lowercase":false},"description":"The name of the third party."},"description":{"anyOf":[{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"Short description about the third party."},{"type":"null"}]},"email":{"anyOf":[{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"format":"email","description":"Email address used for communication."},{"type":"null"}]},"company":{"anyOf":[{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"Company legal name."},{"type":"null"}]},"disabled":{"anyOf":[{"type":"boolean","description":"If true, all API access will be disabled."},{"type":"null"}]},"contracts":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string","maxLength":64,"~options":{"trim":true,"lowercase":false}},"startDate":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"The start date of the contract validity.","format":"date"},"endDate":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"The end date of the contract validity.","format":"date"},"roles":{"type":"array","items":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false}},"maxItems":1000,"description":"Roles assigned to this contract."},"disabled":{"type":"boolean","description":"Manually disable this contract."},"clientId":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"The client ID for this contract."},"clientSecret":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"Will be generated if contract is valid."}},"additionalProperties":false},"maxItems":1000}},"additionalProperties":false}`;

      const jsonSchema = JSON.parse(jsonString);
      const result = jsonSchemaToTypeBox(jsonSchema);

      // Check that nullable fields are converted correctly
      expect(result.properties.name.type).toBe("string");
      expect(result.properties.description.anyOf).toBeDefined();
      expect(result.properties.email.anyOf).toBeDefined();
      expect(result.properties.company.anyOf).toBeDefined();
      expect(result.properties.disabled.anyOf).toBeDefined();
      expect(result.properties.contracts.type).toBe("array");

      // Valid data with all nulls
      const validWithNulls = {
        contracts: [],
        description: null,
        email: null,
        company: null,
        disabled: null,
      };
      expect(Value.Check(result, validWithNulls)).toBe(true);

      // Valid data with actual values
      const validWithValues = {
        name: "Acme Corp",
        description: "A company",
        email: "contact@acme.com",
        company: "Acme Inc.",
        disabled: false,
        contracts: [
          {
            label: "Main",
            disabled: false,
          },
        ],
      };
      expect(Value.Check(result, validWithValues)).toBe(true);

      // Invalid: wrong type for nullable field
      const invalidData = {
        contracts: [],
        description: 123, // should be string or null
      };
      expect(Value.Check(result, invalidData)).toBe(false);
    });

    test("should handle oneOf with nullable type", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          value: {
            oneOf: [{ type: "string" }, { type: "null" }],
          },
        },
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      expect(Value.Check(result, { value: "test" })).toBe(true);
      expect(Value.Check(result, { value: null })).toBe(true);
      expect(Value.Check(result, { value: 123 })).toBe(false);
    });
  });

  describe("arrays", () => {
    test("should handle arrays with complex items", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          users: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                description: { type: "string" },
                disabled: { type: "boolean" },
              },
              required: ["id", "name"],
            },
          },
        },
        required: ["users"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      const validData = {
        users: [
          { id: 1, name: "Alice", description: "Admin", disabled: false },
          { id: 2, name: "Bob" },
        ],
      };
      expect(Value.Check(result, validData)).toBe(true);

      // Missing required field in array item
      const invalidData = {
        users: [{ id: 1 }],
      };
      expect(Value.Check(result, invalidData)).toBe(false);
    });
  });

  describe("optional properties", () => {
    test("should make non-required properties optional", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          description: { type: "string" },
          disabled: { type: "boolean" },
          metadata: { type: "object" },
        },
        required: ["id"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      // Only id is required
      const minimalValidData = { id: 1 };
      expect(Value.Check(result, minimalValidData)).toBe(true);

      // All fields provided
      const fullValidData = {
        id: 1,
        name: "Test",
        description: "A description",
        disabled: true,
        metadata: { key: "value" },
      };
      expect(Value.Check(result, fullValidData)).toBe(true);

      // Missing required id
      const invalidData = { name: "Test" };
      expect(Value.Check(result, invalidData)).toBe(false);
    });
  });

  describe("~options handling", () => {
    test("should preserve ~options with trim and lowercase", ({ expect }) => {
      const jsonSchema = {
        type: "object",
        properties: {
          name: {
            type: "string",
            maxLength: 64,
            "~options": { trim: true, lowercase: false },
          },
          email: {
            type: "string",
            format: "email",
            "~options": { trim: true, lowercase: true },
          },
          description: {
            type: "string",
            maxLength: 255,
            "~options": { trim: true, lowercase: false },
          },
        },
        required: ["name"],
      };

      const result = jsonSchemaToTypeBox(jsonSchema);

      // Should preserve ~options
      expect(result.properties.name["~options"]).toEqual({
        trim: true,
        lowercase: false,
      });
      expect(result.properties.email["~options"]).toEqual({
        trim: true,
        lowercase: true,
      });
      expect(result.properties.description["~options"]).toEqual({
        trim: true,
        lowercase: false,
      });
    });

    test("should use t.text() behavior when ~options present", ({ expect }) => {
      // Create a schema using t.text() directly for comparison
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const directTextSchema = t.text({ maxLength: 64 }) as any;

      // This should have ~options
      expect(directTextSchema["~options"]).toBeDefined();
      expect(directTextSchema["~options"].trim).toBe(true);

      // Now convert from JSON schema with ~options
      const jsonSchema = {
        type: "string",
        maxLength: 64,
        "~options": { trim: true, lowercase: false },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = jsonSchemaToTypeBox(jsonSchema) as any;

      // Should preserve the ~options
      expect(result["~options"]).toEqual({ trim: true, lowercase: false });
    });
  });

  describe("real-world schemas", () => {
    test("should handle third party schema with description and disabled properties", ({
      expect,
    }) => {
      const jsonSchema =
        '{"type":"object","required":["name","contracts"],"properties":{"name":{"type":"string","maxLength":64,"~options":{"trim":true,"lowercase":false},"description":"The name of the third party."},"description":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"Short description about the third party."},"retailerId":{"type":"integer","title":"Retailer","description":"Optional retailer associated with this third party."},"email":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"format":"email","description":"Email address used for communication."},"company":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"Company legal name."},"disabled":{"type":"boolean","description":"If true, all API access will be disabled."},"contracts":{"type":"array","items":{"type":"object","required":["label"],"properties":{"label":{"type":"string","maxLength":64,"~options":{"trim":true,"lowercase":false}},"startDate":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"The start date of the contract validity.","format":"date"},"endDate":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false},"description":"The end date of the contract validity.","format":"date"},"roles":{"type":"array","items":{"type":"string","maxLength":255,"~options":{"trim":true,"lowercase":false}},"maxItems":1000,"description":"Roles assigned to this contract."},"disabled":{"type":"boolean","description":"Manually disable this contract."}},"additionalProperties":false},"maxItems":1000,"description":"List of API credentials associated with the third party."}},"additionalProperties":false}';

      const result = jsonSchemaToTypeBox(JSON.parse(jsonSchema));

      // Check root properties
      expect(result.properties.name).toBeDefined();
      expect(result.properties.name.type).toBe("string");
      expect(result.properties.name.maxLength).toBe(64);
      expect(result.properties.name.description).toBe(
        "The name of the third party.",
      );
      expect(result.properties.name["~options"]).toEqual({
        trim: true,
        lowercase: false,
      });

      // Check 'description' property (not schema description)
      expect(result.properties.description).toBeDefined();
      expect(result.properties.description.type).toBe("string");
      expect(result.properties.description.description).toBe(
        "Short description about the third party.",
      );

      // Check 'disabled' property
      expect(result.properties.disabled).toBeDefined();
      expect(result.properties.disabled.type).toBe("boolean");
      expect(result.properties.disabled.description).toBe(
        "If true, all API access will be disabled.",
      );

      // Check nested contracts array
      expect(result.properties.contracts).toBeDefined();
      expect(result.properties.contracts.type).toBe("array");
      expect(result.properties.contracts.maxItems).toBe(1000);

      const contractItemSchema = result.properties.contracts.items;
      expect(contractItemSchema.properties.label).toBeDefined();
      expect(contractItemSchema.properties.label["~options"]).toEqual({
        trim: true,
        lowercase: false,
      });
      expect(contractItemSchema.properties.startDate.format).toBe("date");
      expect(contractItemSchema.properties.startDate["~options"]).toEqual({
        trim: true,
        lowercase: false,
      });
      expect(contractItemSchema.properties.endDate.format).toBe("date");
      expect(contractItemSchema.properties.disabled).toBeDefined();
      expect(contractItemSchema.properties.disabled.type).toBe("boolean");

      // Validate with actual data
      const validData = {
        name: "Acme Corp",
        contracts: [
          {
            label: "Main Contract",
            startDate: "2024-01-01",
            endDate: "2024-12-31",
            roles: ["admin", "viewer"],
            disabled: false,
          },
        ],
      };
      expect(Value.Check(result, validData)).toBe(true);

      // Validate with all optional fields
      const fullValidData = {
        name: "Acme Corp",
        description: "A third party vendor",
        retailerId: 123,
        email: "contact@acme.com",
        company: "Acme Corporation Inc.",
        disabled: false,
        contracts: [
          {
            label: "Contract A",
            disabled: true,
          },
          {
            label: "Contract B",
            startDate: "2024-06-01",
            roles: ["reader"],
          },
        ],
      };
      expect(Value.Check(result, fullValidData)).toBe(true);

      // Invalid: missing required 'name'
      const missingName = {
        contracts: [{ label: "Test" }],
      };
      expect(Value.Check(result, missingName)).toBe(false);

      // Invalid: missing required 'contracts'
      const missingContracts = {
        name: "Test",
      };
      expect(Value.Check(result, missingContracts)).toBe(false);

      // Invalid: wrong type for 'disabled'
      const wrongDisabledType = {
        name: "Test",
        disabled: "yes",
        contracts: [{ label: "Test" }],
      };
      expect(Value.Check(result, wrongDisabledType)).toBe(false);

      // Invalid: wrong type for 'description'
      const wrongDescriptionType = {
        name: "Test",
        description: 123,
        contracts: [{ label: "Test" }],
      };
      expect(Value.Check(result, wrongDescriptionType)).toBe(false);

      // Invalid: contract missing required 'label'
      const contractMissingLabel = {
        name: "Test",
        contracts: [{ disabled: false }],
      };
      expect(Value.Check(result, contractMissingLabel)).toBe(false);
    });
  });
});
