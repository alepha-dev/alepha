import { run } from "alepha";
import { $route } from "alepha/server";
import { $basicAuth } from "alepha/server/security";

class App {
  auth = $basicAuth({
    paths: ["/admin/*"],
    username: "john",
    password: "doe123",
  });

  root = $route({
    path: "/",
    handler: () => "Hello, Alepha!",
  });

  secured = $route({
    path: "/admin/secret",
    handler: () => "SECRET",
  });
}

run(App);
