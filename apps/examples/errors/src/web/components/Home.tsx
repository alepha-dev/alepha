import { useRouter } from "alepha/react/router";

import type { AppRouter } from "../AppRouter.ts";

const Home = () => {
  const router = useRouter<AppRouter>();

  const pages = [
    {
      go: () => router.push("renderError"),
      label: "Render Error",
      desc: "Component throws during render",
    },
    {
      go: () => router.push("loaderError"),
      label: "Loader Error",
      desc: "Loader throws AlephaError",
    },
    {
      go: () => router.push("hookError"),
      label: "Hook Error",
      desc: "useState initializer throws",
    },
    {
      go: () => router.push("asyncError"),
      label: "Async Error",
      desc: "Rejected promise read with React.use()",
    },
    {
      go: () => router.push("nonErrorThrow"),
      label: "Non-Error Throw",
      desc: 'throw "string" in render',
    },
    {
      go: () => router.push("causeChain"),
      label: "Cause Chain",
      desc: "Error with nested .cause",
    },
    {
      go: () => router.push("hydrationMismatch"),
      label: "Hydration Mismatch",
      desc: "Server/client output differs",
    },
    {
      go: () => router.push("nestedChildOk"),
      label: "Nested (NestedView)",
      desc: "Parent ok, child errors inside NestedView",
    },
    {
      go: () => router.push("httpError"),
      label: "HTTP Error (404)",
      desc: "Loader throws HttpError 404",
    },
    {
      go: () => router.push("httpError500"),
      label: "HTTP Error (500)",
      desc: "Loader throws HttpError 500",
    },
  ];

  /**
   * Failures thrown around the render rather than inside a loader.
   *
   * These only happen on the server, so they need a hard navigation — a
   * `router.push` never leaves the client and would never reach them.
   */
  const hardLoads = [
    {
      href: "/middleware-error",
      label: "Middleware Error (500)",
      desc: "use: throws before the render",
    },
    {
      href: "/middleware-503",
      label: "Middleware Not Ready (503)",
      desc: "the shape a boot / rate-limit hook takes",
    },
    {
      href: "/middleware-429",
      label: "Middleware Rate Limit (429)",
      desc: "answered by the page's own errorHandler",
    },
  ];

  const cardStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    border: "1px solid #333",
    borderRadius: 8,
    background: "#1a1a1a",
    color: "#eee",
    cursor: "pointer",
    textAlign: "left" as const,
    textDecoration: "none",
  };

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "40px auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Crash Test</h1>
      <p style={{ color: "#888", marginBottom: 32 }}>
        Click a scenario to trigger the error.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pages.map((p) => (
          <button key={p.label} type="button" onClick={p.go} style={cardStyle}>
            <span style={{ fontWeight: 600 }}>{p.label}</span>
            <span style={{ color: "#888", fontSize: 13 }}>{p.desc}</span>
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 18, margin: "32px 0 8px" }}>Server-side only</h2>
      <p style={{ color: "#888", marginBottom: 16, fontSize: 13 }}>
        Thrown around the render, so they need a full page load. Fetch the same
        URLs without an HTML Accept header and they answer JSON instead.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {hardLoads.map((p) => (
          <a key={p.label} href={p.href} style={cardStyle}>
            <span style={{ fontWeight: 600 }}>{p.label}</span>
            <span style={{ color: "#888", fontSize: 13 }}>{p.desc}</span>
          </a>
        ))}
      </div>
    </div>
  );
};

export default Home;
