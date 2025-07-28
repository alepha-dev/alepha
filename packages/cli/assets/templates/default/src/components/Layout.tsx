import { Link, NestedView } from "alepha/react";

const Layout = () => {
  return (
    <fieldset>
      <legend>Todo List</legend>
      <ul>
        <li>
          <Link to="/">Home</Link>
        </li>
        <li>
          <Link to="/add-task">Add Task</Link>
        </li>
      </ul>
      <hr />
      <NestedView />
    </fieldset>
  );
};

export default Layout;
