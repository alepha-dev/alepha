/**
 * Component that produces different output on server vs client,
 * triggering a React hydration mismatch warning.
 */
const HydrationMismatch = () => {
  const isServer = typeof window === "undefined";

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "40px auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2>Hydration Mismatch</h2>
      <p>Check the console for React hydration warnings.</p>
      <div>
        {isServer ? (
          <span id="mismatch">server-rendered-value</span>
        ) : (
          <span id="mismatch">client-rendered-value</span>
        )}
      </div>
      <p style={{ color: "#888", fontSize: 13, marginTop: 16 }}>
        The span above has different content on server vs client.
      </p>
    </div>
  );
};

export default HydrationMismatch;
