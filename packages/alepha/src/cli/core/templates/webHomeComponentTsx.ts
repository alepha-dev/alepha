export interface WebHomeComponentOptions {
  api?: boolean;
}

export const webHomeComponentTsx = (options: WebHomeComponentOptions = {}) => {
  if (options.api) {
    return `import { GettingStarted } from "alepha/react/intro";

type Props = {
  appName: string;
  serverTime: string;
}

const Home = (props: Props) => {
  return <GettingStarted welcome={props} />;
};

export default Home;
`;
  }

  return `import { GettingStarted } from "alepha/react/intro";

const Home = () => {
  return <GettingStarted />;
};

export default Home;
`;
};
