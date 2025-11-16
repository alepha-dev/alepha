import { $inject } from "alepha";
import { identities, sessions } from "alepha/api/users";
import { $bucket } from "alepha/bucket";
import { $repository, DatabaseProvider } from "alepha/orm";
import { characters } from "../entities/characters.ts";
import { files } from "../entities/files.ts";
import { invitations } from "../entities/invitations.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { users } from "../entities/users.ts";

export class Db {
  tasks = $repository(tasks);
  users = $repository(users);
  projects = $repository(projects);
  identities = $repository(identities);
  sessions = $repository(sessions);
  characters = $repository(characters);
  invitations = $repository(invitations);
  files = $repository(files);

  avatars = $bucket({
    name: "avatars",
    maxSize: 5 * 1024 * 1024, // 5MB
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  });

  provider = $inject(DatabaseProvider);
  query = this.provider.run.bind(this.provider);
}
