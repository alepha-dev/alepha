import { Alepha, t } from "@alepha/core";
import { describe, expect, test } from "vitest";
import { $entity, $repository, pg } from "../src";

describe("Relations", () => {
  // Define entities used across tests
  const users = $entity({
    name: "users",
    schema: t.object({
      id: pg.primaryKey(),
      name: t.text(),
    }),
  });

  const profiles = $entity({
    name: "profiles",
    schema: t.object({
      id: pg.primaryKey(),
      userId: pg.ref(t.int(), () => users.id),
      bio: t.text(),
    }),
  });

  const posts = $entity({
    name: "posts",
    schema: t.object({
      id: pg.primaryKey(),
      authorId: pg.ref(t.int(), () => users.id),
      title: t.text(),
      content: t.text(),
    }),
  });

  const comments = $entity({
    name: "comments",
    schema: t.object({
      id: pg.primaryKey(),
      postId: pg.ref(t.int(), () => posts.id),
      authorId: pg.ref(t.int(), () => users.id),
      text: t.text(),
    }),
  });

  const categories = $entity({
    name: "categories",
    schema: t.object({
      id: pg.primaryKey(),
      parentId: pg.ref(t.optional(t.int()), () => categories.id),
      name: t.text(),
    }),
  });

  test("one-to-one relation - user has one profile", async () => {
    class App {
      users = $repository(users, {
        profile: {
          type: "one",
          from: profiles,
          foreignKey: "userId",
        },
      });
      profiles = $repository(profiles);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user and profile
    const user = await app.users.create({ name: "John Doe" });
    const profile = await app.profiles.create({
      userId: user.id,
      bio: "Software Engineer",
    });

    // Load user with profile relation
    const userWithProfile = await app.users.findOne({
      where: { id: user.id },
      with: { profile: true },
    });

    expect(userWithProfile).toEqual({
      ...user,
      profile: {
        id: profile.id,
        userId: user.id,
        bio: "Software Engineer",
      },
    });
  });

  test("one-to-many relation - user has many posts", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user and multiple posts
    const user = await app.users.create({ name: "Jane Smith" });
    const post1 = await app.posts.create({
      authorId: user.id,
      title: "First Post",
      content: "Hello World",
    });
    const post2 = await app.posts.create({
      authorId: user.id,
      title: "Second Post",
      content: "More content",
    });

    // Load user with posts relation
    const userWithPosts = await app.users.findOne({
      where: { id: user.id },
      with: { posts: true },
    });

    expect(userWithPosts).toEqual({
      ...user,
      posts: [
        {
          id: post1.id,
          authorId: user.id,
          title: "First Post",
          content: "Hello World",
        },
        {
          id: post2.id,
          authorId: user.id,
          title: "Second Post",
          content: "More content",
        },
      ],
    });
  });

  test("inverse relation - post belongs to user", async () => {
    class App {
      users = $repository(users);
      posts = $repository(posts, {
        author: {
          type: "inverse",
          from: users,
          foreignKey: "authorId",
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create user and post
    const user = await app.users.create({ name: "Bob Johnson" });
    const post = await app.posts.create({
      authorId: user.id,
      title: "Test Post",
      content: "Testing inverse relations",
    });

    // Load post with author relation
    const postWithAuthor = await app.posts.findOne({
      where: { id: post.id },
      with: { author: true },
    });

    expect(postWithAuthor).toEqual({
      ...post,
      author: {
        id: user.id,
        name: "Bob Johnson",
      },
    });
  });

  test("multiple relations - user has posts and profile", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
        profile: {
          type: "one",
          from: profiles,
          foreignKey: "userId",
        },
      });
      posts = $repository(posts);
      profiles = $repository(profiles);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Alice Williams" });
    const profile = await app.profiles.create({
      userId: user.id,
      bio: "Designer",
    });
    const post = await app.posts.create({
      authorId: user.id,
      title: "Design Tips",
      content: "Some tips",
    });

    // Load multiple relations at once
    const userWithRelations = await app.users.findOne({
      where: { id: user.id },
      with: { posts: true, profile: true },
    });

    expect(userWithRelations).toEqual({
      ...user,
      posts: [
        {
          id: post.id,
          authorId: user.id,
          title: "Design Tips",
          content: "Some tips",
        },
      ],
      profile: {
        id: profile.id,
        userId: user.id,
        bio: "Designer",
      },
    });
  });

  test("self-referential relation - categories with parent/children", async () => {
    class App {
      categories = $repository(categories, {
        parent: {
          type: "inverse",
          from: categories,
          foreignKey: "parentId",
        },
        children: {
          type: "many",
          from: categories,
          foreignKey: "parentId",
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create parent category
    const parent = await app.categories.create({ name: "Electronics" });

    // Create child categories
    const child1 = await app.categories.create({
      name: "Laptops",
      parentId: parent.id,
    });
    const child2 = await app.categories.create({
      name: "Phones",
      parentId: parent.id,
    });

    // Load parent with children
    const parentWithChildren = await app.categories.findOne({
      where: { id: parent.id },
      with: { children: true },
    });

    expect(parentWithChildren).toEqual({
      ...parent,
      children: [
        { id: child1.id, parentId: parent.id, name: "Laptops" },
        { id: child2.id, parentId: parent.id, name: "Phones" },
      ],
    });

    // Load child with parent
    const childWithParent = await app.categories.findOne({
      where: { id: child1.id },
      with: { parent: true },
    });

    expect(childWithParent).toEqual({
      ...child1,
      parent: { id: parent.id, name: "Electronics" },
    });
  });

  test("load with find - user.find with include relations", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user1 = await app.users.create({ name: "David Lee" });
    const user2 = await app.users.create({ name: "Emma Wilson" });

    await app.posts.create({
      authorId: user1.id,
      title: "Post 1",
      content: "Content 1",
    });
    await app.posts.create({
      authorId: user1.id,
      title: "Post 2",
      content: "Content 2",
    });
    await app.posts.create({
      authorId: user2.id,
      title: "Post 3",
      content: "Content 3",
    });

    // Find users with posts included
    const usersWithPosts = (await app.users.find({
      where: { name: "David Lee" },
      with: { posts: true },
    })) as any;

    expect(usersWithPosts).toHaveLength(1);
    expect(usersWithPosts[0].posts).toHaveLength(2);
    expect(usersWithPosts[0]).toMatchObject({
      id: user1.id,
      name: "David Lee",
      posts: expect.arrayContaining([
        expect.objectContaining({ title: "Post 1" }),
        expect.objectContaining({ title: "Post 2" }),
      ]),
    });
  });

  test("load with findById - include relations in findById", async () => {
    class App {
      users = $repository(users, {
        profile: {
          type: "one",
          from: profiles,
          foreignKey: "userId",
        },
      });
      profiles = $repository(profiles);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Frank Miller" });
    await app.profiles.create({
      userId: user.id,
      bio: "Writer",
    });

    // Find by ID with relation included
    const userWithProfile = await app.users.findById(user.id, {
      with: { profile: true },
    });

    expect(userWithProfile).toMatchObject({
      id: user.id,
      name: "Frank Miller",
      profile: expect.objectContaining({
        userId: user.id,
        bio: "Writer",
      }),
    });
  });

  test("empty relations - user has no posts", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Grace Hopper" });

    // Load relation that doesn't exist
    const userWithPosts = await app.users.findOne({
      where: { id: user.id },
      with: { posts: true },
    });

    expect(userWithPosts).toEqual({
      ...user,
      posts: [],
    });
  });

  test("load with pagination - paginate with relations", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create multiple users with posts
    for (let i = 1; i <= 5; i++) {
      const user = await app.users.create({ name: `User ${i}` });
      await app.posts.create({
        authorId: user.id,
        title: `Post ${i}`,
        content: `Content ${i}`,
      });
    }

    // Paginate users with posts included
    const page = (await app.users.paginate(
      { page: 0, size: 2 },
      { with: { posts: true } },
    )) as any;

    expect(page.content).toHaveLength(2);
    expect(page.content[0].posts).toBeDefined();
    expect(page.can.next).toBe(true);
  });

  test("bidirectional relations - user <-> posts", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts, {
        author: {
          type: "inverse",
          from: users,
          foreignKey: "authorId",
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Isaac Newton" });
    const post = await app.posts.create({
      authorId: user.id,
      title: "Physics",
      content: "Laws of Motion",
    });

    // Load from both directions
    const userWithPosts = (await app.users.findOne({
      where: { id: user.id },
      with: { posts: true },
    })) as any;
    const postWithAuthor = (await app.posts.findOne({
      where: { id: post.id },
      with: { author: true },
    })) as any;

    expect(userWithPosts.posts[0].id).toBe(post.id);
    expect(postWithAuthor.author.id).toBe(user.id);
  });

  test("load with where clause - filter related entities", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Julia Roberts" });
    await app.posts.create({
      authorId: user.id,
      title: "First",
      content: "Content",
    });
    await app.posts.create({
      authorId: user.id,
      title: "Second",
      content: "Content",
    });

    // Load posts with a filter
    const userWithFilteredPosts = await app.users.findOne({
      where: { id: user.id },
      with: {
        posts: {
          where: { title: { eq: "First" } },
        },
      },
    });

    expect(userWithFilteredPosts.posts).toHaveLength(1);
    expect(userWithFilteredPosts.posts![0].title).toBe("First");
  });

  test("load with orderBy - sort related entities", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Kevin Hart" });
    await app.posts.create({
      authorId: user.id,
      title: "Zebra",
      content: "Content",
    });
    await app.posts.create({
      authorId: user.id,
      title: "Alpha",
      content: "Content",
    });

    // Load posts sorted by title
    const userWithSortedPosts = await app.users.findOne({
      where: { id: user.id },
      with: {
        posts: {
          orderBy: "title",
        },
      },
    });

    expect(userWithSortedPosts.posts![0].title).toBe("Alpha");
    expect(userWithSortedPosts.posts![1].title).toBe("Zebra");
  });

  test("load with limit - limit related entities", async () => {
    class App {
      users = $repository(users, {
        posts: {
          type: "many",
          from: posts,
          foreignKey: "authorId",
        },
      });
      posts = $repository(posts);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "Laura Palmer" });
    await app.posts.create({
      authorId: user.id,
      title: "Post 1",
      content: "Content",
    });
    await app.posts.create({
      authorId: user.id,
      title: "Post 2",
      content: "Content",
    });
    await app.posts.create({
      authorId: user.id,
      title: "Post 3",
      content: "Content",
    });

    // Load only first 2 posts
    const userWithLimitedPosts = await app.users.findOne({
      where: { id: user.id },
      with: {
        posts: {
          limit: 2,
        },
      },
    });

    expect(userWithLimitedPosts.posts).toHaveLength(2);
  });
});
