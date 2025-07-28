import { useClient } from "alepha/react";
import { useState } from "react";
import type TodoApi from "../api/TodoApi.js";
import type { Task } from "../schemas/taskSchema.js";

type Props = {
  tasks: Task[];
};

const TodoList = (props: Props) => {
  const client = useClient<TodoApi>();
  const [tasks, setTasks] = useState(props.tasks);

  return (
    <div>
      <ul>
        {tasks.map((task, index) => (
          <li key={index}>
            {task.name}
            <button
              onClick={async () => {
                await client
                  .deleteTask({
                    params: { task: task.id },
                  })
                  .then(setTasks);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TodoList;
