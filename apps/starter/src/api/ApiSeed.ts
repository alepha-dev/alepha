import { $hook } from "@alepha/core";
import { $repository } from "@alepha/orm";
import { tasks } from "./entities/tasks.ts";

export class ApiSeed {
  taskRepository = $repository(tasks);

  ready = $hook({
    on: "ready",
    handler: async () => {
      const count = await this.taskRepository.count();
      if (count > 0) {
        return;
      }

      await this.taskRepository.createMany([
        { name: "Task 1" },
        { name: "Task 2" },
        { name: "Task 3" },
      ]);
    },
  });
}
