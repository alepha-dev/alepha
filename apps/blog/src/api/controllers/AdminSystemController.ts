import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { postEntity } from "../entities/postEntity.ts";
import { CategoryService } from "../services/CategoryService.ts";
import { CommentService } from "../services/CommentService.ts";
import { PostService } from "../services/PostService.ts";

const SEED_CATEGORIES = [
  {
    name: "Engineering",
    slug: "engineering",
    description:
      "Deep dives into software engineering practices, patterns, and principles.",
  },
  {
    name: "Architecture",
    slug: "architecture",
    description:
      "System design, distributed systems, and architectural decision records.",
  },
  {
    name: "DevOps",
    slug: "devops",
    description:
      "CI/CD pipelines, infrastructure as code, and deployment strategies.",
  },
  {
    name: "Design",
    slug: "design",
    description: "UI/UX patterns, CSS techniques, and frontend design systems.",
  },
  {
    name: "Tutorials",
    slug: "tutorials",
    description: "Step-by-step guides for building real-world applications.",
  },
];

const SEED_AUTHORS = [
  { firstName: "Alice", lastName: "Chen", email: "alice@alepha.blog" },
  { firstName: "Bob", lastName: "Martinez", email: "bob@alepha.blog" },
  { firstName: "Carol", lastName: "Williams", email: "carol@alepha.blog" },
  { firstName: "David", lastName: "Kim", email: "david@alepha.blog" },
  { firstName: "Eva", lastName: "Novak", email: "eva@alepha.blog" },
];

