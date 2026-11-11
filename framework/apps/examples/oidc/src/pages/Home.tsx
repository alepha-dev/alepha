import { useAuth } from "alepha/react/auth";
import { Link } from "alepha/react/router";

const Home = () => {
  const { user, logout } = useAuth();

  return (
    <main>
      <h1>OIDC example</h1>
      {user ? (
        <>
          <p data-testid="greeting">Signed in as {user.name}</p>
          <p>
            <Link href="/profile">Profile</Link>
          </p>
          <button type="button" onClick={() => logout()}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <p data-testid="greeting">Nobody is signed in.</p>
          <p>
            <Link href="/profile">Profile</Link> (signed-in only)
          </p>
        </>
      )}
    </main>
  );
};

export default Home;
