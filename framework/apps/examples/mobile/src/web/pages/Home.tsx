export interface HomeProps {
  appName: string;
  serverTime: string;
}

/**
 * The unprotected first screen. Its data comes from the API's greeting, so
 * the page proves a loader reached the API, wherever that API lives.
 */
const Home = (props: HomeProps) => {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{props.appName}</h1>
      <p className="text-muted-foreground" data-testid="server-time">
        API time: {props.serverTime}
      </p>
    </section>
  );
};

export default Home;
