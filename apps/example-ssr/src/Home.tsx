import { useAction, useClient } from "@alepha/react";
import { useState } from "react";
import type { CountApi } from "./CountApi.ts";

export interface HomeProps {
  greeting: string;
  count: number;
}

const Home = (props: HomeProps) => {
  const [count, setCount] = useState(props.count);
  const countApi = useClient<CountApi>();
  const inc = useAction(
    {
      handler: async () => {
        const result = await countApi.inc();
        setCount(result.count);
      },
    },
    [count],
  );

  return (
    <fieldset>
      <legend>{props.greeting}</legend>
      <p>
        <button onClick={inc.run}>Click {count}</button>
      </p>
      <p>
        <small>Add ?name=your-name to URL</small>
      </p>
    </fieldset>
  );
};

export default Home;
