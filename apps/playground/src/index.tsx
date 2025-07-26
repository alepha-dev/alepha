import { run } from "@alepha/core";
import { $action } from "@alepha/server";

class Server {
	hello = $action({
		handler: () => "Hello from the!",
	});
}

run(Server);
