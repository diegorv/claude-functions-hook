// A time line drawn above another element.
import type { Elements as EngineElements, RenderChildren } from "claude-code";
type Elements = Pick<EngineElements["terminal"], "Box" | "Text">;

const COLOR = "#a78bfa";

export function Timestamp({ Box, Text }: Elements, time: string, below: RenderChildren) {
  return (
    <Box flexDirection="column">
      <Text color={COLOR}>{`⏱ ${time}`}</Text>
      {below}
    </Box>
  );
}
