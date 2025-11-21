import { buildQueryString, parseQueryString } from "alepha/orm";
import { describe, test } from "vitest";

describe("parseQueryString with wildcard patterns", () => {
  test("should parse wildcard patterns with = operator", ({ expect }) => {
    // Test startsWith pattern
    const result1 = parseQueryString("name=John*");
    expect(result1).toEqual({ name: { startsWith: "John" } });

    // Test endsWith pattern
    const result2 = parseQueryString("name=*Smith");
    expect(result2).toEqual({ name: { endsWith: "Smith" } });

    // Test contains pattern
    const result3 = parseQueryString("name=*oh*");
    expect(result3).toEqual({ name: { contains: "oh" } });

    // Test literal asterisk in the middle (not at beginning or end)
    const result4 = parseQueryString("name=Jo*hn");
    expect(result4).toEqual({ name: { eq: "Jo*hn" } });

    // Test literal equals (no wildcards)
    const result5 = parseQueryString("name=John");
    expect(result5).toEqual({ name: { eq: "John" } });
  });

  test("should handle wildcard patterns in complex queries", ({ expect }) => {
    // Multiple conditions with wildcards
    const result1 = parseQueryString("name=*John&email=*@example.com");
    expect(result1).toEqual({
      and: [
        { name: { endsWith: "John" } },
        { email: { endsWith: "@example.com" } },
      ],
    });

    // OR conditions with wildcards
    const result2 = parseQueryString("name=John*|name=*Smith");
    expect(result2).toEqual({
      or: [{ name: { startsWith: "John" } }, { name: { endsWith: "Smith" } }],
    });

    // Nested conditions with wildcards
    const result3 = parseQueryString("(name=*John*|email=admin*)&age>18");
    expect(result3).toEqual({
      and: [
        {
          or: [
            { name: { contains: "John" } },
            { email: { startsWith: "admin" } },
          ],
        },
        { age: { gt: 18 } },
      ],
    });
  });

  test("should handle wildcard patterns in quoted strings", ({ expect }) => {
    // Quoted string with wildcards should be treated as wildcards
    const result1 = parseQueryString('name="*John*"');
    expect(result1).toEqual({ name: { contains: "John" } });

    // Quoted string with asterisk in middle
    const result2 = parseQueryString('name="Jo*hn"');
    expect(result2).toEqual({ name: { eq: "Jo*hn" } });

    // Single quotes
    const result3 = parseQueryString("name='*Smith'");
    expect(result3).toEqual({ name: { endsWith: "Smith" } });
  });

  test("should handle wildcard patterns with special characters", ({
    expect,
  }) => {
    // Wildcard with spaces
    const result1 = parseQueryString("name=*John Smith*");
    expect(result1).toEqual({ name: { contains: "John Smith" } });

    // Wildcard with special characters
    const result2 = parseQueryString("email=*@example.com");
    expect(result2).toEqual({ email: { endsWith: "@example.com" } });

    // Wildcard with numbers
    const result3 = parseQueryString("code=ABC*123");
    expect(result3).toEqual({ code: { eq: "ABC*123" } }); // Asterisk in middle is literal
  });

  test("should handle wildcard patterns in arrays", ({ expect }) => {
    // Array values don't support wildcards (treated as literal)
    const result = parseQueryString("status=[active*,*pending,*idle*]");
    expect(result).toEqual({
      status: { inArray: ["active*", "*pending", "*idle*"] },
    });
  });

  test("should handle wildcard patterns with != operator", ({ expect }) => {
    // != operator doesn't support wildcards, treats as literal
    const result1 = parseQueryString("name!=*John");
    expect(result1).toEqual({ name: { ne: "*John" } });

    const result2 = parseQueryString("name!=John*");
    expect(result2).toEqual({ name: { ne: "John*" } });
  });

  test("should handle empty wildcard patterns", ({ expect }) => {
    // Just asterisks - a single asterisk at the end means "starts with nothing" = everything
    const result1 = parseQueryString("name=*");
    expect(result1).toEqual({ name: { contains: "" } }); // Since * alone has both start and end asterisk

    const result2 = parseQueryString("name=**");
    expect(result2).toEqual({ name: { contains: "" } });

    const result3 = parseQueryString("name=***");
    expect(result3).toEqual({ name: { contains: "*" } });
  });

  test("should handle JSONB nested queries with wildcards", ({ expect }) => {
    const result = parseQueryString("profile.city=*Paris*&profile.name=John*");
    expect(result).toEqual({
      and: [
        { profile: { city: { contains: "Paris" } } },
        { profile: { name: { startsWith: "John" } } },
      ],
    });
  });

  test("should not apply wildcards to non-string operators", ({ expect }) => {
    // Numeric comparison operators don't use wildcards
    const result1 = parseQueryString("age>18");
    expect(result1).toEqual({ age: { gt: 18 } });

    // NULL checks don't use wildcards
    const result2 = parseQueryString("name=null");
    expect(result2).toEqual({ name: { isNull: true } });

    const result3 = parseQueryString("name!=null");
    expect(result3).toEqual({ name: { isNotNull: true } });
  });
});

describe("buildQueryString with wildcard patterns", () => {
  test("should build query strings from wildcard conditions", ({ expect }) => {
    // startsWith
    const query1 = buildQueryString({ name: { startsWith: "John" } });
    expect(query1).toBe("name=John*");

    // endsWith
    const query2 = buildQueryString({ name: { endsWith: "Smith" } });
    expect(query2).toBe("name=*Smith");

    // contains
    const query3 = buildQueryString({ name: { contains: "oh" } });
    expect(query3).toBe("name=*oh*");
  });

  test("should build complex query strings with wildcards", ({ expect }) => {
    const query = buildQueryString({
      and: [
        { name: { startsWith: "John" } },
        { email: { endsWith: "@example.com" } },
        { bio: { contains: "developer" } },
      ],
    });
    expect(query).toBe("name=John*&email=*@example.com&bio=*developer*");
  });

  test("should handle OR conditions with wildcards", ({ expect }) => {
    const query = buildQueryString({
      or: [
        { name: { startsWith: "Admin" } },
        { role: { contains: "manager" } },
      ],
    });
    expect(query).toBe("(name=Admin*|role=*manager*)");
  });

  test("round-trip conversion should preserve wildcard semantics", ({
    expect,
  }) => {
    const testCases = [
      "name=John*",
      "name=*Smith",
      "name=*John*",
      "email=admin*&role=*manager*",
      "(name=*John*|name=*Jane*)&active=true",
      "profile.city=*Paris*",
    ];

    for (const original of testCases) {
      const parsed = parseQueryString(original);
      const rebuilt = buildQueryString(parsed);
      const reparsed = parseQueryString(rebuilt);
      expect(reparsed).toEqual(parsed);
    }
  });
});
