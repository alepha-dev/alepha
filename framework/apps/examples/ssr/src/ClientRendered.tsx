export interface ClientRenderedProps {
  message: string;
}

const ClientRendered = (props: ClientRenderedProps) => {
  return (
    <div>
      <h1>Client rendered</h1>
      <p id="message">{props.message}</p>
    </div>
  );
};

export default ClientRendered;
