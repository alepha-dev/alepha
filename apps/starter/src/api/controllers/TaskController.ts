import { t } from "alepha";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { taskEntity } from "../entities/taskEntity.ts";

export class TaskController {
  taskRepository = $repository(taskEntity);

  getTasks = $action({
    secure: false,
    schema: {
      response: t.array(taskEntity.schema),
    },
    handler: async () => {
      return this.taskRepository.findMany();
    },
  });

  createTask = $action({
    secure: false,
    schema: {
      body: taskEntity.insertSchema,
      response: t.array(taskEntity.schema),
    },
    handler: async ({ body }) => {
      await this.taskRepository.create(body);
      return this.taskRepository.findMany();
    },
  });

  deleteTask = $action({
    secure: false,
    method: "DELETE",
    schema: {
      params: t.object({
        task: t.uuid(),
      }),
      response: t.array(taskEntity.schema),
    },
    handler: async ({ params }) => {
      await this.taskRepository.deleteById(params.task);
      return this.taskRepository.findMany();
    },
  });
}