const SEED_POSTS = [
  {
    title: "Building Type-Safe APIs with Alepha",
    excerpt:
      "A deep dive into end-to-end type safety using schema-first API design and code generation.",
    tags: ["typescript", "api", "alepha"],
    category: 0,
    author: 0,
  },
  {
    title: "Understanding TypeScript Generics in Practice",
    excerpt:
      "Practical patterns for leveraging TypeScript generics to write flexible, reusable code.",
    tags: ["typescript", "generics"],
    category: 0,
    author: 1,
  },
  {
    title: "The Future of Server-Side Rendering",
    excerpt:
      "How streaming, partial hydration, and RSC are reshaping web application architecture.",
    tags: ["react", "ssr", "architecture"],
    category: 1,
    author: 2,
  },
  {
    title: "Dependency Injection Without the Boilerplate",
    excerpt:
      "Clean dependency management with zero decorators and minimal ceremony.",
    tags: ["typescript", "di", "patterns"],
    category: 0,
    author: 3,
  },
  {
    title: "Writing Better Tests: Beyond Unit Testing",
    excerpt:
      "Integration tests, contract tests, and property-based testing for real-world confidence.",
    tags: ["testing", "node", "quality"],
    category: 4,
    author: 4,
  },
  {
    title: "CSS Variables and the Modern Theming Approach",
    excerpt:
      "Moving beyond preprocessors with native CSS custom properties and dynamic theming.",
    tags: ["css", "theming", "design"],
    category: 3,
    author: 0,
  },
  {
    title: "Monorepo Strategies for Growing Teams",
    excerpt:
      "Organizing large codebases with workspaces, shared tooling, and incremental builds.",
    tags: ["tooling", "monorepo", "dx"],
    category: 0,
    author: 1,
  },
  {
    title: "Real-Time Data with WebSockets and SSE",
    excerpt:
      "Choosing the right protocol for live updates and building resilient connections.",
    tags: ["node", "websocket", "realtime"],
    category: 0,
    author: 2,
  },
  {
    title: "Database Migrations Done Right",
    excerpt:
      "Version-controlled, reversible schema changes with zero-downtime deployments.",
    tags: ["database", "migrations", "devops"],
    category: 2,
    author: 3,
  },
  {
    title: "Authentication Patterns for Modern Web Apps",
    excerpt: "OAuth 2.0, JWTs, sessions, and passwordless — when to use what.",
    tags: ["security", "auth", "api"],
    category: 0,
    author: 4,
  },
  {
    title: "Performance Profiling in Node.js",
    excerpt:
      "Finding bottlenecks with flame graphs, heap snapshots, and tracing.",
    tags: ["node", "performance", "profiling"],
    category: 0,
    author: 0,
  },
  {
    title: "React Server Components Explained",
    excerpt:
      "Understanding the mental model behind RSC and when they actually help.",
    tags: ["react", "rsc", "architecture"],
    category: 1,
    author: 1,
  },
  {
    title: "Building CLI Tools with TypeScript",
    excerpt:
      "From argument parsing to beautiful output — building developer tools that spark joy.",
    tags: ["typescript", "cli", "tooling"],
    category: 4,
    author: 2,
  },
  {
    title: "GraphQL vs REST: A Practical Comparison",
    excerpt:
      "Beyond the hype: choosing the right API style for your specific use case.",
    tags: ["graphql", "rest", "api"],
    category: 1,
    author: 3,
  },
  {
    title: "Container Orchestration for Developers",
    excerpt:
      "Docker, Kubernetes, and the developer experience — what you actually need to know.",
    tags: ["devops", "docker", "kubernetes"],
    category: 2,
    author: 4,
  },
  {
    title: "Effective Code Review Practices",
    excerpt:
      "Techniques for giving actionable, kind, and efficient code review feedback.",
    tags: ["process", "review", "teamwork"],
    category: 0,
    author: 0,
  },
  {
    title: "Event-Driven Architecture in Practice",
    excerpt:
      "Decoupling services with events, sagas, and eventual consistency patterns.",
    tags: ["architecture", "events", "patterns"],
    category: 1,
    author: 1,
  },
  {
    title: "Securing Your API: Beyond Basic Auth",
    excerpt:
      "Rate limiting, input validation, CORS, and the OWASP top 10 in practice.",
    tags: ["security", "api", "owasp"],
    category: 0,
    author: 2,
  },
  {
    title: "State Management in 2026",
    excerpt:
      "Signals, atoms, stores, and the convergence of reactive state libraries.",
    tags: ["react", "state", "signals"],
    category: 3,
    author: 3,
  },
  {
    title: "The Art of Technical Writing",
    excerpt: "Writing documentation that developers actually want to read.",
    tags: ["writing", "docs", "communication"],
    category: 4,
    author: 4,
  },
  {
    title: "Micro-Frontends: When and How",
    excerpt:
      "Splitting monoliths into independently deployable frontends with shared design systems.",
    tags: ["architecture", "micro-frontends", "react"],
    category: 1,
    author: 0,
  },
  {
    title: "Zero-Downtime Deployments in Practice",
    excerpt:
      "Blue-green, canary, and rolling deployments without dropping a single request.",
    tags: ["devops", "deployment", "ci-cd"],
    category: 2,
    author: 1,
  },
  {
    title: "Type-Level Programming in TypeScript",
    excerpt:
      "Conditional types, mapped types, and template literals for compile-time guarantees.",
    tags: ["typescript", "types", "advanced"],
    category: 0,
    author: 2,
  },
  {
    title: "The Pragmatic Guide to Web Accessibility",
    excerpt:
      "Building inclusive interfaces that work for everyone, from ARIA to focus management.",
    tags: ["a11y", "html", "ux"],
    category: 3,
    author: 3,
  },
  {
    title: "Building Resilient Distributed Systems",
    excerpt:
      "Designing systems that survive network partitions, latency spikes, and hardware failures.",
    tags: ["architecture", "distributed", "resilience"],
    category: 1,
    author: 4,
  },
  {
    title: "Modern CSS Layout Techniques",
    excerpt:
      "Subgrid, container queries, and the new layout primitives that change everything.",
    tags: ["css", "layout", "subgrid"],
    category: 3,
    author: 0,
  },
  {
    title: "API Versioning Strategies That Scale",
    excerpt:
      "URL-based, header-based, and content negotiation strategies for evolving APIs gracefully.",
    tags: ["api", "versioning", "rest"],
    category: 0,
    author: 1,
  },
  {
    title: "Observability Beyond Logging",
    excerpt:
      "Traces, metrics, and structured events — going beyond console.log in production.",
    tags: ["observability", "devops", "monitoring"],
    category: 2,
    author: 2,
  },
  {
    title: "Edge Computing for Web Developers",
    excerpt:
      "Running compute at the edge: benefits, trade-offs, and when it actually makes sense.",
    tags: ["edge", "performance", "serverless"],
    category: 0,
    author: 3,
  },
  {
    title: "The Psychology of Developer Experience",
    excerpt:
      "How great tools reduce friction, build trust, and make developers genuinely productive.",
    tags: ["dx", "tooling", "process"],
    category: 4,
    author: 4,
  },
];

const SEED_COMMENTS = [
  "Great article! Really helped me understand the concepts better.",
  "I've been looking for exactly this kind of deep dive. Thanks for sharing.",
  "The code examples are super clear. Would love a follow-up on advanced patterns.",
  "This changed how I think about the problem. Bookmarked for future reference.",
  "Solid write-up. One thing I'd add is error handling in production scenarios.",
  "Finally someone explains this without all the jargon. Much appreciated.",
  "We adopted this pattern at our company and it's been a game changer.",
  "Interesting perspective. Have you considered the trade-offs with approach X?",
  "The diagrams really help. Could you cover the migration path from legacy systems?",
  "Been doing this for years but never articulated it this well. Sharing with my team.",
];

