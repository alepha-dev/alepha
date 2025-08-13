import { t } from "@alepha/core";

export const errorSchema = t.object(
	{
		error: t.string({ description: "HTTP error name" }),
		status: t.uint({
			description: "HTTP status code",
		}),
		message: t.string({
			description: "Short text which describe the error",
			size: "rich",
		}),
		details: t.optional(
			t.string({
				description: "Detailed description of the error",
				size: "rich",
			}),
		),
		cause: t.optional(
			t.object({
				name: t.string(),
				message: t.string({
					description: "Cause Error message",
					size: "rich",
				}),
			}),
		),
	},
	{
		title: "HttpError",
		description: "Generic response after a failed operation",
	},
);
