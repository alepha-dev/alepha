import type { Alepha } from "alepha";
import { t } from "alepha";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { $entity, $repository, db } from "../index.ts";

// ============================================================================
// Schema definitions
// ============================================================================

const countries = $entity({
  name: "countries",
  schema: t.object({
    id: db.primaryKey(),
    name: t.text(),
    code: t.text(),
  }),
});

const cities = $entity({
  name: "cities",
  schema: t.object({
    id: db.primaryKey(),
    countryId: db.ref(t.integer(), () => countries.cols.id),
    name: t.text(),
    population: t.optional(t.integer()),
  }),
});

const users = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    name: t.text(),
    email: t.text(),
    cityId: db.ref(t.optional(t.integer()), () => cities.cols.id),
    managerId: db.ref(t.optional(t.integer()), () => users.cols.id),
  }),
});

const profiles = $entity({
  name: "profiles",
  schema: t.object({
    id: db.primaryKey(),
    userId: db.ref(t.integer(), () => users.cols.id),
    bio: t.text(),
    website: t.optional(t.text()),
  }),
});

const posts = $entity({
  name: "posts",
  schema: t.object({
    id: db.primaryKey(),
    authorId: db.ref(t.integer(), () => users.cols.id),
    title: t.text(),
    content: t.text(),
    publishedAt: db.createdAt(),
  }),
});

const comments = $entity({
  name: "comments",
  schema: t.object({
    id: db.primaryKey(),
    postId: db.ref(t.integer(), () => posts.cols.id),
    authorId: db.ref(t.integer(), () => users.cols.id),
    content: t.text(),
    createdAt: db.createdAt(),
  }),
});

const tags = $entity({
  name: "tags",
  schema: t.object({
    id: db.primaryKey(),
    name: t.text(),
  }),
});

const postTags = $entity({
  name: "post_tags",
  schema: t.object({
    id: db.primaryKey(),
    postId: db.ref(t.integer(), () => posts.cols.id),
    tagId: db.ref(t.integer(), () => tags.cols.id),
  }),
});

class App {
  countries = $repository(countries);
  cities = $repository(cities);
  users = $repository(users);
  profiles = $repository(profiles);
  posts = $repository(posts);
  comments = $repository(comments);
  tags = $repository(tags);
  postTags = $repository(postTags);
}

// ============================================================================
// Test setup helpers
// ============================================================================

async function setupTestData(app: App) {
  // Create countries
  const usa = await app.countries.create({
    name: "United States",
    code: "US",
  });
  const canada = await app.countries.create({ name: "Canada", code: "CA" });

  // Create cities
  const nyc = await app.cities.create({
    countryId: usa.id,
    name: "New York",
    population: 8_000_000,
  });
  const toronto = await app.cities.create({
    countryId: canada.id,
    name: "Toronto",
    population: 3_000_000,
  });
  const vancouver = await app.cities.create({
    countryId: canada.id,
    name: "Vancouver",
    population: 700_000,
  });

  // Create users
  const alice = await app.users.create({
    name: "Alice",
    email: "alice@example.com",
    cityId: nyc.id,
  });
  const bob = await app.users.create({
    name: "Bob",
    email: "bob@example.com",
    cityId: toronto.id,
    managerId: alice.id,
  });
  const charlie = await app.users.create({
    name: "Charlie",
    email: "charlie@example.com",
    cityId: vancouver.id,
    managerId: alice.id,
  });
  const diana = await app.users.create({
    name: "Diana",
    email: "diana@example.com",
    cityId: toronto.id,
    managerId: bob.id,
  });

  // Create profiles
  await app.profiles.create({
    userId: alice.id,
    bio: "Tech lead and mentor",
    website: "https://alice.dev",
  });
  await app.profiles.create({
    userId: bob.id,
    bio: "Senior developer",
  });
  await app.profiles.create({
    userId: charlie.id,
    bio: "Frontend specialist",
    website: "https://charlie.io",
  });

  // Create posts
  const post1 = await app.posts.create({
    authorId: alice.id,
    title: "Introduction to TypeScript",
    content: "TypeScript is great...",
  });
  const post2 = await app.posts.create({
    authorId: alice.id,
    title: "Advanced PostgreSQL",
    content: "Let's dive deep into Postgres...",
  });
  const post3 = await app.posts.create({
    authorId: bob.id,
    title: "React Best Practices",
    content: "Here are some tips...",
  });

  // Create tags
  const typescript = await app.tags.create({ name: "TypeScript" });
  const postgres = await app.tags.create({ name: "PostgreSQL" });
  const react = await app.tags.create({ name: "React" });

  // Create post-tag associations
  await app.postTags.create({ postId: post1.id, tagId: typescript.id });
  await app.postTags.create({ postId: post2.id, tagId: postgres.id });
  await app.postTags.create({ postId: post3.id, tagId: react.id });
  await app.postTags.create({ postId: post3.id, tagId: typescript.id });

  // Create comments
  await app.comments.create({
    postId: post1.id,
    authorId: bob.id,
    content: "Great article!",
  });
  await app.comments.create({
    postId: post1.id,
    authorId: charlie.id,
    content: "Very helpful, thanks!",
  });
  await app.comments.create({
    postId: post2.id,
    authorId: diana.id,
    content: "Could you explain more about indexes?",
  });

  return {
    countries: { usa, canada },
    cities: { nyc, toronto, vancouver },
    users: { alice, bob, charlie, diana },
    posts: { post1, post2, post3 },
    tags: { typescript, postgres, react },
  };
}