function generateContent(excerpt: string, title: string): string {
  const sections = [
    `<h2>Introduction</h2>\n<p>${excerpt}</p>\n<p>In this article, we'll explore the key concepts behind ${title.toLowerCase()} and how they apply to modern software development. Whether you're building a startup or working at scale, these patterns will help you write better, more maintainable code.</p>`,
    `<h2>The Problem</h2>\n<p>Most developers encounter this challenge early in their career: the gap between what's theoretically possible and what's practically achievable. The industry has evolved significantly, but many teams still struggle with outdated approaches that create unnecessary friction.</p>\n<p>Let's examine why this matters and what we can do about it.</p>`,
    `<h2>A Better Approach</h2>\n<p>The key insight is that simplicity and power aren't mutually exclusive. By embracing the right abstractions at the right level, we can build systems that are both easy to understand and capable of handling real-world complexity.</p>\n<blockquote>The best code is the code you don't have to write. Every line of code is a liability — make each one count.</blockquote>\n<p>Here's a practical example of how this works in practice:</p>\n<pre><code>// Example implementation\nconst result = await service.process(input);\nconsole.log(result);</code></pre>`,
    `<h3>Key Considerations</h3>\n<ul>\n<li>Start with the simplest solution that could work</li>\n<li>Measure before optimizing — intuition is often wrong</li>\n<li>Design for change, not for permanence</li>\n<li>Automate what's repeatable, document what isn't</li>\n</ul>`,
    `<h2>Putting It All Together</h2>\n<p>When you combine these techniques, the result is a system that's both robust and maintainable. The initial investment in getting the foundation right pays dividends over the lifetime of the project.</p>\n<p>Teams that adopt these practices consistently report faster iteration cycles, fewer production incidents, and higher developer satisfaction.</p>`,
    `<h2>Conclusion</h2>\n<p>The patterns we've discussed aren't revolutionary — they're evolutionary. They represent the collective wisdom of thousands of engineers who've wrestled with similar problems. The real skill is knowing when to apply them and when to keep things simple.</p>\n<p>Start small, measure the impact, and iterate. That's the path to building software that stands the test of time.</p>`,
  ];
  return sections.join("\n");
}

export class AdminSystemController {
  protected readonly url = "/admin/system";
  protected readonly group = "admin:system";
  protected readonly postService = $inject(PostService);
  protected readonly categoryService = $inject(CategoryService);
  protected readonly commentService = $inject(CommentService);
  protected readonly userRepo = $repository(users);
  protected readonly postRepo = $repository(postEntity);

  /**
   * POST /admin/system/seed — Populate database with sample data.
   */
  public readonly seed = $action({
    method: "POST",
    path: `${this.url}/seed`,
    group: this.group,
    use: [$secure()],
    description: "Seed database with sample blog data",
    schema: {
      response: okSchema,
    },
    handler: async () => {
      // Idempotency: skip if already seeded
      const existing = await this.categoryService.findBySlug("engineering");
      if (existing) {
        return { ok: true as const };
      }

      // 1. Create categories
      const categoryIds: string[] = [];
      for (const cat of SEED_CATEGORIES) {
        const created = await this.categoryService.create(cat);
        categoryIds.push(created.id);
      }

      // 2. Create authors
      const authorIds: string[] = [];
      for (const author of SEED_AUTHORS) {
        const created = await this.userRepo.create({
          ...author,
          roles: ["user"],
          enabled: true,
          emailVerified: true,
        });
        authorIds.push(created.id);
      }

      // 3. Create posts
      const postIds: string[] = [];
      for (let i = 0; i < SEED_POSTS.length; i++) {
        const seed = SEED_POSTS[i];
        const authorId = authorIds[seed.author];
        const categoryId = categoryIds[seed.category];
        const content = generateContent(seed.excerpt, seed.title);

        const post = await this.postService.create(
          {
            title: seed.title,
            content,
            excerpt: seed.excerpt,
            tags: seed.tags,
            categoryId,
            status: "published",
            featured: i < 3,
          },
          authorId,
        );

        // Set staggered publish dates and random view counts
        const daysAgo = i * 3;
        const publishedAt = new Date(
          Date.now() - daysAgo * 24 * 60 * 60 * 1000,
        ).toISOString();
        const viewCount = Math.floor(Math.random() * 500);
        await this.postRepo.updateOne(
          { id: { eq: post.id } },
          { publishedAt, viewCount },
        );

        postIds.push(post.id);
      }

      // 4. Create comments (2 per post on average)
      for (const postId of postIds) {
        const numComments = 1 + Math.floor(Math.random() * 3);
        for (let j = 0; j < numComments; j++) {
          const commentAuthorId =
            authorIds[Math.floor(Math.random() * authorIds.length)];
          const commentText =
            SEED_COMMENTS[Math.floor(Math.random() * SEED_COMMENTS.length)];

          const comment = await this.commentService.create(
            postId,
            commentAuthorId,
            { content: commentText },
          );
          await this.commentService.updateStatus(comment.id, "approved");
        }
      }

      return { ok: true as const };
    },
  });
}
