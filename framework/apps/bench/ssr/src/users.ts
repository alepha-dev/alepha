/**
 * The users both servers render: 100 of them, as the API bench's list.
 */
export const USERS = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `User number ${i + 1}`,
  email: `user${i + 1}@example.com`,
  age: 20 + (i % 50),
}));

export type User = (typeof USERS)[number];
