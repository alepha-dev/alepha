import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { Db } from "../providers/Db.ts";

export class CharacterController {
  db = $inject(Db);

  getMyCharacters = $action({
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
      const userCharacters = await this.db.characters.findMany({
        where: { userId: { eq: user.id } },
      });
      const userCharacterIds = userCharacters.map((c) => c.id);

      if (userCharacterIds.length === 0) {
        return [];
      }

      // Fetch projects for each character
      const projects = await this.db.projects.findMany({
        where: { id: { inArray: userCharacters.map((c) => c.projectId) } },
      });

      return (
        await Promise.all(
          userCharacters.map(async (character) => {
            const project = projects.find((p) => p.id === character.projectId);
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
