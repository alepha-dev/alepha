import { useClient } from "@alepha/react";
import { Localize, useI18n } from "@alepha/react-i18n";
import { useState } from "react";
import type { TaskController } from "../../api/controllers/TaskController.ts";
import type { TaskEntity } from "../../api/entities/tasks.ts";
import type { AppI18n } from "../AppI18n.ts";

type Props = {
  tasks: TaskEntity[];
};

const Home = (props: Props) => {
  const client = useClient<TaskController>();
  const { tr } = useI18n<AppI18n, "en">();
  const [tasks, setTasks] = useState(props.tasks);

  const onClickDelete = (taskId: string) => async () => {
    const updatedTasks = await client.deleteTask({
      params: { task: taskId },
    });

    setTasks(updatedTasks);
  };

  return (
    <div>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <div>
              {task.name}
              <br />
              <small>
                <Localize value={task.createdAt} date={"LLL"} />
              </small>
            </div>
            <button type="button" onClick={onClickDelete(task.id)}>
              {tr("home.deleteButton")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Home;
