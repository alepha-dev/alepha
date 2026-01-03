import { $inject, t } from "alepha";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import {
  type WhiteboardData,
  whiteboardDataSchema,
  whiteboards,
} from "../entities/whiteboards.ts";
import { Security } from "../providers/Security.ts";

export class WhiteboardController {
  whiteboards = $repository(whiteboards);
  security = $inject(Security);

  getWhiteboards = $action({
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
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: whiteboards.schema,
    },
    handler: async ({ params, user }) => {
      const whiteboard = await this.whiteboards.findById(params.id);
      await this.security.checkOwnership(whiteboard.projectId, user);
      return whiteboard;
    },
  });

  updateWhiteboard = $action({
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
      const whiteboard = await this.whiteboards.findById(params.id);
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
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const whiteboard = await this.whiteboards.findById(params.id);
      await this.security.checkOwnership(whiteboard.projectId, user);

      await this.whiteboards.deleteById(params.id);
      return { ok: true };
    },
  });
}
