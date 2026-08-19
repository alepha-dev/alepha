/**
 * Custom error page returned by a page's `errorHandler`.
 *
 * The failure it answers is thrown by a middleware, not a loader, so it only
 * reaches this component if the router resolves `errorHandler` outside the
 * layer chain too.
 */
const TooManyRequests = () => {
  return (
    <div
      style={{
        padding: "3rem",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <h1>Easy there</h1>
      <p>You are going a bit fast. Give it a few seconds and try again.</p>
      <a href="/">Back home</a>
    </div>
  );
};

export default TooManyRequests;
