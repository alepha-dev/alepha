import { type Alepha, z } from "alepha";
import { expect } from "vitest";
import { $entity, $repository } from "../core/index.ts";
import { db } from "../core/providers/DatabaseTypeProvider.ts";

// Helper function to parse dates from various formats
const parseDate = (dateValue: any): Date => {
  if (!dateValue) return new Date(0);
  if (typeof dateValue === "string") return new Date(dateValue);
  if (dateValue.toDate) return dateValue.toDate();
  if (dateValue.toISOString) return new Date(dateValue.toISOString());
  return new Date(dateValue);
};

const articleEntity = $entity({
  name: "articles",
  schema: z.object({
    id: db.primaryKey(),
    title: z.string(),
    content: z.text(),
    status: z.string(),
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
  schema: z.object({
    id: db.primaryKey(),
    userId: z.integer(),
    action: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt().optional(),
  }),
});

class TimestampTestApp {
  articles = $repository(articleEntity);
  activities = $repository(userActivityEntity);
}

// ============================================================================
// testTimestamps
// ============================================================================

export const testTimestamps = async (alepha: Alepha) => {
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

  const createdDate = parseDate(article1.createdAt);
  const updatedDate = parseDate(article1.updatedAt);

  expect(createdDate.getTime()).toBeGreaterThanOrEqual(
    beforeCreate.getTime() - 1000,
  );
  expect(createdDate.getTime()).toBeLessThanOrEqual(
    afterCreate.getTime() + 1000,
  );

  // Initially, updatedAt should equal createdAt
  expect(Math.abs(createdDate.getTime() - updatedDate.getTime())).toBeLessThan(
    1000,
  );

  // Test 2: Wait and update
  await new Promise((resolve) => setTimeout(resolve, 100));

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

  // updatedAt should be later
  expect(newUpdatedDate.getTime()).toBeGreaterThan(createdDate.getTime());
  expect(newUpdatedDate.getTime()).toBeGreaterThanOrEqual(
    beforeUpdate.getTime() - 1000,
  );
  expect(newUpdatedDate.getTime()).toBeLessThanOrEqual(
    afterUpdate.getTime() + 1000,
  );

  // Test 3: Create multiple articles
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

  for (const article of articles) {
    expect(article.createdAt).toBeDefined();
    expect(article.updatedAt).toBeDefined();
  }

  // Test 4: Query using createdAt ordering
  const sortedByCreated = await app.articles.findMany({
    orderBy: { column: "createdAt", direction: "asc" },
  });

  expect(sortedByCreated[0].id).toBe(article1.id);

  for (let i = 1; i < sortedByCreated.length; i++) {
    const prevDate = parseDate(sortedByCreated[i - 1].createdAt);
    const currDate = parseDate(sortedByCreated[i].createdAt);
    expect(currDate.getTime()).toBeGreaterThanOrEqual(prevDate.getTime());
  }

  // Test 5: Query with createdAt filters
  const recentArticles = await app.articles.findMany({
    where: {
      createdAt: {
        gte: article1.createdAt as any,
      },
    },
  });

  expect(recentArticles.length).toBeGreaterThan(0);
  expect(recentArticles.some((a) => a.id === article1.id)).toBe(true);

  // Test 6: User activities (optional updatedAt)
  const activity = await app.activities.create({
    userId: 1,
    action: "login",
    metadata: { ip: "192.168.1.1", browser: "Chrome" },
  });

  expect(activity.createdAt).toBeDefined();

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

  await new Promise((resolve) => setTimeout(resolve, 100));

  const batchUpdates = await Promise.all(
    batchArticles.map((article) =>
      app.articles.updateById(article.id, {
        status: "published",
      }),
    ),
  );

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

  await app.articles.clear({ force: true });
  await app.activities.clear({ force: true });
};

// ============================================================================
// testTimestampIndexes
// ============================================================================

export const testTimestampIndexes = async (alepha: Alepha) => {
  const app = alepha.inject(TimestampTestApp);
  await alepha.start();

  const article = await app.articles.create({
    title: "Index Test Article",
    content: "Testing indexes on timestamp fields",
    status: "draft",
  });

  const createdTime = parseDate(article.createdAt);
  const startTime = new Date(createdTime.getTime() - 1000);
  const endTime = new Date(createdTime.getTime() + 1000);

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

  // Composite index query
  const byStatusAndCreated = await app.articles.findMany({
    where: {
      status: { eq: "draft" },
      createdAt: { gte: startTime.toISOString() as any },
    },
  });

  expect(byStatusAndCreated.length).toBeGreaterThan(0);
  expect(byStatusAndCreated.some((a) => a.id === article.id)).toBe(true);

  await app.articles.clear({ force: true });
};

// ============================================================================
// testTimestampFormats
// ============================================================================

export const testTimestampFormats = async (alepha: Alepha) => {
  const eventEntity = $entity({
    name: "events",
    schema: z.object({
      id: db.primaryKey(),
      name: z.string(),
      startTime: db.createdAt(),
      endTime: db.updatedAt().optional(),
      scheduledAt: z.string(),
    }),
  });

  class EventApp {
    events = $repository(eventEntity);
  }

  const app = alepha.inject(EventApp);
  await alepha.start();

  const now = new Date();
  const event = await app.events.create({
    name: "Test Event",
    scheduledAt: now.toISOString(),
  });

  expect(event.startTime).toBeDefined();
  expect(event.scheduledAt).toBeDefined();

  const startTime = parseDate(event.startTime);
  expect(startTime).toBeInstanceOf(Date);
  expect(startTime.getTime()).toBeGreaterThan(0);

  expect(event.scheduledAt).toBe(now.toISOString());

  await app.events.clear({ force: true });
};

// ============================================================================
// testBulkInsertsWithTimestamps
// ============================================================================

export const testBulkInsertsWithTimestamps = async (alepha: Alepha) => {
  const app = alepha.inject(TimestampTestApp);
  await alepha.start();

  const beforeBulk = new Date();

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

  for (const article of articles) {
    const created = parseDate(article.createdAt);
    const updated = parseDate(article.updatedAt);

    expect(created.getTime()).toBeGreaterThanOrEqual(
      beforeBulk.getTime() - 1000,
    );
    expect(created.getTime()).toBeLessThanOrEqual(afterBulk.getTime() + 1000);
    expect(Math.abs(created.getTime() - updated.getTime())).toBeLessThan(1000);
  }

  // Query and verify ordering
  const ordered = await app.articles.findMany({
    orderBy: [
      { column: "createdAt", direction: "asc" },
      { column: "id", direction: "asc" },
    ],
  });

  expect(ordered).toHaveLength(10);

  for (let i = 1; i < ordered.length; i++) {
    const prev = parseDate(ordered[i - 1].createdAt);
    const curr = parseDate(ordered[i].createdAt);
    expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
  }

  await app.articles.clear({ force: true });
};
