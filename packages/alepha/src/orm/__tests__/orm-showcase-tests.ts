import type { Alepha } from "alepha";
import { t } from "alepha";
import { expect } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

// ============================================================================
// Entity definitions — two entities with a foreign key relationship
// ============================================================================

const teams = $entity({
  name: "teams",
  schema: t.object({
    id: db.primaryKey(),
    name: t.text(),
    country: t.text(),
  }),
});

const players = $entity({
  name: "players",
  schema: t.object({
    id: db.primaryKey(),
    teamId: db.ref(t.optional(t.integer()), () => teams.cols.id),
    name: t.text(),
    position: t.text(),
    goals: db.default(t.integer(), 0),
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
// 1. Basic left join — player with their team
// ============================================================================

export const testLeftJoinPlayerWithTeam = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const { players: p } = await seed(app);

  const result = await app.players.getOne({
    where: { id: { eq: p.messi.id } },
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
  });

  expect(result.name).toBe("Messi");
  expect(result.team).toBeDefined();
  expect(result.team.name).toBe("FC Barcelona");
  expect(result.team.country).toBe("Spain");
};

// ============================================================================
// 2. Left join returns undefined when FK is null
// ============================================================================

export const testLeftJoinReturnsUndefinedWhenFkNull = async (
  alepha: Alepha,
) => {
  const app = alepha.inject(App);
  await alepha.start();
  const { players: p } = await seed(app);

  const result = await app.players.getOne({
    where: { id: { eq: p.freeAgent.id } },
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
  });

  expect(result.name).toBe("Free Agent");
  expect(result.team).toBeUndefined();
};

// ============================================================================
// 3. Inner join excludes rows without match
// ============================================================================

export const testInnerJoinExcludesNulls = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const results = await app.players.findMany({
    with: {
      team: {
        type: "inner",
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
  });

  // Free Agent has no team → excluded by inner join
  expect(results.length).toBe(4);
  expect(results.every((r) => r.team !== null && r.team !== undefined)).toBe(
    true,
  );
  expect(results.find((r) => r.name === "Free Agent")).toBeUndefined();
};

// ============================================================================
// 4. findMany with join + filter on joined table
// ============================================================================

export const testFilterOnJoinedTable = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const spanishPlayers = await app.players.findMany({
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
    where: {
      team: {
        country: { eq: "Spain" },
      },
    },
  });

  expect(spanishPlayers.length).toBe(3); // Messi, Pedri (Barça), Modrić (Real)
  expect(spanishPlayers.every((p) => p.team.country === "Spain")).toBe(true);
};

// ============================================================================
// 5. Combined filters — base table + joined table
// ============================================================================

export const testCombinedFilters = async (alepha: Alepha) => {
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
      and: [
        { position: { eq: "Forward" } },
        { team: { country: { eq: "Spain" } } },
      ],
    },
  });

  expect(results.length).toBe(1);
  expect(results[0].name).toBe("Messi");
};

// ============================================================================
// 6. findMany with join + orderBy + limit
// ============================================================================

export const testJoinWithOrderByAndLimit = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const topScorers = await app.players.findMany({
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
    orderBy: { column: "goals", direction: "desc" },
    limit: 2,
  });

  expect(topScorers.length).toBe(2);
  expect(topScorers[0].name).toBe("Messi");
  expect(topScorers[1].name).toBe("Mbappé");
  expect(topScorers[0].team).toBeDefined();
  expect(topScorers[1].team).toBeDefined();
};

// ============================================================================
// 7. Pagination with joins
// ============================================================================

export const testPaginationWithJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const page = await app.players.paginate(
    { page: 0, size: 2 },
    {
      with: {
        team: {
          join: teams,
          on: ["teamId", teams.cols.id],
        },
      },
      orderBy: { column: "name", direction: "asc" },
    },
  );

  expect(page.content.length).toBe(2);
  expect(page.page.isFirst).toBe(true);
  expect(page.page.isLast).toBe(false);
  // Each result should include the joined team
  for (const player of page.content) {
    // Some players may have no team (left join)
    if (player.teamId) {
      expect(player.team).toBeDefined();
    }
  }
};

// ============================================================================
// 8. OR filter across base + joined table
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

  // Messi (672), Mbappé (256 + France) — Mbappé matches both conditions
  expect(results.length).toBe(2);
  expect(results.map((r) => r.name)).toEqual(["Messi", "Mbappé"]);
};

// ============================================================================
// 9. getOne with join throws when not found
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
// 10. findOne with join — returns undefined instead of throwing
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
// 11. Empty result set with joins
// ============================================================================

export const testEmptyResultWithJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const results = await app.players.findMany({
    where: { position: { eq: "Defender" } },
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
  });

  expect(results.length).toBe(0);
};

// ============================================================================
// 12. Multiple operators on joined table filter
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
// 13. Join with offset (pagination without paginate)
// ============================================================================

export const testJoinWithOffset = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await seed(app);

  const results = await app.players.findMany({
    with: {
      team: {
        type: "inner",
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
    orderBy: { column: "name", direction: "asc" },
    offset: 1,
    limit: 2,
  });

  // Inner join excludes Free Agent → sorted: Mbappé, Messi, Modrić, Pedri
  // offset 1 + limit 2 → Messi, Modrić
  expect(results.length).toBe(2);
  expect(results[0].name).toBe("Messi");
  expect(results[1].name).toBe("Modrić");
};
