import { run } from "alepha";
import { $route } from "alepha/server";

class App {
  root = $route({
    path: "/",
    handler: () => "Hello, Alepha!",
  });
}

run(App);
