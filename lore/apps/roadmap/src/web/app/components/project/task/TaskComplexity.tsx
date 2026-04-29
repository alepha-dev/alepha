import { Text } from "@alepha/mantine";
import { Card } from "@mantine/core";
import { useInject } from "alepha/react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { theme } from "@/web/app/constants/theme.ts";

export interface TaskComplexityProps {
  complexity: number;
}

const TaskComplexity = (props: TaskComplexityProps) => {
  const { complexity } = props;
  const info = useInject(CharacterInfo);
  const cardProps = {
    p: 0,
    w: 25,
    h: 25,
    radius: "md",
    withBorder: true,
    align: "center",
  };
  const renderComplexityText = (n: number) => {
    return (
      <Text size="md" fw={"bold"} lh={"24px"}>
        {info.getRank(n)}
      </Text>
    );
  };
  if (complexity === 5)
    return (
      <Card
        {...cardProps}
        className={"shadow-2"}
        style={{ borderColor: theme.colors.gold }}
        bg={theme.colors.panel}
      >
        {renderComplexityText(complexity)}
      </Card>
    );
  if (complexity === 4)
    return (
      <Card
        {...cardProps}
        className={"shadow"}
        style={{ borderColor: theme.colors.silver }}
        bg={theme.colors.panel}
      >
        {renderComplexityText(complexity)}
      </Card>
    );
  if (complexity === 3)
    return (
      <Card {...cardProps} className={"shadow"} bg={theme.colors.panel}>
        {renderComplexityText(complexity)}
      </Card>
    );
  if (complexity === 2)
    return (
      <Card {...cardProps} bg={theme.colors.panel}>
        {renderComplexityText(complexity)}
      </Card>
    );
  return (
    <Card {...cardProps} bg={theme.colors.card}>
      {renderComplexityText(complexity)}
    </Card>
  );
};

export default TaskComplexity;
