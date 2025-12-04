import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { UserRealmProvider } from "alepha/api/users";
import { $action } from "alepha/server";
import { users } from "../entities/users.ts";
import { Db } from "../providers/Db.ts";

export class UserController {
  db = $inject(Db);
  fileService = $inject(FileService);
  realm = $inject(UserRealmProvider);

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
        bucket: this.realm.avatars.name,
      });

      // Update the user's picture field
      return await this.db.users.updateById(user.id, {
        picture: file.id,
      });
    },
  });
}
