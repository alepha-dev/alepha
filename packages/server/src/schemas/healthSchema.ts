import { t } from "@alepha/core";

export const healthSchema = t.object(
	{
		uptime: t.number(),
		message: t.string(),
		date: t.datetime(),
	},
	{ title: "Health" },
);
