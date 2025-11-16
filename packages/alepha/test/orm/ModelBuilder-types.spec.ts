import { t } from "alepha/core";
import { describe, expect, it } from "vitest";
import { $entity } from "../../src/orm/descriptors/$entity.ts";
import { pg } from "../../src/orm/providers/PostgresTypeProvider.ts";

describe("ModelBuilder Type Safety", () => {
  it("should enforce type-safe foreign key references", () => {
    const roleEntity = $entity({
      name: "roles",
      schema: t.object({
        id: pg.primaryKey(),
        name: t.string(),
      }),
    });

    const userEntity = $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(),
        email: t.email(),
        roleId: t.integer(),
      }),
      foreignKeys: [
        {
          columns: ["roleId"],
          // This should reference an EntityColumn from roleEntity
          foreignColumns: [() => roleEntity.cols.id],
        },
      ],
    });

    // Test that we can access the column references
    expect(roleEntity.cols.id).toBeDefined();
    expect(roleEntity.cols.id.name).toBe("id");
    expect(roleEntity.cols.id.entity).toBe(roleEntity);

    expect(userEntity.cols.email).toBeDefined();
    expect(userEntity.cols.email.name).toBe("email");

    // Test that foreign key references work
    const fkDef = userEntity.options.foreignKeys![0];
    expect(fkDef.columns).toEqual(["roleId"]);

    // Execute the foreign column reference function
    const foreignCol = fkDef.foreignColumns[0]();
    expect(foreignCol).toBeDefined();
    expect(foreignCol.name).toBe("id");
    expect(foreignCol.entity.name).toBe("roles");
  });

  it("should support multiple foreign key references", () => {
    const categoryEntity = $entity({
      name: "categories",
      schema: t.object({
        id: pg.primaryKey(),
        name: t.string(),
      }),
    });

    const userEntity = $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(),
        username: t.string(),
      }),
    });

    const postEntity = $entity({
      name: "posts",
      schema: t.object({
        id: pg.primaryKey(),
        title: t.string(),
        userId: t.integer(),
        categoryId: t.integer(),
      }),
      foreignKeys: [
        {
          columns: ["userId"],
          foreignColumns: [() => userEntity.cols.id],
        },
        {
          columns: ["categoryId"],
          foreignColumns: [() => categoryEntity.cols.id],
        },
      ],
    });

    const fks = postEntity.options.foreignKeys!;
    expect(fks).toHaveLength(2);

    // Check first foreign key (userId -> users.id)
    const userFk = fks[0];
    const userForeignCol = userFk.foreignColumns[0]();
    expect(userForeignCol.entity.name).toBe("users");
    expect(userForeignCol.name).toBe("id");

    // Check second foreign key (categoryId -> categories.id)
    const categoryFk = fks[1];
    const categoryForeignCol = categoryFk.foreignColumns[0]();
    expect(categoryForeignCol.entity.name).toBe("categories");
    expect(categoryForeignCol.name).toBe("id");
  });

  it("should support composite foreign keys", () => {
    const tenantEntity = $entity({
      name: "tenants",
      schema: t.object({
        id: pg.primaryKey(),
        code: t.string(),
        name: t.string(),
      }),
    });

    const userEntity = $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(),
        tenantId: t.integer(),
        tenantCode: t.string(),
        username: t.string(),
      }),
      foreignKeys: [
        {
          columns: ["tenantId", "tenantCode"],
          foreignColumns: [
            () => tenantEntity.cols.id,
            () => tenantEntity.cols.code,
          ],
        },
      ],
    });

    const fk = userEntity.options.foreignKeys![0];
    expect(fk.columns).toEqual(["tenantId", "tenantCode"]);
    expect(fk.foreignColumns).toHaveLength(2);

    const foreignCol1 = fk.foreignColumns[0]();
    const foreignCol2 = fk.foreignColumns[1]();

    expect(foreignCol1.name).toBe("id");
    expect(foreignCol2.name).toBe("code");
    expect(foreignCol1.entity.name).toBe("tenants");
    expect(foreignCol2.entity.name).toBe("tenants");
  });

  it("should maintain referential integrity through EntityColumn", () => {
    const entity1 = $entity({
      name: "entity1",
      schema: t.object({
        id: pg.primaryKey(),
        value: t.string(),
      }),
    });

    const entity2 = $entity({
      name: "entity2",
      schema: t.object({
        id: pg.primaryKey(),
        entity1Id: t.integer(),
        entity1Value: t.string(),
      }),
      foreignKeys: [
        {
          name: "entity2_entity1_fk",
          columns: ["entity1Id", "entity1Value"],
          foreignColumns: [() => entity1.cols.id, () => entity1.cols.value],
        },
      ],
    });

    // Verify that the foreign key correctly references entity1's columns
    const fk = entity2.options.foreignKeys![0];
    expect(fk.name).toBe("entity2_entity1_fk");

    const idRef = fk.foreignColumns[0]();
    const valueRef = fk.foreignColumns[1]();

    // Both columns should reference the same entity
    expect(idRef.entity).toBe(valueRef.entity);
    expect(idRef.entity.name).toBe("entity1");

    // But different columns
    expect(idRef.name).toBe("id");
    expect(valueRef.name).toBe("value");
  });
});
