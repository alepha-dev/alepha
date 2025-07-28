import { useClient, useRouter } from "alepha/react";
import type { FormEvent } from "react";
import type TodoApi from "../api/TodoApi.js";

const TodoAdd = () => {
  const router = useRouter();
  const client = useClient<TodoApi>();

  const addTodo = async (event: FormEvent) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    if (input?.value) {
      await client.addTask({
        body: { task: input.value },
      });
      await router.go("/");
    }
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
