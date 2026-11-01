import { Suspense, use, useState } from "react";

export interface DeferredProps {
  title: string;
  slow: Promise<string>;
}

const Slow = (props: { value: Promise<string> }) => {
  return <output id="value">{use(props.value)}</output>;
};

const Deferred = (props: DeferredProps) => {
  const [clicks, setClicks] = useState(0);

  return (
    <main>
      <h1>{props.title}</h1>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Clicked {clicks}
      </button>
      <Suspense fallback={<p id="pending">Loading the value</p>}>
        <Slow value={props.slow} />
      </Suspense>
    </main>
  );
};

export default Deferred;
