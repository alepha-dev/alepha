import { run } from "alepha";
import { $action, $route } from "alepha/server";

class App {
  root = $route({
    path: "/",
    handler: () => "Hello, Alepha!",
  });
  testp = $action({
    handler: () => "Hello, Alepha!",
  });
}

run(App);
