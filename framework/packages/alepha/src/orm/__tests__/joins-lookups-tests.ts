import type { Alepha } from "alepha";
import { z } from "alepha";
import { expect } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";

// ============================================================================
// Entity definitions: two entities with a foreign key relationship
// ============================================================================

const teams = $entity({
  name: "teams",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
    country: z.text(),
  }),
});

const players = $entity({
  name: "players",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    teamId: db.ref(z.integer().optional(), () => teams.cols.id),
    name: z.text(),
    position: z.text(),
    goals: db.default(z.integer(), 0),
  }),
});

class App {
  teams = $repository(teams);
  players = $repository(players);
}

// ============================================================================
// Shared setup
// ============================================================================

async function seed(app: App) {
  const barca = await app.teams.create({
    name: "FC Barcelona",
    country: "Spain",
  });
  const psg = await app.teams.create({
    name: "Paris Saint-Germain",
    country: "France",
  });
  const real = await app.teams.create({
    name: "Real Madrid",
    country: "Spain",
  });

  const messi = await app.players.create({
    teamId: barca.id,
    name: "Messi",
    position: "Forward",
    goals: 672,
  });
  const pedri = await app.players.create({
    teamId: barca.id,
    name: "Pedri",
    position: "Midfielder",
    goals: 18,
  });
  const mbappe = await app.players.create({
    teamId: psg.id,
    name: "Mbappé",
    position: "Forward",
    goals: 256,
  });
  const modric = await app.players.create({
    teamId: real.id,
    name: "Modrić",
    position: "Midfielder",
    goals: 39,
  });
  const freeAgent = await app.players.create({
    name: "Free Agent",
    position: "Goalkeeper",
    goals: 0,
  });

  return {
    teams: { barca, psg, real },
    players: { messi, pedri, mbappe, modric, freeAgent },
  };
}

// ============================================================================
// OR filter across base + joined table
// ============================================================================

export const testOrFilterAcrossTables = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const results = await app.players.findMany({
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
    where: {
      or: [{ goals: { gte: 200 } }, { team: { country: { eq: "France" } } }],
    },
    orderBy: { column: "goals", direction: "desc" },
  });

  // Messi (672), Mbappé (256 + France): Mbappé matches both conditions
  expect(results.length).toBe(2);
  expect(results.map((r) => r.name)).toEqual(["Messi", "Mbappé"]);
};

// ============================================================================
// getOne with join throws when not found
// ============================================================================

export const testGetOneWithJoinThrowsWhenNotFound = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  await expect(
    app.players.getOne({
      where: { name: { eq: "Neymar" } },
      with: {
        team: {
          join: teams,
          on: ["teamId", teams.cols.id],
        },
      },
    }),
  ).rejects.toThrow();
};

// ============================================================================
// findOne with join: returns undefined instead of throwing
// ============================================================================

export const testFindOneWithJoinReturnsUndefined = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const result = await app.players.findOne({
    where: { name: { eq: "Neymar" } },
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
  });

  expect(result).toBeUndefined();
};

// ============================================================================
// Multiple operators on joined table filter
// ============================================================================

export const testMultipleOperatorsOnJoinedFilter = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const results = await app.players.findMany({
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
    where: {
      team: {
        name: { contains: "paris" }, // case-insensitive
      },
    },
  });

  expect(results.length).toBe(1);
  expect(results[0].name).toBe("Mbappé");
  expect(results[0].team.name).toBe("Paris Saint-Germain");
};

// ============================================================================
// getById / findById accept a `with` map for relation eager-loading
// ============================================================================

export const testGetByIdWithRelations = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const { players: p } = await seed(app);

  // `as const` on the tuple should compile without an explicit cast.
  const withTeam = {
    team: { join: teams, on: ["teamId", teams.cols.id] as const },
  } as const;

  const found = await app.players.getById(p.messi.id, { with: withTeam });
  expect(found.name).toBe("Messi");
  expect(found.team?.name).toBe("FC Barcelona");

  // findById returns undefined on miss
  const missing = await app.players.findById(999_999, { with: withTeam });
  expect(missing).toBeUndefined();

  // Without `with`, the result is the plain row (no `.team` widening).
  const plain = await app.players.getById(p.messi.id);
  expect(plain.name).toBe("Messi");
};
