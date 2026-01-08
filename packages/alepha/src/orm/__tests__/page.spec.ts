import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { $repository } from "../index.ts";
import type { InsertUserEntity } from "./fixtures/userEntitySchema.ts";
import { userEntity } from "./fixtures/userEntitySchema.ts";

class App {
  users = $repository(userEntity);
}

const testPagination = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  // Create test data - 25 users
  const users: InsertUserEntity[] = [];
  for (let i = 1; i <= 25; i++) {
    users.push({
      name: `User ${i}`,
      profile: { age: 20 + i },
      role: i % 2 === 0 ? "admin" : "user",
    });
  }

  for (const user of users) {
    await app.users.create(user);
  }

  // Test 1: First page without count
  const page1 = await app.users.paginate({ page: 0, size: 10 });

  expect(page1.content.length).toBe(10);
  expect(page1.page.number).toBe(0);
  expect(page1.page.size).toBe(10);
  expect(page1.page.offset).toBe(0);
  expect(page1.page.numberOfElements).toBe(10);
  expect(page1.page.isEmpty).toBe(false);
  expect(page1.page.isFirst).toBe(true);
  expect(page1.page.isLast).toBe(false);
  expect(page1.page.totalElements).toBeUndefined();
  expect(page1.page.totalPages).toBeUndefined();

  // Test 2: First page with count
  const page2 = await app.users.paginate(
    { page: 0, size: 10 },
    {},
    { count: true },
  );

  expect(page2.content.length).toBe(10);
  expect(page2.page.number).toBe(0);
  expect(page2.page.size).toBe(10);
  expect(page2.page.offset).toBe(0);
  expect(page2.page.numberOfElements).toBe(10);
  expect(page2.page.isEmpty).toBe(false);
  expect(page2.page.isFirst).toBe(true);
  expect(page2.page.isLast).toBe(false);
  expect(page2.page.totalElements).toBe(25);
  expect(page2.page.totalPages).toBe(3);

  // Test 3: Middle page with count
  const page3 = await app.users.paginate(
    { page: 1, size: 10 },
    {},
    { count: true },
  );

  expect(page3.content.length).toBe(10);
  expect(page3.page.number).toBe(1);
  expect(page3.page.size).toBe(10);
  expect(page3.page.offset).toBe(10);
  expect(page3.page.numberOfElements).toBe(10);
  expect(page3.page.isEmpty).toBe(false);
  expect(page3.page.isFirst).toBe(false);
  expect(page3.page.isLast).toBe(false);
  expect(page3.page.totalElements).toBe(25);
  expect(page3.page.totalPages).toBe(3);

  // Test 4: Last page with count
  const page4 = await app.users.paginate(
    { page: 2, size: 10 },
    {},
    { count: true },
  );

  expect(page4.content.length).toBe(5);
  expect(page4.page.number).toBe(2);
  expect(page4.page.size).toBe(10);
  expect(page4.page.offset).toBe(20);
  expect(page4.page.numberOfElements).toBe(5);
  expect(page4.page.isEmpty).toBe(false);
  expect(page4.page.isFirst).toBe(false);
  expect(page4.page.isLast).toBe(true);
  expect(page4.page.totalElements).toBe(25);
  expect(page4.page.totalPages).toBe(3);

  // Test 5: Empty page (beyond last page)
  const page5 = await app.users.paginate(
    { page: 3, size: 10 },
    {},
    { count: true },
  );

  expect(page5.content.length).toBe(0);
  expect(page5.page.number).toBe(3);
  expect(page5.page.size).toBe(10);
  expect(page5.page.offset).toBe(30);
  expect(page5.page.numberOfElements).toBe(0);
  expect(page5.page.isEmpty).toBe(true);
  expect(page5.page.isFirst).toBe(false);
  expect(page5.page.isLast).toBe(true);
  expect(page5.page.totalElements).toBe(25);
  expect(page5.page.totalPages).toBe(3);

  // Test 6: Custom page size
  const page6 = await app.users.paginate(
    { page: 0, size: 7 },
    {},
    { count: true },
  );

  expect(page6.content.length).toBe(7);
  expect(page6.page.number).toBe(0);
  expect(page6.page.size).toBe(7);
  expect(page6.page.offset).toBe(0);
  expect(page6.page.numberOfElements).toBe(7);
  expect(page6.page.isEmpty).toBe(false);
  expect(page6.page.isFirst).toBe(true);
  expect(page6.page.isLast).toBe(false);
  expect(page6.page.totalElements).toBe(25);
  expect(page6.page.totalPages).toBe(4); // Math.ceil(25 / 7) = 4

  // Test 7: Page size equals total items
  const page7 = await app.users.paginate(
    { page: 0, size: 25 },
    {},
    { count: true },
  );

  expect(page7.content.length).toBe(25);
  expect(page7.page.number).toBe(0);
  expect(page7.page.size).toBe(25);
  expect(page7.page.offset).toBe(0);
  expect(page7.page.numberOfElements).toBe(25);
  expect(page7.page.isEmpty).toBe(false);
  expect(page7.page.isFirst).toBe(true);
  expect(page7.page.isLast).toBe(true);
  expect(page7.page.totalElements).toBe(25);
  expect(page7.page.totalPages).toBe(1);

  // Test 8: Page size greater than total items
  const page8 = await app.users.paginate(
    { page: 0, size: 50 },
    {},
    { count: true },
  );

  expect(page8.content.length).toBe(25);
  expect(page8.page.number).toBe(0);
  expect(page8.page.size).toBe(50);
  expect(page8.page.offset).toBe(0);
  expect(page8.page.numberOfElements).toBe(25);
  expect(page8.page.isEmpty).toBe(false);
  expect(page8.page.isFirst).toBe(true);
  expect(page8.page.isLast).toBe(true);
  expect(page8.page.totalElements).toBe(25);
  expect(page8.page.totalPages).toBe(1); // Math.ceil(25 / 50) = 1

  // Test 9: Empty table
  await app.users.clear({ force: true });
  const page9 = await app.users.paginate(
    { page: 0, size: 10 },
    {},
    { count: true },
  );

  expect(page9.content.length).toBe(0);
  expect(page9.page.number).toBe(0);
  expect(page9.page.size).toBe(10);
  expect(page9.page.offset).toBe(0);
  expect(page9.page.numberOfElements).toBe(0);
  expect(page9.page.isEmpty).toBe(true);
  expect(page9.page.isFirst).toBe(true);
  expect(page9.page.isLast).toBe(true);
  expect(page9.page.totalElements).toBe(0);
  expect(page9.page.totalPages).toBe(0); // Math.ceil(0 / 10) = 0

  // Test 10: Single item
  await app.users.create({
    name: "Single User",
    profile: { age: 25 },
    role: "user",
  });

  const page10 = await app.users.paginate(
    { page: 0, size: 10 },
    {},
    { count: true },
  );

  expect(page10.content.length).toBe(1);
  expect(page10.page.number).toBe(0);
  expect(page10.page.size).toBe(10);
  expect(page10.page.offset).toBe(0);
  expect(page10.page.numberOfElements).toBe(1);
  expect(page10.page.isEmpty).toBe(false);
  expect(page10.page.isFirst).toBe(true);
  expect(page10.page.isLast).toBe(true);
  expect(page10.page.totalElements).toBe(1);
  expect(page10.page.totalPages).toBe(1); // Math.ceil(1 / 10) = 1

  // Test 11: Pagination with where clause
  await app.users.clear({ force: true });
  for (let i = 1; i <= 20; i++) {
    await app.users.create({
      name: `User ${i}`,
      profile: { age: 20 + i },
      role: i % 2 === 0 ? "admin" : "user",
    });
  }

  const page11 = await app.users.paginate(
    { page: 0, size: 5 },
    { where: { role: "admin" } },
    { count: true },
  );

  expect(page11.content.length).toBe(5);
  expect(page11.page.number).toBe(0);
  expect(page11.page.size).toBe(5);
  expect(page11.page.offset).toBe(0);
  expect(page11.page.numberOfElements).toBe(5);
  expect(page11.page.isEmpty).toBe(false);
  expect(page11.page.isFirst).toBe(true);
  expect(page11.page.isLast).toBe(false);
  expect(page11.page.totalElements).toBe(10); // Only admin users
  expect(page11.page.totalPages).toBe(2); // Math.ceil(10 / 5) = 2

  // Test 12: Last page of filtered results
  const page12 = await app.users.paginate(
    { page: 1, size: 5 },
    { where: { role: "admin" } },
    { count: true },
  );

  expect(page12.content.length).toBe(5);
  expect(page12.page.number).toBe(1);
  expect(page12.page.size).toBe(5);
  expect(page12.page.offset).toBe(5);
  expect(page12.page.numberOfElements).toBe(5);
  expect(page12.page.isEmpty).toBe(false);
  expect(page12.page.isFirst).toBe(false);
  expect(page12.page.isLast).toBe(true);
  expect(page12.page.totalElements).toBe(10);
  expect(page12.page.totalPages).toBe(2);

  // Test 13: Default pagination (no params)
  const page13 = await app.users.paginate();

  expect(page13.content.length).toBe(10); // Default size is 10
  expect(page13.page.number).toBe(0);
  expect(page13.page.size).toBe(10);
  expect(page13.page.offset).toBe(0);
  expect(page13.page.numberOfElements).toBe(10);
  expect(page13.page.isEmpty).toBe(false);
  expect(page13.page.isFirst).toBe(true);
  expect(page13.page.isLast).toBe(false);

  // Clean up
  await app.users.clear({ force: true });
};

describe("Page Schema and Pagination", () => {
  it("should return correct pagination metadata (postgres)", async () => {
    await testPagination(Alepha.create());
  });

  it("should return correct pagination metadata (sqlite)", async () => {
    await testPagination(
      Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
        },
      }),
    );
  });
});
