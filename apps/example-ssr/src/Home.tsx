import { useAction } from "@alepha/react";
import { useState } from "react";

export interface HomeProps {
  greeting: string;
}

const Home = (props: HomeProps) => {
  const [count, setCount] = useState(0);
  const inc = useAction(
    {
      handler: () => setCount(count + 1),
    },
    [count],
  );

  return (
    <div>
      <p>Add queryParam "name".</p>
      <h1>{props.greeting}</h1>
      <button onClick={inc.run}>{count}</button>
    </div>
  );
};

export default Home;
