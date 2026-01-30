import { t } from "alepha";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";

export class CharacterController {
  characters = $repository(characters);
  projects = $repository(projects);

  getMyCharacters = $action({
    secure: true,
    schema: {
      response: t.array(
        t.object({
          id: t.integer(),
          projectId: t.integer(),
          projectTitle: t.string(),
          xp: t.integer(),
          balance: t.integer(),
          owner: t.optional(t.boolean()),
          createdAt: t.datetime(),
          updatedAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ user }) => {
      const userCharacters = await this.characters.findMany({
        where: { userId: { eq: user.id } },
      });
      const userCharacterIds = userCharacters.map((c) => c.id);

      if (userCharacterIds.length === 0) {
        return [];
      }

      // Fetch projects for each character
      const userProjects = await this.projects.findMany({
        where: { id: { inArray: userCharacters.map((c) => c.projectId) } },
      });

      return (
        await Promise.all(
          userCharacters.map(async (character) => {
            const project = userProjects.find(
              (p) => p.id === character.projectId,
            );
            if (!project) {
              return;
            }

            return {
              id: character.id,
              projectId: character.projectId,
              projectTitle: project?.title ?? "Unknown Project",
              xp: character.xp,
              balance: character.balance,
              owner: character.owner,
              createdAt: character.createdAt,
              updatedAt: character.updatedAt,
            };
          }),
        )
      ).filter((it) => !!it);
    },
  });
}
