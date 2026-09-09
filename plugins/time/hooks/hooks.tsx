import type { Register } from "claude-code";

export const register: Register = (on) => {
  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e);
    const time = new Date().toTimeString().slice(0, 8);
    return (
      <Box flexDirection="column">
        <Text color="#a78bfa">⏱ {time}</Text>
        {await next(e)}
      </Box>
    );
  });
};
