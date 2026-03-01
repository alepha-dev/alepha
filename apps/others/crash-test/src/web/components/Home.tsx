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
      desc: "Promise rejection in useEffect",
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
          <button
            key={p.label}
            type="button"
            onClick={p.go}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              border: "1px solid #333",
              borderRadius: 8,
              background: "#1a1a1a",
              color: "#eee",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontWeight: 600 }}>{p.label}</span>
            <span style={{ color: "#888", fontSize: 13 }}>{p.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Home;
