/** @jsx h */
// A time line drawn above another element.
type Elements = { Box: any; Text: any };

const COLOR = "#a78bfa";

export function Timestamp({ Box, Text }: Elements, time: string, below: unknown) {
  return (
    <Box flexDirection="column">
      <Text color={COLOR}>{`⏱ ${time}`}</Text>
      {below}
    </Box>
  );
}
