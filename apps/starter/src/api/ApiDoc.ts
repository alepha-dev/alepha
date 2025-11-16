import { $swagger } from "alepha/server/swagger";

export class ApiDoc {
  docs = $swagger({
    info: {
      title: "My API",
      description: "API documentation for My Application",
      version: "1.0.0",
    },
  });
}
