import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import {
  type WhiteboardData,
  whiteboardDataSchema,
  whiteboards,
} from "../entities/whiteboards.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

export class WhiteboardController {
  whiteboards = $repository(whiteboards);
  security = $inject(AppSecurityProvider);
  fileService = $inject(FileService);

  // Bucket for whiteboard images
  images = $bucket({
    maxSize: 10 * 1024 * 1024, // 10 MB
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });

  getWhiteboards = $action({
    secure: true,
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      response: t.array(whiteboards.schema),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      return this.whiteboards.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
      });
    },
  });

  createWhiteboard = $action({
    secure: true,
    schema: {
      body: t.object({
        projectId: t.integer(),
        title: t.string({ minLength: 1, maxLength: 50 }),
      }),
      response: whiteboards.schema,
    },
    handler: async ({ body, user }) => {
      await this.security.checkOwnership(body.projectId, user);

      return this.whiteboards.create({
        title: body.title,
        projectId: body.projectId,
        createdBy: user.id,
        data: { elements: [] },
      });
    },
  });

  getWhiteboardById = $action({
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: whiteboards.schema,
    },
    handler: async ({ params, user }) => {
      const whiteboard = await this.whiteboards.getById(params.id);
      await this.security.checkOwnership(whiteboard.projectId, user);
      return whiteboard;
    },
  });

  updateWhiteboard = $action({
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 50 })),
        data: t.optional(whiteboardDataSchema),
      }),
      response: whiteboards.schema,
    },
    handler: async ({ params, body, user }) => {
      const whiteboard = await this.whiteboards.getById(params.id);
      await this.security.checkOwnership(whiteboard.projectId, user);

      const updateData: { title?: string; data?: WhiteboardData } = {};
      if (body.title !== undefined) {
        updateData.title = body.title;
      }
      if (body.data !== undefined) {
        updateData.data = body.data;
      }

      return this.whiteboards.updateById(params.id, updateData);
    },
  });

  deleteWhiteboard = $action({
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const whiteboard = await this.whiteboards.getById(params.id);
      await this.security.checkOwnership(whiteboard.projectId, user);

      await this.whiteboards.deleteById(params.id);
      return { ok: true };
    },
  });

  // Upload image for whiteboard
  uploadImage = $action({
    secure: true,
    path: "/whiteboards/images",
    schema: {
      body: t.object({
        file: t.file(),
      }),
      response: t.object({
        fileId: t.uuid(),
        url: t.string(),
      }),
    },
    handler: async ({ body, user }) => {
      const file = await this.fileService.uploadFile(body.file, {
        user,
        bucket: this.images.name,
      });
      return {
        fileId: file.id,
        url: `/api/files/${file.id}`,
      };
    },
  });

  // Delete image from whiteboard
  deleteImage = $action({
    secure: true,
    method: "DELETE",
    path: "/whiteboards/images/:fileId",
    schema: {
      params: t.object({
        fileId: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.fileService.deleteFile(params.fileId);
      return { ok: true };
    },
  });
}
