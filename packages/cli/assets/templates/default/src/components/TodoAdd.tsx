import { useClient, useRouter } from "alepha/react";
import type { FormEvent } from "react";
import type TodoApi from "../api/TodoApi.js";
import type AppRouter from "../AppRouter.js";

const TodoAdd = () => {
  const router = useRouter<AppRouter>();
  const client = useClient<TodoApi>();

  const addTodo = async (event: FormEvent) => {
    event.preventDefault();

		const task = event.currentTarget.querySelector("input")?.value;
		if (!task) {
			return;
		}

		await client.addTask({
			body: { task },
		});

		await router.go("taskList");
  };

  return (
    <div>
      <h2>Add a new Todo</h2>
      <form onSubmit={addTodo}>
        <input name={"task"} type="text" placeholder="Enter todo item" />
        <button type="submit">Add Todo</button>
      </form>
    </div>
  );
};

export default TodoAdd;
