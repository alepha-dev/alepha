import { $module } from "@alepha/core";
import { AlephaServerSwagger } from "@alepha/server-swagger";
import { ApiDoc } from "./ApiDoc.ts";
import { TaskController } from "./controllers/TaskController.ts";

export const Api = $module({
  name: "my.api",
  services: [AlephaServerSwagger, ApiDoc, TaskController],
});
