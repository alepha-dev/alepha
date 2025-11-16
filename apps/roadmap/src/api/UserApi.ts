import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $action } from "alepha/server";
import { users } from "../entities/users.ts";
import { Db } from "../providers/Db.ts";

export class UserApi {
  db = $inject(Db);
  fileService = $inject(FileService);

  me = $action({
    schema: {
      response: users.schema,
    },
    handler: async ({ user }) => {
      return await this.db.users.findOne({
        where: {
          id: { eq: user.id },
        },
      });
    },
  });

  public readonly streamUserFile = $action({
    path: `/users/files/:id`,
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: t.file(),
    },
    handler: async ({ params, reply }) => {
      const stream = await this.fileService.streamFile(params.id);
      reply.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return stream;
    },
  });

  updateAvatar = $action({
    schema: {
      body: t.object({
        file: t.file(),
      }),
      response: users.schema,
    },
    handler: async ({ user, body }) => {
      // Store the file in the avatars bucket
      const file = await this.fileService.uploadFile(body.file, {
        user,
        bucket: this.db.avatars.name,
      });

      // Update the user's picture field
      return await this.db.users.updateById(user.id, {
        picture: file.id,
      });
    },
  });
}
