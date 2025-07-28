import { $page } from "alepha/react";
import { $client } from "alepha/server/links";
import type TodoApi from "./api/TodoApi.js";
import TodoAdd from "./components/TodoAdd.js";
import TodoList from "./components/TodoList.js";

class AppRouter {
	// use only <type> here, no need to import the class
	todoApi = $client<TodoApi>();

	root = $page({
		children: () => [this.taskCreate, this.taskList],
		head: {
			title: "Demo App",
			titleSeparator: " | ",
			description: "Welcome to your new Alepha app!",
		},
		lazy: () => import("./components/Layout.js"),
	});

	taskCreate = $page({
		path: "/add-task",
		head: {
			title: "Add a new Todo",
			description: "Create a new task to manage your todos.",
		},
		component: TodoAdd,
	});

	taskList = $page({
		path: "/",
		head: {
			title: "Todo List",
		},
		// this is the resolver for the page, it fetches the tasks from the API
		// and passes them to the component as props
		resolve: async () => {
			return {
				tasks: await this.todoApi.getTasks(),
			};
		},
		component: TodoList,
	});
}

export default AppRouter;
