import { useAuth } from "alepha/react/auth";

export interface LoginProps {
  redirect: string;
}

/**
 * `login("keycloak")` sends the browser to `/oauth/login`, which redirects to
 * the identity provider. A sign-in is a chain of top-level redirects, so it is
 * never a fetch.
 */
const Login = (props: LoginProps) => {
  const { login } = useAuth();

  return (
    <main>
      <h1>Sign in</h1>
      <button
        type="button"
        onClick={() => login("keycloak", { redirect: props.redirect })}
      >
        Sign in with Keycloak
      </button>
    </main>
  );
};

export default Login;