// ============================================================================
// Basic joins
// ============================================================================

export const testSimpleLeftJoin = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.alice.id } },
    with: {
      profile: {
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
    },
  });

  expect(result.id).toBe(testUsers.alice.id);
  expect(result.name).toBe("Alice");
  expect(result.profile).toBeDefined();
  expect(result.profile.bio).toBe("Tech lead and mentor");
  expect(result.profile.website).toBe("https://alice.dev");
};

export const testLeftJoinTupleSyntax = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { cities: testCities } = await setupTestData(app);

  const result = await app.cities.getOne({
    where: { id: { eq: testCities.nyc.id } },
    with: {
      country: {
        join: countries,
        on: ["countryId", countries.cols.id],
      },
    },
  });

  expect(result.name).toBe("New York");
  expect(result.country).toBeDefined();
  expect(result.country.name).toBe("United States");
  expect(result.country.code).toBe("US");
};

export const testLeftJoinSqlWrapper = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.alice.id } },
    with: {
      profile: {
        join: profiles,
        on: sql`${users.cols.id} = ${profiles.cols.userId}`,
      },
    },
  });

  expect(result.name).toBe("Alice");
  expect(result.profile).toBeDefined();
  expect(result.profile.bio).toBe("Tech lead and mentor");
};

export const testInnerJoin = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  // Diana has no profile, so should be excluded with inner join
  const results = await app.users.findMany({
    with: {
      profile: {
        type: "inner",
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
    },
  });

  expect(results.length).toBe(3); // Alice, Bob, Charlie have profiles
  expect(results.every((u) => u.profile !== null)).toBe(true);
  expect(results.find((u) => u.name === "Diana")).toBeUndefined();
};

// ============================================================================
// Self-referencing joins
// ============================================================================

export const testSelfReferencingJoinWithManager = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const manager = users.alias("manager");

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.bob.id } },
    with: {
      manager: {
        join: manager,
        on: ["managerId", manager.cols.id],
      },
    },
  });

  expect(result.name).toBe("Bob");
  expect(result.manager).toBeDefined();
  expect(result.manager.name).toBe("Alice");
  expect(result.manager.email).toBe("alice@example.com");
};

export const testSelfReferencingJoinWithoutManager = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    where: {
      managerId: { isNull: true },
    },
  });

  expect(results.length).toBe(1);
  expect(results[0].name).toBe("Alice");
};

// ============================================================================
// Multiple joins
// ============================================================================

export const testMultipleJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.bob.id } },
    with: {
      profile: {
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
  });

  expect(result.name).toBe("Bob");
  expect(result.profile).toBeDefined();
  expect(result.profile.bio).toBe("Senior developer");
  expect(result.city).toBeDefined();
  expect(result.city.name).toBe("Toronto");
  expect(result.city.population).toBe(3_000_000);
};

