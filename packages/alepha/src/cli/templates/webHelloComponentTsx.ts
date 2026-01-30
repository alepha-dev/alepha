export const webHelloComponentTsx = (options: { auth?: boolean } = {}) => {
  const imports: string[] = [];

  if (options.auth) {
    imports.push('import { UserButton } from "@alepha/ui/auth";');
  }
  imports.push('import { useState } from "react";');

  const userButton = options.auth ? "\n      <UserButton />" : "";

  return `${imports.join("\n")}

interface Props {
  message?: string;
}

const Hello = (props: Props) => {
  const [message, setMessage] = useState(props.message ?? "");
  return (
    <div>
      <h1>{message}</h1>
      <input value={message} onChange={(e) => setMessage(e.target.value)} />
      <p>Edit this component in src/web/components/Hello.tsx</p>${userButton}
    </div>
  );
};

export default Hello;
`;
};
