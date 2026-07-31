/**
 * A holding page.
 *
 * Pulse's server half works — ingest, error grouping, analytics, the MCP
 * tools — but nothing renders it yet. Saying so plainly beats an empty
 * dashboard that looks broken.
 */
const HomePage = () => (
  <main style={{ fontFamily: "system-ui", padding: "3rem", maxWidth: "40rem" }}>
    <h1>Pulse</h1>
    <p>
      Analytics, errors and web vitals for apps hosted anywhere. The API and the
      MCP tools are running; the interface is not built yet.
    </p>
    <p>
      See <code>apps/pulse/TODO.md</code>.
    </p>
  </main>
);

export default HomePage;