export const testMultipleJoinsWithDifferentTypes = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.alice.id } },
    with: {
      profile: {
        type: "inner", // Must have profile
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
      city: {
        type: "left", // May not have city
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
  });

  expect(result.name).toBe("Alice");
  expect(result.profile).toBeDefined();
  expect(result.city).toBeDefined();
};

// ============================================================================
// Nested joins (2 levels)
// ============================================================================

export const testNestedJoin2LevelsUserCityCountry = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.bob.id } },
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
        with: {
          country: {
            join: countries,
            on: ["countryId", countries.cols.id],
          },
        },
      },
    },
  });

  expect(result.name).toBe("Bob");
  expect(result.city).toBeDefined();
  expect(result.city.name).toBe("Toronto");
  expect(result.city.country).toBeDefined();
  expect(result.city.country.name).toBe("Canada");
  expect(result.city.country.code).toBe("CA");
};

export const testNestedJoin2LevelsPostAuthorCity = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { posts: testPosts } = await setupTestData(app);

  const result = await app.posts.getOne({
    where: { id: { eq: testPosts.post1.id } },
    with: {
      author: {
        join: users,
        on: ["authorId", users.cols.id],
        with: {
          city: {
            join: cities,
            on: ["cityId", cities.cols.id],
          },
        },
      },
    },
  });

  expect(result.title).toBe("Introduction to TypeScript");
  expect(result.author).toBeDefined();
  expect(result.author.name).toBe("Alice");
  expect(result.author.city).toBeDefined();
  expect(result.author.city.name).toBe("New York");
};

export const testMultipleNestedJoinsWithManagerAndCities = async (
  alepha: Alepha,
) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const manager = users.alias("manager");
  const managerCity = cities.alias("manager_city");

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.bob.id } },
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
        with: {
          country: {
            join: countries,
            on: ["countryId", countries.cols.id],
          },
        },
      },
      manager: {
        join: manager,
        on: ["managerId", manager.cols.id],
        with: {
          city: {
            join: managerCity,
            on: ["cityId", managerCity.cols.id],
          },
        },
      },
    },
  });

  expect(result.name).toBe("Bob");
  expect(result.city).toBeDefined();
  expect(result.city.name).toBe("Toronto");
  expect(result.city.country).toBeDefined();
  expect(result.city.country.name).toBe("Canada");
  expect(result.manager).toBeDefined();
  expect(result.manager.name).toBe("Alice");
  expect(result.manager.city).toBeDefined();
  expect(result.manager.city.name).toBe("New York");
};

// ============================================================================
// Nested joins (3 levels)
// ============================================================================

export const testNestedJoin3LevelsPostAuthorCityCountry = async (
  alepha: Alepha,
) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { posts: testPosts } = await setupTestData(app);

  const result = await app.posts.getOne({
    where: { id: { eq: testPosts.post3.id } },
    with: {
      author: {
        join: users,
        on: ["authorId", users.cols.id],
        with: {
          city: {
            join: cities,
            on: ["cityId", cities.cols.id],
            with: {
              country: {
                join: countries,
                on: ["countryId", countries.cols.id],
              },
            },
          },
        },
      },
    },
  });

  expect(result.title).toBe("React Best Practices");
  expect(result.author).toBeDefined();
  expect(result.author.name).toBe("Bob");
  expect(result.author.city).toBeDefined();
  expect(result.author.city.name).toBe("Toronto");
  expect(result.author.city.country).toBeDefined();
  expect(result.author.city.country.name).toBe("Canada");
  expect(result.author.city.country.code).toBe("CA");
};

export const testDeeplyNestedSelfReference = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { users: testUsers } = await setupTestData(app);

  const manager = users.alias("manager");
  const managerManager = users.alias("manager_manager");

  const result = await app.users.getOne({
    where: { id: { eq: testUsers.diana.id } },
    with: {
      manager: {
        join: manager,
        on: ["managerId", manager.cols.id],
        with: {
          manager: {
            join: managerManager,
            on: ["managerId", managerManager.cols.id],
          },
        },
      },
    },
  });

  expect(result.name).toBe("Diana");
  expect(result.manager).toBeDefined();
  expect(result.manager.name).toBe("Bob");
  expect(result.manager.manager).toBeDefined();
  expect(result.manager.manager.name).toBe("Alice");
};

