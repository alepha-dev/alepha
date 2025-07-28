import { t } from "alepha";
import { $action } from "alepha/server";
import { taskSchema, type Task } from "../schemas/taskSchema.js";

class TodoApi {
  tasks: Array<Task> = [];

  getTasks = $action({
    schema: {
      response: t.array(taskSchema),
    },
    handler: async () => {
      return this.tasks;
    },
  });

  addTask = $action({
    schema: {
      body: t.object({
        task: t.string(),
      }),
      response: t.array(taskSchema),
    },
    handler: async ({ body }) => {
      this.tasks.push({
        id: crypto.randomUUID(),
        name: body.task,
      });
      return this.tasks;
    },
  });

  deleteTask = $action({
    method: "DELETE",
    schema: {
      params: t.object({
        task: t.uuid(),
      }),
      response: t.array(taskSchema),
    },
    handler: async ({ params }) => {
      this.tasks = this.tasks.filter((t) => t.id !== params.task);
      return this.tasks;
    },
  });
}

export default TodoApi;
