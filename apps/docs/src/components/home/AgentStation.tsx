import type { ReactNode } from "react";

export interface AgentStationProps {
  title: string;
  note: ReactNode;
  children: ReactNode;
}

const AgentStation = (props: AgentStationProps) => {
  return (
    <div className="agent-station">
      <h3 className="agent-station-title">{props.title}</h3>
      <div className="agent-artifact">{props.children}</div>
      <p className="agent-station-note">{props.note}</p>
    </div>
  );
};

export default AgentStation;