// ============================================================================
// Where clause on joined tables
// ============================================================================

export const testFilterByJoinedTableColumn = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
    where: {
      city: {
        name: { eq: "Toronto" },
      },
    },
  });

  expect(results.length).toBe(2); // Bob and Diana
  expect(results.every((u) => u.city.name === "Toronto")).toBe(true);
  expect(results.map((u) => u.name).sort()).toEqual(["Bob", "Diana"]);
};

export const testFilterByNestedJoinedTableColumn = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
        with: {
          country: {
            join: countries,
            on: ["countryId", countries.cols.id],
          },
        },
      },
    },
    where: {
      city: {
        country: {
          code: { eq: "CA" },
        },
      },
    },
  });

  expect(results.length).toBe(3); // Bob, Charlie, Diana in Canadian cities
  expect(results.every((u) => u.city.country.code === "CA")).toBe(true);
};

export const testCombineBaseAndJoinedTableFilters = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
    where: {
      and: [
        { name: { contains: "ar" } }, // Charlie
        {
          city: {
            population: { gt: 500_000 },
          },
        },
      ],
    },
  });

  expect(results.length).toBe(1);
  expect(results[0].name).toBe("Charlie");
  expect(results[0].city.name).toBe("Vancouver");
};

export const testFilterBySelfReferencingJoin = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const manager = users.alias("manager");

  const results = await app.users.findMany({
    with: {
      manager: {
        join: manager,
        on: ["managerId", manager.cols.id],
      },
    },
    where: {
      manager: {
        name: { eq: "Alice" },
      },
    },
  });

  expect(results.length).toBe(2); // Bob and Charlie report to Alice
  expect(results.map((u) => u.name).sort()).toEqual(["Bob", "Charlie"]);
  expect(results.every((u) => u.manager?.name === "Alice")).toBe(true);
};

// ============================================================================
// Find multiple with joins
// ============================================================================

export const testFindMultipleWithJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    with: {
      profile: {
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
    orderBy: { column: "name", direction: "asc" },
  });

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].name).toBe("Alice");
  expect(results[0].profile).toBeDefined();
  expect(results[0].city).toBeDefined();
};

export const testFindWithJoinsAndLimit = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
    limit: 2,
    orderBy: { column: "name", direction: "asc" },
  });

  expect(results.length).toBe(2);
  expect(results[0].name).toBe("Alice");
  expect(results[1].name).toBe("Bob");
};

export const testFindWithJoinsAndOffset = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    with: {
      profile: {
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
    },
    offset: 1,
    limit: 2,
    orderBy: { column: "name", direction: "asc" },
  });

  expect(results.length).toBe(2);
  expect(results[0].name).toBe("Bob");
  expect(results[1].name).toBe("Charlie");
};

// ============================================================================
// Complex scenarios
// ============================================================================

export const testPostWithAuthorCommentsAndCommentAuthors = async (
  alepha: Alepha,
) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { posts: testPosts } = await setupTestData(app);

  // This requires multiple separate queries since we don't support one-to-many yet
  const post = await app.posts.getOne({
    where: { id: { eq: testPosts.post1.id } },
    with: {
      author: {
        join: users,
        on: ["authorId", users.cols.id],
      },
    },
  });

  const postComments = await app.comments.findMany({
    where: { postId: { eq: testPosts.post1.id } },
    with: {
      author: {
        join: users,
        on: ["authorId", users.cols.id],
      },
    },
  });

  expect(post.title).toBe("Introduction to TypeScript");
  expect(post.author.name).toBe("Alice");
  expect(postComments.length).toBe(2);
  expect(postComments[0].author).toBeDefined();
  expect(postComments[1].author).toBeDefined();
};

