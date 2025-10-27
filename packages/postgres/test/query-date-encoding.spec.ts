import { Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { describe, it } from "vitest";
import { $entity } from "../src/descriptors/$entity.ts";
import { $repository } from "../src/descriptors/$repository.ts";
import { pg } from "../src/index.ts";

describe("Query with Date Encoding", () => {
  it("should handle date filters with Dayjs objects", async ({ expect }) => {
    const Entity = $entity({
      name: "events",
      schema: t.object({
        id: pg.primaryKey(),
        name: t.text(),
        eventDate: pg.createdAt(),
        scheduledFor: t.optional(t.datetime()),
      }),
    });

    class App {
      repository = $repository(Entity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    // Create test data
    const event1 = await app.repository.create({
      name: "Past Event",
      scheduledFor: dt.of("2024-01-01").utc(),
    });

    const event2 = await app.repository.create({
      name: "Recent Event",
      scheduledFor: dt.of("2024-06-01").utc(),
    });

    const event3 = await app.repository.create({
      name: "Future Event",
      scheduledFor: dt.of("2025-01-01").utc(),
    });

    // Test 1: Filter with Dayjs object using eq
    const exactMatch = await app.repository.find({
      where: {
        scheduledFor: {
          eq: dt.of("2024-06-01").utc(),
        },
      },
    });

    expect(exactMatch).toHaveLength(1);
    expect(exactMatch[0].name).toBe("Recent Event");

    // Test 2: Filter with Dayjs object using gt (greater than)
    const futureEvents = await app.repository.find({
      where: {
        scheduledFor: {
          gt: dt.of("2024-06-01").utc(),
        },
      },
    });

    expect(futureEvents).toHaveLength(1);
    expect(futureEvents[0].name).toBe("Future Event");

    // Test 3: Filter with Dayjs object using lt (less than)
    const pastEvents = await app.repository.find({
      where: {
        scheduledFor: {
          lt: dt.of("2024-06-01").utc(),
        },
      },
    });

    expect(pastEvents).toHaveLength(1);
    expect(pastEvents[0].name).toBe("Past Event");

    // Test 4: Filter with Dayjs object using gte and lte (range)
    const rangeEvents = await app.repository.find({
      where: {
        and: [
          {
            scheduledFor: {
              gte: dt.of("2024-01-01").utc(),
            },
          },
          {
            scheduledFor: {
              lte: dt.of("2024-12-31").utc(),
            },
          },
        ],
      },
    });

    expect(rangeEvents).toHaveLength(2);
    expect(rangeEvents.map((e) => e.name)).toContain("Past Event");
    expect(rangeEvents.map((e) => e.name)).toContain("Recent Event");

    // Test 5: Filter with Dayjs object using between
    const betweenEvents = await app.repository.find({
      where: {
        eventDate: {
          between: [
            dt.of("2024-01-01").utc(),
            dt.of("2025-12-31").utc(),
          ] as any,
        },
      },
    });

    expect(betweenEvents.length).toBeGreaterThanOrEqual(3);

    // Test 6: Filter with inArray using Dayjs objects
    const specificDates = await app.repository.find({
      where: {
        scheduledFor: {
          inArray: [dt.of("2024-01-01").utc(), dt.of("2025-01-01").utc()],
        },
      },
    });

    expect(specificDates).toHaveLength(2);
    expect(specificDates.map((e) => e.name)).toContain("Past Event");
    expect(specificDates.map((e) => e.name)).toContain("Future Event");

    // Test 7: Direct value (not using operator object)
    const directMatch = await app.repository.find({
      where: {
        scheduledFor: dt.of("2024-06-01").utc(),
      },
    });

    expect(directMatch).toHaveLength(1);
    expect(directMatch[0].name).toBe("Recent Event");

    await alepha.stop();
  });

  it("should handle mixed date formats (string and Dayjs)", async ({
    expect,
  }) => {
    const Entity = $entity({
      name: "tasks",
      schema: t.object({
        id: pg.primaryKey(),
        title: t.text(),
        dueDate: t.optional(t.datetime()),
      }),
    });

    class App {
      repository = $repository(Entity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    // Create test data
    await app.repository.create({
      title: "Task 1",
      dueDate: dt.of("2024-03-15").utc(),
    });

    await app.repository.create({
      title: "Task 2",
      dueDate: dt.of("2024-06-20").utc(),
    });

    // Test with Dayjs object
    const withDayjs = await app.repository.find({
      where: {
        dueDate: {
          gte: dt.of("2024-06-01").utc(),
        },
      },
    });

    expect(withDayjs).toHaveLength(1);
    expect(withDayjs[0].title).toBe("Task 2");

    // Test with ISO string (should also work)
    const withString = await app.repository.find({
      where: {
        dueDate: {
          gte: "2024-06-01T00:00:00.000Z" as any,
        },
      },
    });

    expect(withString).toHaveLength(1);
    expect(withString[0].title).toBe("Task 2");

    await alepha.stop();
  });

  it("should handle date comparisons in complex queries", async ({
    expect,
  }) => {
    const Entity = $entity({
      name: "appointments",
      schema: t.object({
        id: pg.primaryKey(),
        patientName: t.text(),
        appointmentDate: t.datetime(),
        status: t.text(),
      }),
    });

    class App {
      repository = $repository(Entity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    // Create test data
    await app.repository.createMany([
      {
        patientName: "Alice",
        appointmentDate: dt.of("2024-05-01").utc(),
        status: "confirmed",
      },
      {
        patientName: "Bob",
        appointmentDate: dt.of("2024-06-01").utc(),
        status: "pending",
      },
      {
        patientName: "Charlie",
        appointmentDate: dt.of("2024-07-01").utc(),
        status: "confirmed",
      },
      {
        patientName: "David",
        appointmentDate: dt.of("2024-08-01").utc(),
        status: "cancelled",
      },
    ]);

    // Complex query: Find confirmed appointments in June or July
    const confirmedSummer = await app.repository.find({
      where: {
        and: [
          {
            status: { eq: "confirmed" },
          },
          {
            appointmentDate: {
              gte: dt.of("2024-06-01").utc(),
            },
          },
          {
            appointmentDate: {
              lt: dt.of("2024-08-01").utc(),
            },
          },
        ],
      },
    });

    expect(confirmedSummer).toHaveLength(1);
    expect(confirmedSummer[0].patientName).toBe("Charlie");

    // Test OR condition with dates
    const earlyOrLate = await app.repository.find({
      where: {
        or: [
          {
            appointmentDate: {
              lt: dt.of("2024-06-01").utc(),
            },
          },
          {
            appointmentDate: {
              gte: dt.of("2024-08-01").utc(),
            },
          },
        ],
      },
    });

    expect(earlyOrLate).toHaveLength(2);
    expect(earlyOrLate.map((a) => a.patientName)).toContain("Alice");
    expect(earlyOrLate.map((a) => a.patientName)).toContain("David");

    await alepha.stop();
  });

  it("should handle null date values", async ({ expect }) => {
    const Entity = $entity({
      name: "projects",
      schema: t.object({
        id: pg.primaryKey(),
        name: t.text(),
        completedAt: t.optional(t.datetime()),
      }),
    });

    class App {
      repository = $repository(Entity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    // Create test data
    await app.repository.createMany([
      {
        name: "Completed Project",
        completedAt: dt.of("2024-05-15").utc(),
      },
      {
        name: "Ongoing Project",
      },
    ]);

    // Test isNull filter
    const ongoing = await app.repository.find({
      where: {
        completedAt: {
          isNull: true,
        },
      },
    });

    expect(ongoing).toHaveLength(1);
    expect(ongoing[0].name).toBe("Ongoing Project");

    // Test isNotNull filter
    const completed = await app.repository.find({
      where: {
        completedAt: {
          isNotNull: true,
        },
      },
    });

    expect(completed).toHaveLength(1);
    expect(completed[0].name).toBe("Completed Project");

    await alepha.stop();
  });

  it("should handle date encoding with notInArray", async ({ expect }) => {
    const Entity = $entity({
      name: "events",
      schema: t.object({
        id: pg.primaryKey(),
        name: t.text(),
        date: t.datetime(),
      }),
    });

    class App {
      repository = $repository(Entity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    await app.repository.createMany([
      { name: "Event 1", date: dt.of("2024-01-01").utc() },
      { name: "Event 2", date: dt.of("2024-02-01").utc() },
      { name: "Event 3", date: dt.of("2024-03-01").utc() },
      { name: "Event 4", date: dt.of("2024-04-01").utc() },
    ]);

    const excluded = await app.repository.find({
      where: {
        date: {
          notInArray: [dt.of("2024-01-01").utc(), dt.of("2024-03-01").utc()],
        },
      },
    });

    expect(excluded).toHaveLength(2);
    expect(excluded.map((e) => e.name)).toContain("Event 2");
    expect(excluded.map((e) => e.name)).toContain("Event 4");

    await alepha.stop();
  });
});
