import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { Db } from "./providers/Db.ts";

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
					createdAt: t.datetime(),
					updatedAt: t.datetime(),
				}),
			),
		},
		handler: async ({ user }) => {
			const userCharacters = await this.db.characters.find({
				where: { userId: { eq: user.id } },
			});

			return (
				await Promise.all(
					userCharacters.map(async (character) => {
						const project = await this.db.projects
							.findOne({
								id: { eq: character.projectId },
							})
							.catch(() => null);

						if (!project) {
							return;
						}

						return {
							id: character.id,
							projectId: character.projectId,
							projectTitle: project?.title ?? "Unknown Project",
							xp: character.xp,
							balance: character.balance,
							createdAt: character.createdAt,
							updatedAt: character.updatedAt,
						};
					}),
				)
			).filter((it) => !!it);
		},
	});
}
