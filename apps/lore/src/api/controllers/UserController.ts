import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { UserBuckets, users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

export class UserController {
  users = $repository(users);
  fileService = $inject(FileService);
  userFiles = $inject(UserBuckets);

  me = $action({
    use: [$secure({ permissions: ["user:read"] })],
    schema: {
      response: users.schema,
    },
    handler: async ({ user }) => {
      return await this.users.getOne({
        where: {
          id: { eq: user.id },
        },
      });
    },
  });

  updateAvatar = $action({
    use: [$secure({ permissions: ["user:update"] })],
    schema: {
      body: z.object({
        file: z.file(),
      }),
      response: users.schema,
    },
    handler: async ({ user, body }) => {
      // Store the file in the avatars bucket
      const file = await this.fileService.uploadFile(body.file, {
        user,
        bucket: this.userFiles.avatars.name,
      });

      // Update the user's picture field
      return await this.users.updateById(user.id, {
        picture: file.id,
      });
    },
  });
}
