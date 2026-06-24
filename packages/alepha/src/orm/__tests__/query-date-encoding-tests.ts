import { type Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { expect } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

// ============================================================================
// testDateFiltersWithDayjs
// ============================================================================

export const testDateFiltersWithDayjs = async (alepha: Alepha) => {
  const Entity = $entity({
    name: "events",
    schema: z.object({
      id: db.primaryKey(),
      name: z.text(),
      eventDate: db.createdAt(),
      scheduledFor: z.datetime().optional(),
    }),
  });

  class App {
    repository = $repository(Entity);
  }

  const app = alepha.inject(App);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  await app.repository.create({
    name: "Past Event",
    scheduledFor: dt.utc("2024-01-01").toISOString(),
  });

  await app.repository.create({
    name: "Recent Event",
    scheduledFor: dt.utc("2024-06-01").toISOString(),
  });

  await app.repository.create({
    name: "Future Event",
    scheduledFor: dt.utc("2025-01-01").toISOString(),
  });

  // eq
  const exactMatch = await app.repository.findMany({
    where: { scheduledFor: { eq: dt.utc("2024-06-01").toISOString() } },
  });
  expect(exactMatch).toHaveLength(1);
  expect(exactMatch[0].name).toBe("Recent Event");

  // gt
  const futureEvents = await app.repository.findMany({
    where: { scheduledFor: { gt: dt.utc("2024-06-01").toISOString() } },
  });
  expect(futureEvents).toHaveLength(1);
  expect(futureEvents[0].name).toBe("Future Event");

  // lt
  const pastEvents = await app.repository.findMany({
    where: { scheduledFor: { lt: dt.utc("2024-06-01").toISOString() } },
  });
  expect(pastEvents).toHaveLength(1);
  expect(pastEvents[0].name).toBe("Past Event");

  // gte + lte (range)
  const rangeEvents = await app.repository.findMany({
    where: {
      and: [
        { scheduledFor: { gte: dt.utc("2024-01-01").toISOString() } },
        { scheduledFor: { lte: dt.utc("2024-12-31").toISOString() } },
      ],
    },
  });
  expect(rangeEvents).toHaveLength(2);
  expect(rangeEvents.map((e) => e.name)).toContain("Past Event");
  expect(rangeEvents.map((e) => e.name)).toContain("Recent Event");

  // between
  const betweenEvents = await app.repository.findMany({
    where: {
      eventDate: {
        between: [
          dt.utc("2024-01-01").toISOString(),
          dt.utc("2030-12-31").toISOString(),
        ] as any,
      },
    },
  });
  expect(betweenEvents.length).toBeGreaterThanOrEqual(3);

  // inArray
  const specificDates = await app.repository.findMany({
    where: {
      scheduledFor: {
        inArray: [
          dt.utc("2024-01-01").toISOString(),
          dt.utc("2025-01-01").toISOString(),
        ],
      },
    },
  });
  expect(specificDates).toHaveLength(2);
  expect(specificDates.map((e) => e.name)).toContain("Past Event");
  expect(specificDates.map((e) => e.name)).toContain("Future Event");

  // Direct value
  const directMatch = await app.repository.findMany({
    where: { scheduledFor: dt.utc("2024-06-01").toISOString() },
  });
  expect(directMatch).toHaveLength(1);
  expect(directMatch[0].name).toBe("Recent Event");
};

// ============================================================================
// testMixedDateFormats
// ============================================================================

export const testMixedDateFormats = async (alepha: Alepha) => {
  const Entity = $entity({
    name: "tasks",
    schema: z.object({
      id: db.primaryKey(),
      title: z.text(),
      dueDate: z.datetime().optional(),
    }),
  });

  class App {
    repository = $repository(Entity);
  }

  const app = alepha.inject(App);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  await app.repository.create({
    title: "Task 1",
    dueDate: dt.utc("2024-03-15").toISOString(),
  });

  await app.repository.create({
    title: "Task 2",
    dueDate: dt.utc("2024-06-20").toISOString(),
  });

  // With Dayjs object
  const withDayjs = await app.repository.findMany({
    where: { dueDate: { gte: dt.utc("2024-06-01").toISOString() } },
  });
  expect(withDayjs).toHaveLength(1);
  expect(withDayjs[0].title).toBe("Task 2");

  // With ISO string
  const withString = await app.repository.findMany({
    where: { dueDate: { gte: "2024-06-01T00:00:00.000Z" as any } },
  });
  expect(withString).toHaveLength(1);
  expect(withString[0].title).toBe("Task 2");
};

// ============================================================================
// testDateComparisonsInComplexQueries
// ============================================================================

export const testDateComparisonsInComplexQueries = async (alepha: Alepha) => {
  const Entity = $entity({
    name: "appointments",
    schema: z.object({
      id: db.primaryKey(),
      patientName: z.text(),
      appointmentDate: z.datetime(),
      status: z.text(),
    }),
  });

  class App {
    repository = $repository(Entity);
  }

  const app = alepha.inject(App);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  await app.repository.createMany([
    {
      patientName: "Alice",
      appointmentDate: dt.utc("2024-05-01").toISOString(),
      status: "confirmed",
    },
    {
      patientName: "Bob",
      appointmentDate: dt.utc("2024-06-01").toISOString(),
      status: "pending",
    },
    {
      patientName: "Charlie",
      appointmentDate: dt.utc("2024-07-01").toISOString(),
      status: "confirmed",
    },
    {
      patientName: "David",
      appointmentDate: dt.utc("2024-08-01").toISOString(),
      status: "cancelled",
    },
  ]);

  // Complex: confirmed appointments in June or July
  const confirmedSummer = await app.repository.findMany({
    where: {
      and: [
        { status: { eq: "confirmed" } },
        { appointmentDate: { gte: dt.utc("2024-06-01").toISOString() } },
        { appointmentDate: { lt: dt.utc("2024-08-01").toISOString() } },
      ],
    },
  });
  expect(confirmedSummer).toHaveLength(1);
  expect(confirmedSummer[0].patientName).toBe("Charlie");

  // OR condition with dates
  const earlyOrLate = await app.repository.findMany({
    where: {
      or: [
        { appointmentDate: { lt: dt.utc("2024-06-01").toISOString() } },
        { appointmentDate: { gte: dt.utc("2024-08-01").toISOString() } },
      ],
    },
  });
  expect(earlyOrLate).toHaveLength(2);
  expect(earlyOrLate.map((a) => a.patientName)).toContain("Alice");
  expect(earlyOrLate.map((a) => a.patientName)).toContain("David");
};

// ============================================================================
// testNullDateValues
// ============================================================================

export const testNullDateValues = async (alepha: Alepha) => {
  const Entity = $entity({
    name: "projects",
    schema: z.object({
      id: db.primaryKey(),
      name: z.text(),
      completedAt: z.datetime().optional(),
    }),
  });

  class App {
    repository = $repository(Entity);
  }

  const app = alepha.inject(App);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  await app.repository.createMany([
    {
      name: "Completed Project",
      completedAt: dt.utc("2024-05-15").toISOString(),
    },
    { name: "Ongoing Project" },
  ]);

  // isNull
  const ongoing = await app.repository.findMany({
    where: { completedAt: { isNull: true } },
  });
  expect(ongoing).toHaveLength(1);
  expect(ongoing[0].name).toBe("Ongoing Project");

  // isNotNull
  const completed = await app.repository.findMany({
    where: { completedAt: { isNotNull: true } },
  });
  expect(completed).toHaveLength(1);
  expect(completed[0].name).toBe("Completed Project");
};

// ============================================================================
// testDateEncodingWithNotInArray
// ============================================================================

export const testDateEncodingWithNotInArray = async (alepha: Alepha) => {
  const Entity = $entity({
    name: "events",
    schema: z.object({
      id: db.primaryKey(),
      name: z.text(),
      date: z.datetime(),
    }),
  });

  class App {
    repository = $repository(Entity);
  }

  const app = alepha.inject(App);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  await app.repository.createMany([
    { name: "Event 1", date: dt.utc("2024-01-01").toISOString() },
    { name: "Event 2", date: dt.utc("2024-02-01").toISOString() },
    { name: "Event 3", date: dt.utc("2024-03-01").toISOString() },
    { name: "Event 4", date: dt.utc("2024-04-01").toISOString() },
  ]);

  const excluded = await app.repository.findMany({
    where: {
      date: {
        notInArray: [
          dt.utc("2024-01-01").toISOString(),
          dt.utc("2024-03-01").toISOString(),
        ],
      },
    },
  });
  expect(excluded).toHaveLength(2);
  expect(excluded.map((e) => e.name)).toContain("Event 2");
  expect(excluded.map((e) => e.name)).toContain("Event 4");
};
