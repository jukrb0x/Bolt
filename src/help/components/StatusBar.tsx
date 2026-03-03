import { Box, Text } from "ink";
import pc from "picocolors";
import type { HelpTopic } from "../types";

interface StatusBarProps {
  topic: HelpTopic;
  showTOC: boolean;
  searchMode: boolean;
  matchCount: number;
  currentMatch: number;
}

export function StatusBar({
  topic,
  showTOC,
  searchMode,
  matchCount,
  currentMatch,
}: StatusBarProps) {
  if (searchMode) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          {pc.bold("Enter")} confirm {pc.bold("Esc")} cancel {pc.bold("Ctrl+C")} quit
        </Text>
      </Box>
    );
  }

  const searchInfo =
    matchCount > 0 ? ` [${currentMatch}/${matchCount}]` : "";

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>
        {pc.bold("1-5")} topics {pc.bold("j/k")} scroll {pc.bold("d/u")} half{" "}
        {pc.bold("f/b")} page {pc.bold("g/G")} top/btm {pc.bold("/")} search{searchInfo}{" "}
        {pc.bold("t")} TOC {pc.bold("q")} quit
      </Text>
      {showTOC && (
        <Box marginLeft={2}>
          <Text dimColor>[TOC: {pc.cyan(topic.title)}]</Text>
        </Box>
      )}
    </Box>
  );
}
