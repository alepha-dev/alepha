/**
 * Type-only spike: does Drizzle's RQB infer from the table types Alepha
 * already produces?
 *
 * Nothing here runs. `tsc` passing or failing *is* the result — the values are
 * all `{} as T`, because only the types are under test.
 *
 * The premise: `Repository.table` is already declared as
 * `PgTableWithColumns<SchemaToTableConfig<T>>`, so a statically-typed Drizzle
 * table per entity is derivable from the entity alone, even though the actual
 * table object is built at runtime. If that type is good enough for
 * `defineRelations`, the bridge is typed; if it is not, `$relations` would sit
 * on an untyped engine and lose the only thing it is for.
 */
import type { SchemaToTableConfig } from "alepha/orm";
import { defineRelations } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import type { campaigns } from "./entities/campaigns.ts";
import type { characters } from "./entities/characters.ts";
import type { users } from "./entities/users.ts";

/** The Drizzle table type for an Alepha entity, derived from its schema. */
type TableOf<TEntity extends { schema: any }> = PgTableWithColumns<
  SchemaToTableConfig<TEntity["schema"]>
>;

const tables = {
  users: {} as TableOf<typeof users>,
  campaigns: {} as TableOf<typeof campaigns>,
  characters: {} as TableOf<typeof characters>,
};

/**
 * Step 1 — does the column-ref builder resolve real column names?
 *
 * If `r.campaigns.ownerId` is `any`, everything downstream is decoration.
 */
export const relations = defineRelations(tables, (r) => ({
  campaigns: {
    owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
    characters: r.many.characters({
      from: r.campaigns.id,
      to: r.characters.campaignId,
    }),
  },
  characters: {
    campaign: r.one.campaigns({
      from: r.characters.campaignId,
      to: r.campaigns.id,
    }),
  },
}));

/**
 * Step 2 — is a wrong column actually rejected?
 *
 * This is the load-bearing assertion. If it does not error, inference is not
 * happening and step 1 passed by being `any`.
 */
export const rejectsUnknownColumn = () =>
  defineRelations(tables, (r) => ({
    campaigns: {
      owner: r.one.users({
        // @ts-expect-error `nope` is not a column of campaigns.
        from: r.campaigns.nope,
        to: r.users.id,
      }),
    },
  }));

/**
 * Step 3 — is a type-mismatched join rejected?
 *
 * `campaigns.title` is text, `users.id` is a uuid string... both strings, so
 * this pairs a string with a *number* instead to make the mismatch real.
 */
/**
 * RESULT: Drizzle does *not* check this, and neither does the derivation.
 *
 * Verified against real `sqliteTable` definitions too, so it is Drizzle's own
 * behaviour rather than something Alepha's types lose: `defineRelations`
 * accepts joining a text column to an integer one. The hand-written
 * `$relations` in this PoC rejects it, so on this single point the current
 * declaration is stricter than the engine it would delegate to — an argument
 * for keeping the Alepha-facing declaration and translating down.
 */
export const doesNotRejectMismatchedTypes = () =>
  defineRelations(tables, (r) => ({
    characters: {
      campaign: r.one.campaigns({
        from: r.characters.name,
        to: r.campaigns.id,
      }),
    },
  }));

/**
 * Step 4 — the one that decides it.
 *
 * `defineRelations` accepting the derived tables is not enough. The payoff is
 * the *result* type: if `rows[0].owner.name` is `any`, `$relations` would be a
 * typed façade over an untyped engine, which is worse than what exists now.
 */
type Db = SQLiteAsyncDatabase<"sync", unknown, typeof relations>;

export const resultInference = async (db: Db) => {
  const rows = await db.query.campaigns.findMany({
    with: { owner: true, characters: true },
  });

  // RESULT: full inference, through Alepha's own derived table types.
  //
  // These were `unknown` until SchemaToTableConfig stopped declaring every
  // column as a bare `PgColumn` — the value type was being dropped before
  // Drizzle ever saw it. Nothing about the dialect was ever the problem.
  const title: string = rows[0]!.title;
  const ownerName: string | undefined = rows[0]!.owner?.name;
  const characterName: string | undefined = rows[0]!.characters[0]?.name;

  return [title, ownerName, characterName];
};

export const rejectsRelationNotIncluded = async (db: Db) => {
  const rows = await db.query.campaigns.findMany({ with: { owner: true } });

  // @ts-expect-error `characters` was not included, so it is not on the type.
  return rows[0]!.characters;
};

export const rejectsUndeclaredRelation = async (db: Db) =>
  // @ts-expect-error there is no `author` relation on campaigns.
  await db.query.campaigns.findMany({ with: { author: true } });
