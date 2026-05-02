import { NestedView } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";

export const AuthLayout = () => {
  return (
    <>
      <ColorScheme />
      <div className="bg-background flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          <NestedView />
        </div>
      </div>
    </>
  );
};
