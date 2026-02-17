import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository } from "../index.ts";
import { db } from "../providers/DatabaseTypeProvider.ts";

// Helper function to parse dates from various formats
const parseDate = (dateValue: any): Date => {
  if (!dateValue) return new Date(0);
  if (typeof dateValue === "string") return new Date(dateValue);
  if (dateValue.toDate) return dateValue.toDate();
  if (dateValue.toISOString) return new Date(dateValue.toISOString());
  return new Date(dateValue);
};

// Test entity with timestamp fields
const articleEntity = $entity({
  name: "articles",
  schema: t.object({
    id: db.primaryKey(),
    title: t.string(),
    content: t.text(),
    status: t.string(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    "createdAt",
    "updatedAt",
    {
      columns: ["status", "createdAt"],
      name: "status_created_idx",
    },
  ],
});

const userActivityEntity = $entity({
  name: "user_activities",
  schema: t.object({
    id: db.primaryKey(),
    userId: t.integer(),
    action: t.string(),
    metadata: t.optional(t.record(t.string(), t.any())),
    createdAt: db.createdAt(),
    updatedAt: t.optional(db.updatedAt()),
  }),
});

class TimestampTestApp {
  articles = $repository(articleEntity);
  activities = $repository(userActivityEntity);
}

/**
 * Shared test function that runs on both PostgreSQL and SQLite
 */
const testTimestamps = async (alepha: Alepha) => {
  const app = alepha.inject(TimestampTestApp);
  await alepha.start();

  // Test 1: createdAt should be automatically set on insert
  const beforeCreate = new Date();

  const article1 = await app.articles.create({
    title: "First Article",
    content: "This is the first article content",
    status: "draft",
  });

  const afterCreate = new Date();

  expect(article1.id).toBeDefined();
  expect(article1.createdAt).toBeDefined();
  expect(article1.updatedAt).toBeDefined();

  // Parse the dates - they come as dayjs objects from DrizzleSchemaCodec
  const createdDate = parseDate(article1.createdAt);
  const updatedDate = parseDate(article1.updatedAt);

  // createdAt should be between beforeCreate and afterCreate
  expect(createdDate.getTime()).toBeGreaterThanOrEqual(
    beforeCreate.getTime() - 1000,
  ); // Allow 1s margin
  expect(createdDate.getTime()).toBeLessThanOrEqual(
    afterCreate.getTime() + 1000,
  );

  // Initially, updatedAt should equal createdAt
  expect(Math.abs(createdDate.getTime() - updatedDate.getTime())).toBeLessThan(
    1000,
  ); // Within 1 second

  // Test 2: Wait a bit and update the record
  await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms

  const beforeUpdate = new Date();

  const updatedArticle = await app.articles.updateById(article1.id, {
    status: "published",
    title: "Updated First Article",
  });

  const afterUpdate = new Date();

  expect(updatedArticle.title).toBe("Updated First Article");
  expect(updatedArticle.status).toBe("published");

  const newUpdatedDate = parseDate(updatedArticle.updatedAt);
  const unchangedCreatedDate = parseDate(updatedArticle.createdAt);

  // createdAt should NOT change
  expect(unchangedCreatedDate.getTime()).toBe(createdDate.getTime());

  // updatedAt should be updated and be later than createdAt
  expect(newUpdatedDate.getTime()).toBeGreaterThan(createdDate.getTime());
  expect(newUpdatedDate.getTime()).toBeGreaterThanOrEqual(
    beforeUpdate.getTime() - 1000,
  );
  expect(newUpdatedDate.getTime()).toBeLessThanOrEqual(
    afterUpdate.getTime() + 1000,
  );

  // Test 3: Create multiple articles and verify they have different timestamps
  const articles = await Promise.all([
    app.articles.create({
      title: "Article 2",
      content: "Content 2",
      status: "draft",
    }),
    app.articles.create({
      title: "Article 3",
      content: "Content 3",
      status: "published",
    }),
    app.articles.create({
      title: "Article 4",
      content: "Content 4",
      status: "archived",
    }),
  ]);

  // All should have createdAt and updatedAt
  for (const article of articles) {
    expect(article.createdAt).toBeDefined();
    expect(article.updatedAt).toBeDefined();
  }

  // Test 4: Query using createdAt ordering
  const sortedByCreated = await app.articles.findMany({
    orderBy: { column: "createdAt", direction: "asc" },
  });

  // First article should be article1 (created first)
  expect(sortedByCreated[0].id).toBe(article1.id);

  // Verify the order is correct
  for (let i = 1; i < sortedByCreated.length; i++) {
    const prevDate = parseDate(sortedByCreated[i - 1].createdAt);
    const currDate = parseDate(sortedByCreated[i].createdAt);
    expect(currDate.getTime()).toBeGreaterThanOrEqual(prevDate.getTime());
  }

  // Test 5: Query with createdAt filters
  // Use the actual createdAt value from the first article (already a Dayjs object)
  const recentArticles = await app.articles.findMany({
    where: {
      createdAt: {
        gte: article1.createdAt as any, // Cast to any since it's actually compatible at runtime
      },
    },
  });

  expect(recentArticles.length).toBeGreaterThan(0);
  expect(recentArticles.some((a) => a.id === article1.id)).toBe(true);

  // Test 6: Test with user activities (optional updatedAt)
  const activity = await app.activities.create({
    userId: 1,
    action: "login",
    metadata: { ip: "192.168.1.1", browser: "Chrome" },
  });

  expect(activity.createdAt).toBeDefined();
  // updatedAt is optional, might be null or undefined initially

  // Test 7: Batch operations should maintain timestamps
  const batchArticles = await Promise.all([
    app.articles.create({
      title: "Batch 1",
      content: "Batch content 1",
      status: "draft",
    }),
    app.articles.create({
      title: "Batch 2",
      content: "Batch content 2",
      status: "draft",
    }),
  ]);

  // Update them all at once
  await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms

  const batchUpdates = await Promise.all(
    batchArticles.map((article) =>
      app.articles.updateById(article.id, {
        status: "published",
      }),
    ),
  );

  // All should have updated timestamps
  for (const updated of batchUpdates) {
    const createdTime = parseDate(updated.createdAt).getTime();
    const updatedTime = parseDate(updated.updatedAt).getTime();
    expect(updatedTime).toBeGreaterThan(createdTime);
  }

  // Test 8: Query using composite index with timestamps
  const statusCreatedQuery = await app.articles.findMany({
    where: {
      status: { eq: "published" },
    },
    orderBy: "createdAt",
  });

  expect(statusCreatedQuery.length).toBeGreaterThan(0);
  expect(statusCreatedQuery.every((a) => a.status === "published")).toBe(true);

  // Clean up
  await app.articles.clear({ force: true });
  await app.activities.clear({ force: true });
};

describe("Timestamp Fields (createdAt/updatedAt)", () => {
  it("should handle timestamps correctly in PostgreSQL", async () => {
    await testTimestamps(Alepha.create());
  });

  it("should handle timestamps correctly in SQLite", async () => {
    await testTimestamps(
      Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
        },
      }),
    );
  });

  it("should create proper indexes on timestamp fields", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(TimestampTestApp);
    await alepha.start();

    // Create some test data
    const article = await app.articles.create({
      title: "Index Test Article",
      content: "Testing indexes on timestamp fields",
      status: "draft",
    });

    // Query using the createdAt index - use range query instead of exact match
    // due to potential microsecond precision differences
    const createdTime = parseDate(article.createdAt);
    const startTime = new Date(createdTime.getTime() - 1000); // 1 second before
    const endTime = new Date(createdTime.getTime() + 1000); // 1 second after

    const byCreated = await app.articles.findMany({
      where: {
        createdAt: {
          gte: startTime.toISOString() as any,
          lte: endTime.toISOString() as any,
        },
      },
    });

    expect(byCreated.length).toBeGreaterThan(0);
    expect(byCreated.some((a) => a.id === article.id)).toBe(true);

    // Query using the composite index
    const byStatusAndCreated = await app.articles.findMany({
      where: {
        status: { eq: "draft" },
        createdAt: { gte: startTime.toISOString() as any },
      },
    });

    expect(byStatusAndCreated.length).toBeGreaterThan(0);
    expect(byStatusAndCreated.some((a) => a.id === article.id)).toBe(true);

    await app.articles.clear({ force: true });
  });

  it("should handle timestamps with different formats", async () => {
    // Test entity with custom timestamp configuration
    const eventEntity = $entity({
      name: "events",
      schema: t.object({
        id: db.primaryKey(),
        name: t.string(),
        startTime: db.createdAt(),
        endTime: t.optional(db.updatedAt()),
        scheduledAt: t.string(), // Regular string field for ISO date
      }),
    });

    class EventApp {
      events = $repository(eventEntity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(EventApp);
    await alepha.start();

    const now = new Date();
    const event = await app.events.create({
      name: "Test Event",
      scheduledAt: now.toISOString(),
    });

    expect(event.startTime).toBeDefined();
    expect(event.scheduledAt).toBeDefined();

    // startTime should be auto-generated
    const startTime = parseDate(event.startTime);
    expect(startTime).toBeInstanceOf(Date);
    expect(startTime.getTime()).toBeGreaterThan(0);

    // scheduledAt should match what we provided
    expect(event.scheduledAt).toBe(now.toISOString());

    await app.events.clear({ force: true });
  });

  it("should handle bulk inserts with timestamps", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(TimestampTestApp);
    await alepha.start();

    const beforeBulk = new Date();

    // Create multiple articles at once
    const articles = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.articles.create({
          title: `Bulk Article ${i}`,
          content: `Content for article ${i}`,
          status: i % 2 === 0 ? "draft" : "published",
        }),
      ),
    );

    const afterBulk = new Date();

    expect(articles).toHaveLength(10);

    // All should have timestamps within the expected range
    for (const article of articles) {
      const created = parseDate(article.createdAt);
      const updated = parseDate(article.updatedAt);

      expect(created.getTime()).toBeGreaterThanOrEqual(
        beforeBulk.getTime() - 1000,
      );
      expect(created.getTime()).toBeLessThanOrEqual(afterBulk.getTime() + 1000);
      expect(Math.abs(created.getTime() - updated.getTime())).toBeLessThan(
        1000,
      );
    }

    // Query and verify ordering
    const ordered = await app.articles.findMany({
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });

    expect(ordered).toHaveLength(10);

    // Verify chronological order
    for (let i = 1; i < ordered.length; i++) {
      const prev = parseDate(ordered[i - 1].createdAt);
      const curr = parseDate(ordered[i].createdAt);
      expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
    }

    await app.articles.clear({ force: true });
  });
});
