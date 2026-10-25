/**
 * The first React component in a new project, and therefore the one every
 * component written after it is modelled on.
 *
 * It is written to the framework's own conventions on purpose: a named
 * exported `HomeProps` interface rather than an inline `type Props`, props
 * taken whole instead of destructured in the parameter list, and an arrow
 * function. `AGENTS.md` states those rules; this file is where an assistant
 * confirms them.
 *
 * The default export is the one deviation, and it is required: `$page`'s
 * `lazy` loads the module and renders its default.
 */
export const webHomeComponentTsx = () => {
  return `import { GettingStarted } from "alepha/react/intro";

export interface HomeProps {
  appName: string;
  serverTime: string;
}

const Home = (props: HomeProps) => {
  return <GettingStarted welcome={props} />;
};

export default Home;
`;
};
