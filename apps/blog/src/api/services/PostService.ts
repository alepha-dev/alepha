import { users } from "alepha/api/users";
import { $repository, type Page } from "alepha/orm";
import { categoryEntity } from "../entities/categoryEntity.ts";
import { commentEntity } from "../entities/commentEntity.ts";
import { type PostEntity, postEntity } from "../entities/postEntity.ts";
import type {
  DashboardStats,
  PostCreate,
  PostQuery,
  PostResource,
  PostUpdate,
} from "../schemas/postSchemas.ts";

export class PostService {
  protected readonly repo = $repository(postEntity);
  protected readonly userRepo = $repository(users);
  protected readonly categoryRepo = $repository(categoryEntity);
  protected readonly commentRepo = $repository(commentEntity);

  async findPublished(query: PostQuery): Promise<Page<PostResource>> {
    const where: Record<string, unknown> = { status: { eq: "published" } };

    if (query.categoryId) {
      where.categoryId = { eq: query.categoryId };
    }
    if (query.tag) {
      where.tags = { contains: [query.tag] };
    }
    if (query.authorId) {
      where.authorId = { eq: query.authorId };
    }
    if (query.featured !== undefined) {
      where.featured = { eq: query.featured };
    }
    if (query.search) {
      where.title = { like: `%${query.search}%` };
    }

    const page = await this.repo.paginate(
      query,
      { where, orderBy: [{ column: "publishedAt", direction: "desc" }] },
      { count: true },
    );

    return {
      ...page,
      content: await Promise.all(page.content.map((p) => this.toResource(p))),
    };
  }

  async findAll(query: PostQuery): Promise<Page<PostResource>> {
    const where: Record<string, unknown> = {};

    if (query.status) {
      where.status = { eq: query.status };
    }
    if (query.categoryId) {
      where.categoryId = { eq: query.categoryId };
    }
    if (query.authorId) {
      where.authorId = { eq: query.authorId };
    }
    if (query.search) {
      where.title = { like: `%${query.search}%` };
    }

    const page = await this.repo.paginate(
      query,
      { where, orderBy: [{ column: "createdAt", direction: "desc" }] },
      { count: true },
    );

    return {
      ...page,
      content: await Promise.all(page.content.map((p) => this.toResource(p))),
    };
  }

  async findBySlug(slug: string): Promise<PostResource | undefined> {
    const post = await this.repo.findOne({
      where: { slug: { eq: slug }, status: { eq: "published" } },
    });
    if (!post) return undefined;
    return this.toResource(post);
  }

  async findById(id: string): Promise<PostResource | undefined> {
    const post = await this.repo.findOne({ where: { id: { eq: id } } });
    if (!post) return undefined;
    return this.toResource(post);
  }

  async findFeatured(): Promise<PostResource[]> {
    const posts = await this.repo.findMany({
      where: { status: { eq: "published" }, featured: { eq: true } },
      orderBy: [{ column: "publishedAt", direction: "desc" }],
      limit: 5,
    });
    return Promise.all(posts.map((p) => this.toResource(p)));
  }

  async create(data: PostCreate, authorId: string): Promise<PostResource> {
    const slug = data.slug || this.generateSlug(data.title);
    const post = await this.repo.create({
      ...data,
      slug,
      authorId,
      tags: data.tags || [],
      status: data.status || "draft",
      featured: data.featured || false,
      publishedAt:
        data.status === "published" ? new Date().toISOString() : undefined,
    });
    return this.toResource(post as PostEntity);
  }

  async update(id: string, data: PostUpdate): Promise<PostResource> {
    const updates: Record<string, unknown> = { ...data };

    if (data.status === "published") {
      const existing = await this.repo.findOne({ where: { id: { eq: id } } });
      if (existing && existing.status !== "published") {
        updates.publishedAt = new Date().toISOString();
      }
    }

    const updated = await this.repo.updateOne({ id: { eq: id } }, updates);
    return this.toResource(updated as PostEntity);
  }

  async delete(id: string): Promise<void> {
    await this.commentRepo.deleteMany({ postId: { eq: id } });
    await this.repo.deleteMany({ id: { eq: id } });
  }

  async publish(id: string): Promise<PostResource> {
    return this.update(id, {
      status: "published",
    });
  }

  async incrementViews(id: string): Promise<void> {
    const post = await this.repo.findOne({ where: { id: { eq: id } } });
    if (post) {
      await this.repo.updateOne(
        { id: { eq: id } },
        { viewCount: post.viewCount + 1 },
      );
    }
  }

  async getStats(): Promise<DashboardStats> {
    const allPosts = await this.repo.findMany({});
    const published = allPosts.filter((p) => p.status === "published");
    const drafts = allPosts.filter((p) => p.status === "draft");
    const totalViews = allPosts.reduce((sum, p) => sum + p.viewCount, 0);
    const pendingComments = await this.commentRepo.findMany({
      where: { status: { eq: "pending" } },
    });
    const totalComments = await this.commentRepo.findMany({});

    const recentPosts = await this.repo.findMany({
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 5,
    });

    return {
      totalPosts: allPosts.length,
      publishedPosts: published.length,
      draftPosts: drafts.length,
      totalComments: totalComments.length,
      pendingComments: pendingComments.length,
      totalViews,
      recentPosts: await Promise.all(
        recentPosts.map((p) => this.toResource(p)),
      ),
    };
  }

  protected async toResource(post: PostEntity): Promise<PostResource> {
    const user = await this.userRepo.findOne({
      where: { id: { eq: post.authorId } },
    });
    let categoryName: string | undefined;
    if (post.categoryId) {
      const category = await this.categoryRepo.findOne({
        where: { id: { eq: post.categoryId } },
      });
      categoryName = category?.name;
    }

    return {
      id: post.id,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      title: post.title,
      slug: post.slug,
      content: post.content,
      excerpt: post.excerpt,
      coverImageId: post.coverImageId,
      authorId: post.authorId,
      authorName: user
        ? [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email ||
          "Unknown"
        : "Unknown",
      authorEmail: user?.email,
      categoryId: post.categoryId,
      categoryName,
      status: post.status,
      publishedAt: post.publishedAt,
      tags: post.tags,
      featured: post.featured,
      viewCount: post.viewCount,
    };
  }

  protected generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
