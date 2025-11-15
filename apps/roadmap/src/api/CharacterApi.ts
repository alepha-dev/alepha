import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { Db } from "../providers/Db.ts";

export class CharacterApi {
  db = $inject(Db);

  getMyCharacters = $action({
    schema: {
      response: t.array(
        t.object({
          id: t.int(),
          projectId: t.int(),
          projectTitle: t.string(),
          xp: t.int(),
          balance: t.int(),
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
