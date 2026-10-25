import { z } from "alepha";
import { describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import {
  dataTableFilterKeys,
  dataTableFilterMode,
  buildDataTableFilterSchema,
} from "../dataTableFilterFields.ts";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
} from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const pageOf = (rows: Row[]) => ({
  content: rows,
  page: {
    number: 0,
    size: 20,
    offset: 0,
    numberOfElements: rows.length,
    totalElements: rows.length,
    totalPages: 1,
    isEmpty: rows.length === 0,
    isFirst: true,
    isLast: true,
  },
});

/**
 * Exact type equality, so a probe cannot pass by being wider than it claims.
 */
type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false;

const assertType = <T extends true>(_proof?: T): void => {};

const statusSchema = z.enum(["open", "closed"]);

/**
 * The hoisted form the owner chose (#E58): a `const` in the component body,
 * checked with `satisfies`, passed with `typeof`.
 */
const filterFields = {
  search: { preset: "search" },
  status: {
    schema: z.array(statusSchema),
    label: "Status",
    operators: "is",
  },
  tags: {
    schema: z.array(z.string()),
    label: "Tags",
    operators: "any-all-none",
    operatorKey: "tagMatch" as const,
  },
  owner: { schema: z.string(), label: "Owner", mode: "default" },
} satisfies DataTableFilterFields;

type Filters = DataTableFilterValues<typeof filterFields>;

/**
 * `DataTable`'s filters, typed from `fields`.
 *
 * The probes below are checked by `yarn w @alepha/ui typecheck` rather than by
 * the runner, which never typechecks: each `@ts-expect-error` is a line that
 * must NOT compile, and the build fails the day it does. The runtime cases pin
 * the schema the same record builds.
 */
describe("DataTable filter fields", () => {
  describe("types", () => {
    it("types each field, its operator key, and a search preset as a string", () => {
      assertType<Equal<Filters["search"], string | undefined>>();
      assertType<Equal<Filters["status"], ("open" | "closed")[] | undefined>>();
      assertType<Equal<Filters["statusOp"], "is" | "not" | undefined>>();
      assertType<
        Equal<Filters["tagMatch"], "any" | "all" | "none" | undefined>
      >();
      assertType<Equal<Filters["owner"], string | undefined>>();
      assertType<
        Equal<
          keyof Filters,
          "search" | "status" | "statusOp" | "tags" | "tagMatch" | "owner"
        >
      >();
      expect(true).toBe(true);
    });

    it("refuses what the fields do not declare", () => {
      const probes = () => [
        <DataTable<Row, typeof filterFields>
          key="fetch"
          columns={columns}
          filters={{ fields: filterFields }}
          fetch={async ({ filters }) => {
            const search: string | undefined = filters?.search;
            void search;
            // @ts-expect-error an unknown key read in fetch
            void filters?.nope;
            return pageOf([]);
          }}
        />,
        <DataTable<Row, typeof filterFields>
          key="values"
          columns={columns}
          data={[]}
          filter={(row, filters) =>
            // @ts-expect-error an unknown key read in the data predicate
            row.title === filters.nope
          }
          filters={{
            fields: filterFields,
            // @ts-expect-error a value outside the enum
            initialValues: { status: ["archived"] },
            // @ts-expect-error an operator value the preset does not carry
            seedValues: { statusOp: "none" },
            // @ts-expect-error a query key the fields do not declare
            fromQuery: ["nope"],
          }}
        />,
        <DataTable<Row>
          key="bare"
          columns={columns}
          data={[]}
          // @ts-expect-error inline fields under a bare row type: F is the no-filters default
          filters={{ fields: { status: { schema: z.string() } } }}
        />,
      ];
      void probes;

      // Each directive sits on the entry it refuses, not on the statement: the
      // error is reported at the entry, and the formatter is free to wrap the
      // statement around it.
      const unshaped = {
        // @ts-expect-error a field with neither a schema nor a preset
        x: { label: "X" },
      } satisfies DataTableFilterFields;
      const moded = {
        // @ts-expect-error a mode outside the three
        x: { preset: "search", mode: "sticky" },
      } satisfies DataTableFilterFields;
      void unshaped;
      void moded;
      expect(true).toBe(true);
    });

    it("has no hand-written schema any more, and a table without filters needs no type", () => {
      const probes = () => [
        <DataTable<Row>
          key="none"
          columns={columns}
          fetch={async () => pageOf([])}
        />,
        <DataTable<Row, typeof filterFields>
          key="retired"
          columns={columns}
          data={[]}
          filters={{
            fields: filterFields,
            // @ts-expect-error the retired `filters.schema`: the table builds the schema from `fields`
            schema: z.object({ search: z.string().optional() }),
          }}
        />,
      ];
      void probes;
      expect(true).toBe(true);
    });
  });

  describe("dataTableFilterKeys", () => {
    it("lists each field, followed by its operator key, in declaration order", () => {
      expect(dataTableFilterKeys(filterFields)).toEqual([
        "search",
        "status",
        "statusOp",
        "tags",
        "tagMatch",
        "owner",
      ]);
    });
  });

  describe("dataTableFilterMode", () => {
    it("locks the search preset, and makes every other field optional unless it says otherwise", () => {
      expect(dataTableFilterMode(filterFields.search)).toBe("locked");
      expect(dataTableFilterMode(filterFields.status)).toBe("optional");
      expect(dataTableFilterMode(filterFields.owner)).toBe("default");
      expect(dataTableFilterMode({ preset: "search", mode: "default" })).toBe(
        "default",
      );
    });
  });

  describe("buildDataTableFilterSchema", () => {
    const schema = buildDataTableFilterSchema(filterFields);

    it("declares every key, operator keys included", () => {
      expect(Object.keys(z.schema.shape(schema))).toEqual(
        dataTableFilterKeys(filterFields),
      );
    });

    it("makes every filter optional", () => {
      expect(schema.parse({})).toEqual({});
    });

    it("reads a search preset as a string", () => {
      expect(schema.parse({ search: "auth" })).toEqual({ search: "auth" });
      expect(() => schema.parse({ search: 3 })).toThrow();
    });

    it("accepts the operator values its preset carries, and nothing else", () => {
      expect(schema.parse({ statusOp: "not", tagMatch: "all" })).toEqual({
        statusOp: "not",
        tagMatch: "all",
      });
      expect(() => schema.parse({ statusOp: "all" })).toThrow();
    });

    it("takes a custom operator list's values", () => {
      const custom = buildDataTableFilterSchema({
        size: {
          schema: z.string(),
          operators: [
            { value: "eq", label: "equals" },
            { value: "gt", label: "above" },
          ],
        },
      });
      expect(custom.parse({ sizeOp: "gt" })).toEqual({ sizeOp: "gt" });
      expect(() => custom.parse({ sizeOp: "lt" })).toThrow();
    });
  });
});
