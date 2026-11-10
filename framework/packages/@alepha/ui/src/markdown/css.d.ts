/**
 * Stylesheets imported for their side effect (`import "./MarkdownView.css"`).
 *
 * Vite resolves them; the compiler only needs to know the module exists. In
 * this repository that declaration also arrives through `alepha`'s source,
 * which references `vite/client`, but a vendored copy builds against
 * `alepha`'s `dist`, whose declarations drop the reference, so the package
 * declares what it imports itself (#Q3310). Same shape as `vite/client`'s,
 * so the two merge.
 */
declare module "*.css" {}
