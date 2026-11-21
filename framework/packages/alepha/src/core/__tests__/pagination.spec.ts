import { describe, it } from "vitest";

import {
  createPagination,
  pageMetadataSchema,
  pageSchema,
  z,
} from "../index.ts";

describe("Pagination (Core)", () => {
  it("should create pagination from any array", ({ expect }) => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
    }));

    // Simulate fetching limit + 1 items
    const fetchedItems = items.slice(0, 11); // First page with 10 items + 1 for hasNext

    const page = createPagination(fetchedItems, 10, 0);

    expect(page.content.length).toBe(10);
    expect(page.page.number).toBe(0);
    expect(page.page.size).toBe(10);
    expect(page.page.offset).toBe(0);
    expect(page.page.numberOfElements).toBe(10);
    expect(page.page.isEmpty).toBe(false);
    expect(page.page.isFirst).toBe(true);
    expect(page.page.isLast).toBe(false);
  });

  it("should handle empty results", ({ expect }) => {
    const page = createPagination([], 10, 0);

    expect(page.content.length).toBe(0);
    expect(page.page.isEmpty).toBe(true);
    expect(page.page.isFirst).toBe(true);
    expect(page.page.isLast).toBe(true);
    expect(page.page.numberOfElements).toBe(0);
  });

  it("should handle last page correctly", ({ expect }) => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }]; // Last 3 items

    const page = createPagination(items, 10, 20);

    expect(page.content.length).toBe(3);
    expect(page.page.number).toBe(2);
    expect(page.page.offset).toBe(20);
    expect(page.page.numberOfElements).toBe(3);
    expect(page.page.isFirst).toBe(false);
    expect(page.page.isLast).toBe(true);
  });

  it("should include sort metadata", ({ expect }) => {
    const items = [{ id: 1 }, { id: 2 }];

    const page = createPagination(items, 10, 0, [
      { column: "name", direction: "asc" },
      { column: "createdAt", direction: "desc" },
    ]);

    expect(page.page.sort).toBeDefined();
    expect(page.page.sort?.sorted).toBe(true);
    expect(page.page.sort?.fields).toEqual([
      { field: "name", direction: "asc" },
      { field: "createdAt", direction: "desc" },
    ]);
  });

  it("should create page schema", ({ expect }) => {
    const itemSchema = z.object({
      id: z.integer(),
      name: z.text(),
    });

    const schema = pageSchema(itemSchema);

    expect(z.schema.shape(schema).content).toBeDefined();
    expect(z.schema.shape(schema).page).toBeDefined();
  });

  it("should keep the sort metadata through z.page(), as pageSchema() does", ({
    expect,
  }) => {
    const itemSchema = z.object({ id: z.integer() });
    const page = createPagination([{ id: 1 }], 10, 0, [
      { column: "id", direction: "asc" },
    ]);
    const sort = { sorted: true, fields: [{ field: "id", direction: "asc" }] };

    expect(pageSchema(itemSchema).parse(page).page.sort).toEqual(sort);
    expect(z.page(itemSchema).parse(page).page.sort).toEqual(sort);
  });

  it("should publish one page metadata schema from z.page() and pageSchema()", ({
    expect,
  }) => {
    const itemSchema = z.object({ id: z.integer() });

    expect(z.schema.shape(z.page(itemSchema)).page).toBe(pageMetadataSchema);
    expect(z.schema.shape(pageSchema(itemSchema)).page).toBe(
      pageMetadataSchema,
    );
    expect(z.toJSONSchema(z.page(itemSchema))).toEqual(
      z.toJSONSchema(pageSchema(itemSchema)),
    );
  });
});
