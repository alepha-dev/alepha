import { t } from "@alepha/core";
import { $repository } from "@alepha/orm";
import { $action } from "@alepha/server";
import { tasks } from "../entities/tasks.ts";

export class TaskController {
  taskRepository = $repository(tasks);

  getTasks = $action({
    schema: {
      response: t.array(tasks.schema),
    },
    handler: async () => {
      return this.taskRepository.findMany();
    },
  });

  createTask = $action({
    schema: {
      body: tasks.insertSchema,
      response: t.array(tasks.schema),
    },
    handler: async ({ body }) => {
      await this.taskRepository.create(body);
      return this.taskRepository.findMany();
    },
  });

  deleteTask = $action({
    method: "DELETE",
    schema: {
      params: t.object({
        task: t.uuid(),
      }),
      response: t.array(tasks.schema),
    },
    handler: async ({ params }) => {
      await this.taskRepository.deleteById(params.task);
      return this.taskRepository.findMany();
    },
  });
}
