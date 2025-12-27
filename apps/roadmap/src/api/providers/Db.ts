import { $inject } from "alepha";
import { identities, sessions } from "alepha/api/users";
import { $repository, DatabaseProvider } from "alepha/orm";
import { characters } from "../entities/characters.ts";
import { files } from "../entities/files.ts";
import { invitations } from "../entities/invitations.ts";
import { mcpApiKeys } from "../entities/mcpApiKeys.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { taskVotes } from "../entities/taskVotes.ts";
import { users } from "../entities/users.ts";

export class Db {
  tasks = $repository(tasks);
  taskVotes = $repository(taskVotes);
  users = $repository(users);
  projects = $repository(projects);
  identities = $repository(identities);
  sessions = $repository(sessions);
  characters = $repository(characters);
  invitations = $repository(invitations);
  files = $repository(files);
  mcpApiKeys = $repository(mcpApiKeys);

  provider = $inject(DatabaseProvider);
  query = this.provider.run.bind(this.provider);
}
