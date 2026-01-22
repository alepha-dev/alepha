export const webHelloComponentTsx = () =>
  `
interface Props {
  message: string;
}

const Hello = (props: Props) => {
  return (
    <div>
      <h1>{props.message}</h1>
      <p>Edit this component in src/web/components/Hello.tsx</p>
    </div>
  );
};

export default Hello;
`.trim();
