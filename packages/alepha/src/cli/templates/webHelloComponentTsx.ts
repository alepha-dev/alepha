export const webHelloComponentTsx = () =>
  `import { useState } from "react";

interface Props {
  message?: string;
}

const Hello = (props: Props) => {
  const [message, setMessage] = useState(props.message ?? "");
  return (
    <div>
      <h1>{message}</h1>
      <input value={message} onChange={e => setMessage(e.target.value)} />
      <p>Edit this component in src/web/components/Hello.tsx</p>
    </div>
  );
};

export default Hello;
`.trim();
