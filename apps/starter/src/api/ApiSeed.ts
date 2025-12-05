import { $hook } from "alepha";
import { $repository } from "alepha/orm";
import { taskEntity } from "./entities/taskEntity.ts";

export class ApiSeed {
  taskRepository = $repository(taskEntity);

  ready = $hook({
    on: "ready",
    handler: async () => {
      const count = await this.taskRepository.count();
      if (count > 0) {
        return;
      }

      await this.taskRepository.createMany([
        { name: "Read the Alepha documentation" },
        { name: "Explore the starter app code" },
        { name: "Create your first API endpoint" },
        { name: "Build something amazing" },
      ]);
    },
  });
}
