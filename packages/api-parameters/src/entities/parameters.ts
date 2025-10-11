import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const parameters = $entity({
	name: "parameters",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		version: pg.version(),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		config: t.string(),
		content: t.json(),
		tags: t.optional(t.array(t.string())),
		creatorId: t.optional(t.uuid()),
		creatorName: t.optional(t.string()),
		activationDate: t.datetime({
			description:
				"Optional activation date. Default to now. Must be now or later.",
		}),
	}),
});

export type ParameterEntity = Static<typeof parameters.$schema>;
