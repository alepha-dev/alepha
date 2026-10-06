/**
 * The body of a route that exists only to redirect.
 *
 * Its loader throws a `Redirection` before this ever renders, so the one case
 * it is on screen for is the instant between the route matching and the loader
 * resolving. Rendering nothing is the right answer there: a spinner would flash
 * on a navigation the user never sees, and a message would be a claim about a
 * page that is about to be replaced.
 *
 * `$page` needs a component, which is the only reason this file exists rather
 * than the route pointing at whatever module happened to be nearby.
 */
const RedirectPage = () => null;

export default RedirectPage;
