import { z } from "alepha";
import { describe, expect, test } from "vitest";

import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  PG_VERSION,
} from "../constants/PG_SYMBOLS.ts";
import { getAttr, hasAttr } from "../helpers/pgAttr.ts";
import { db } from "../index.ts";

/**
 * Count the zod schema nodes `build` constructs. zod calls
 * `__zod_globalConfig.postProcessor` after building every instance; a schema
 * has `_zod.def.type`, a check does not.
 */
const countNodes = (build: () => unknown): number => {
  const cfg = ((globalThis as any).__zod_globalConfig ??= {});
  const previous = cfg.postProcessor;
  let n = 0;
  cfg.postProcessor = (inst: any) => {
    if (inst?._zod?.def?.type) n++;
    previous?.(inst);
  };
  try {
    build();
  } finally {
    cfg.postProcessor = previous;
  }
  return n;
};

describe("db column helpers", () => {
  test("column helpers keep their attributes", () => {
    const pk = db.primaryKey();
    expect(hasAttr(pk, PG_PRIMARY_KEY)).toBe(true);
    expect(hasAttr(pk, PG_DEFAULT)).toBe(true);

    const identity = { mode: "always" as const };
    const intPk = db.primaryKey(z.integer(), undefined, identity);
    expect(hasAttr(intPk, PG_PRIMARY_KEY)).toBe(true);
    expect(hasAttr(intPk, PG_DEFAULT)).toBe(true);
    expect(getAttr(intPk, PG_IDENTITY)).toEqual(identity);

    const version = db.version();
    expect(hasAttr(version, PG_VERSION)).toBe(true);
    expect(hasAttr(version, PG_DEFAULT)).toBe(true);
    expect((version as any).default).toBe(0);

    const createdAt = db.createdAt();
    expect(hasAttr(createdAt, PG_CREATED_AT)).toBe(true);
    expect(hasAttr(createdAt, PG_DEFAULT)).toBe(true);
    const updatedAt = db.updatedAt();
    expect(hasAttr(updatedAt, PG_UPDATED_AT)).toBe(true);
    expect(hasAttr(updatedAt, PG_DEFAULT)).toBe(true);
    expect(z.toJSONSchema(createdAt)).toEqual(z.toJSONSchema(updatedAt));
    expect(z.toJSONSchema(createdAt)).toMatchObject({
      type: "string",
      format: "date-time",
    });

    const deletedAt = db.deletedAt();
    expect(hasAttr(deletedAt, PG_DELETED_AT)).toBe(true);
    expect(z.schema.isOptional(deletedAt)).toBe(true);
  });

  test("caller schemas stay untouched", () => {
    const shared = z.uuid();
    const ref = db.ref(shared, () => ({}));
    expect(ref).not.toBe(shared);
    expect(hasAttr(ref, PG_REF)).toBe(true);
    expect(hasAttr(shared, PG_REF)).toBe(false);

    const slug = z.text();
    const pk = db.primaryKey(slug);
    expect(pk).not.toBe(slug);
    expect(hasAttr(pk, PG_PRIMARY_KEY)).toBe(true);
    expect(hasAttr(slug, PG_PRIMARY_KEY)).toBe(false);

    const withDefault = db.default(shared, "x");
    expect(withDefault).not.toBe(shared);
    expect(hasAttr(shared, PG_DEFAULT)).toBe(false);
  });

  test("the in-place tagger is not public", async () => {
    // It mutates the schema it is given: offered to apps, it would turn a
    // shared schema into a foreign key everywhere.
    const orm = await import("../index.ts");
    expect("tagPgAttr" in orm).toBe(false);
  });

  test("column helpers build each type once", () => {
    expect(countNodes(() => db.primaryKey())).toBe(1);
    expect(countNodes(() => db.uuidPrimaryKey())).toBe(1);
    expect(countNodes(() => db.identityPrimaryKey())).toBe(1);
    expect(countNodes(() => db.createdAt())).toBe(1);
    expect(countNodes(() => db.updatedAt())).toBe(1);
    expect(countNodes(() => db.version())).toBe(1);
    expect(countNodes(() => db.deletedAt())).toBe(2);
  });
});
