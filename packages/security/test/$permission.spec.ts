import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { $permission, $role } from "../src";

test("$permission - can", async () => {
	const alepha = Alepha.create();

	class App {
		hello = $permission();
		world = $permission();

		user = $role({
			permissions: ["App:hello"],
		});
	}

	const app = alepha.get(App);

	await alepha.start();

	const user = {
		id: "1",
		roles: [app.user()],
	};

	expect(app.world.can(user)).toEqual(false);
	expect(app.hello.can(user)).toEqual(true);
});
