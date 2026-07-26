export const webHomeComponentTsx = () => {
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
};
