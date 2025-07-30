import { t } from "@alepha/core";
import { $action } from "@alepha/server";

class Api {
	login = $action({
		schema: {
			body: t.object({
				username: t.string(),
				password: t.string(),
			}),
			response: t.object({
				success: t.boolean(),
				message: t.string(),
			}),
		},
		handler: async ({ body }) => {
			const { username, password } = body;

			// Simulate a login process
			if (username === "admin" && password === "password") {
				return {
					success: true,
					message: "Login successful",
				};
			} else {
				return {
					success: false,
					message: "Invalid username or password",
				};
			}
		},
	});
}

export default Api;
