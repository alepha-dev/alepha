import { users } from "alepha/api/users";
import { $repository, type Page } from "alepha/orm";
import {
  type CommentEntity,
  commentEntity,
} from "../entities/commentEntity.ts";
import { postEntity } from "../entities/postEntity.ts";
import type {
  CommentCreate,
  CommentQuery,
  CommentResource,
} from "../schemas/commentSchemas.ts";

export class CommentService {
  protected readonly repo = $repository(commentEntity);
  protected readonly userRepo = $repository(users);
  protected readonly postRepo = $repository(postEntity);

  async findByPost(
    postId: string,
    query: CommentQuery,
  ): Promise<Page<CommentResource>> {
    const page = await this.repo.paginate(
      query,
      {
        where: { postId: { eq: postId }, status: { eq: "approved" } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      },
      { count: true },
    );
    return {
      ...page,
      content: await Promise.all(page.content.map((c) => this.toResource(c))),
    };
  }

  async findAll(query: CommentQuery): Promise<Page<CommentResource>> {
    const where: Record<string, unknown> = {};

    if (query.postId) {
      where.postId = { eq: query.postId };
    }
    if (query.status) {
      where.status = { eq: query.status };
    }
    if (query.authorId) {
      where.authorId = { eq: query.authorId };
    }

    const page = await this.repo.paginate(
      query,
      { where, orderBy: [{ column: "createdAt", direction: "desc" }] },
      { count: true },
    );

    return {
      ...page,
      content: await Promise.all(page.content.map((c) => this.toResource(c))),
    };
  }

  async create(
    postId: string,
    authorId: string,
    data: CommentCreate,
  ): Promise<CommentResource> {
    const comment = await this.repo.create({
      postId,
      authorId,
      content: data.content,
      parentId: data.parentId,
      status: "pending",
    });
    return this.toResource(comment as CommentEntity);
  }

  async updateStatus(
    id: string,
    status: "pending" | "approved" | "spam" | "rejected",
  ): Promise<CommentResource> {
    const updated = await this.repo.updateOne({ id: { eq: id } }, { status });
    return this.toResource(updated as CommentEntity);
  }

  async delete(id: string): Promise<void> {
    await this.repo.deleteMany({ id: { eq: id } });
  }

  protected async toResource(comment: CommentEntity): Promise<CommentResource> {
    const user = await this.userRepo.findOne({
      where: { id: { eq: comment.authorId } },
    });
    const post = await this.postRepo.findOne({
      where: { id: { eq: comment.postId } },
    });

    return {
      id: comment.id,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      postId: comment.postId,
      postTitle: post?.title,
      postSlug: post?.slug,
      authorId: comment.authorId,
      authorName: user
        ? [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email ||
          "Unknown"
        : "Unknown",
      authorEmail: user?.email,
      content: comment.content,
      status: comment.status,
      parentId: comment.parentId,
    };
  }
}
