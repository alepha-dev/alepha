import { type Static, t } from "@alepha/core";

export const errorSchema = t.object(
	{
		error: t.text({ description: "HTTP error name" }),
		status: t.int({
			description: "HTTP status code",
		}),
		message: t.text({
			description: "Short text which describe the error",
			size: "rich",
		}),
		details: t.optional(
			t.text({
				description: "Detailed description of the error",
				size: "rich",
			}),
		),
		requestId: t.optional(t.text()),
		cause: t.optional(
			t.object({
				name: t.text(),
				message: t.text({
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

export type ErrorSchema = Static<typeof errorSchema>;