export const testJoinWithNullForeignKey = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  // Create user without city
  const userWithoutCity = await app.users.create({
    name: "Eve",
    email: "eve@example.com",
  });

  const result = await app.users.getOne({
    where: { id: { eq: userWithoutCity.id } },
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
      },
    },
  });

  expect(result.name).toBe("Eve");
  expect(result.city).toBeUndefined();
};

export const testComplexWhereWithMultipleJoinFilters = async (
  alepha: Alepha,
) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const manager = users.alias("manager");

  const results = await app.users.findMany({
    with: {
      city: {
        join: cities,
        on: ["cityId", cities.cols.id],
        with: {
          country: {
            join: countries,
            on: ["countryId", countries.cols.id],
          },
        },
      },
      manager: {
        join: manager,
        on: ["managerId", manager.cols.id],
      },
    },
    where: {
      and: [
        { email: { endsWith: "example.com" } },
        {
          or: [
            {
              city: {
                population: { gte: 1_000_000 },
              },
            },
            {
              manager: {
                name: { eq: "Alice" },
              },
            },
          ],
        },
      ],
    },
  });

  expect(results.length).toBeGreaterThan(0);
  expect(results.every((u) => u.email.endsWith("example.com"))).toBe(true);
};

// ============================================================================
// Pagination with joins
// ============================================================================

export const testPaginateWithJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const page = await app.users.paginate(
    { page: 0, size: 2 },
    {
      with: {
        city: {
          join: cities,
          on: ["cityId", cities.cols.id],
        },
      },
      orderBy: { column: "name", direction: "asc" },
    },
  );

  expect(page.content.length).toBe(2);
  expect(page.content[0].name).toBe("Alice");
  expect(page.content[0].city).toBeDefined();
  expect(page.page.isFirst).toBe(true);
  expect(page.page.isLast).toBe(false);
};

export const testPaginateWithNestedJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const page = await app.users.paginate(
    { page: 0, size: 3 },
    {
      with: {
        city: {
          join: cities,
          on: ["cityId", cities.cols.id],
          with: {
            country: {
              join: countries,
              on: ["countryId", countries.cols.id],
            },
          },
        },
      },
    },
  );

  expect(page.content.length).toBe(3);
  expect(page.content[0].city).toBeDefined();
  expect(page.content[0].city.country).toBeDefined();
};

// ============================================================================
// Edge cases
// ============================================================================

export const testInnerJoinNoMatchingRecords = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    where: { name: { eq: "Diana" } }, // Diana has no profile
    with: {
      profile: {
        type: "inner",
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
    },
  });

  expect(results.length).toBe(0);
};

export const testSameTableJoinedMultipleTimesWithAliases = async (
  alepha: Alepha,
) => {
  const app = alepha.inject(App);
  await alepha.start();

  const { posts: testPosts } = await setupTestData(app);

  const author = users.alias("author");
  const authorCity = cities.alias("author_city");

  // Get first comment
  const comment = await app.comments.getOne({
    where: { postId: { eq: testPosts.post1.id } },
  });

  const result = await app.comments.getOne({
    where: { id: { eq: comment.id } },
    with: {
      post: {
        join: posts,
        on: ["postId", posts.cols.id],
        with: {
          author: {
            join: author,
            on: ["authorId", author.cols.id],
            with: {
              city: {
                join: authorCity,
                on: ["cityId", authorCity.cols.id],
              },
            },
          },
        },
      },
      author: {
        join: users,
        on: ["authorId", users.cols.id],
        with: {
          city: {
            join: cities,
            on: ["cityId", cities.cols.id],
          },
        },
      },
    },
  });

  expect(result.content).toBeDefined();
  expect(result.post).toBeDefined();
  expect(result.post.author).toBeDefined();
  expect(result.author).toBeDefined();
  // Both should have cities
  expect(result.post.author.city).toBeDefined();
  expect(result.author.city).toBeDefined();
};

export const testEmptyResultSetWithJoins = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await setupTestData(app);

  const results = await app.users.findMany({
    where: { name: { eq: "NonExistentUser" } },
    with: {
      profile: {
        join: profiles,
        on: ["id", profiles.cols.userId],
      },
    },
  });

  expect(results.length).toBe(0);
};
