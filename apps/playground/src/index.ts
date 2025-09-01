import { run, t } from "@alepha/core";
import { $permission, permissionSchema } from "@alepha/security";
import { $action } from "@alepha/server";

class App {
	test = $permission();
	ok = $action({
		schema: {
			response: t.array(permissionSchema),
		},
		handler: () => {
			return [this.test];
		},
	});
}

run(App);
