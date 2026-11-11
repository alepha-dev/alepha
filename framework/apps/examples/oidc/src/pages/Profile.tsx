import { useAuth } from "alepha/react/auth";
import { Link } from "alepha/react/router";

const Profile = () => {
  const { user, logout } = useAuth();

  return (
    <main>
      <h1>Profile</h1>
      <dl>
        <dt>Name</dt>
        <dd data-testid="name">{user?.name}</dd>
        <dt>Email</dt>
        <dd data-testid="email">{user?.email}</dd>
        <dt>Subject</dt>
        <dd data-testid="sub">{user?.id}</dd>
      </dl>
      <p>
        <Link href="/">Home</Link>
      </p>
      <button type="button" onClick={() => logout()}>
        Sign out
      </button>
    </main>
  );
};

export default Profile;
