import { useState } from "react";

/**
 * A page with one bundled asset (the client JS that hydrates the button) and
 * one plain public file (`/loom.svg`), which are the two kinds of file a
 * compiled binary has to serve.
 */
export const Home = () => {
  const [count, setCount] = useState(0);

  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <img src="/loom.svg" alt="Loom" width={48} height={48} />
      <h1>Loom</h1>
      <p>Served from a single Bun binary.</p>
      <button type="button" onClick={() => setCount(count + 1)}>
        hydrated: {count}
      </button>
    </main>
  );
};
