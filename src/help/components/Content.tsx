import { Box, Text } from "ink";
import pc from "picocolors";
import type { HelpTopic } from "../types";

interface ContentProps {
  topic: HelpTopic;
  searchQuery: string;
}

function highlightMatch(text: string, query: string, lineKey: string): React.ReactNode[] {
  if (!query) {
    return [text];
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerQuery);
  let matchIndex = 0;

  while (index !== -1) {
    if (index > lastIndex) {
      result.push(text.slice(lastIndex, index));
    }
    result.push(
      <Text key={`${lineKey}-match-${matchIndex++}`} bold color="yellow">
        {text.slice(index, index + query.length)}
      </Text>
    );
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result;
}

export function Content({ topic, searchQuery }: ContentProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {topic.sections.map((section, sectionIndex) => (
        <Box key={section.id} flexDirection="column" marginBottom={sectionIndex < topic.sections.length - 1 ? 1 : 0}>
          <Text bold color="cyan">
            {section.title}
          </Text>
          <Box flexDirection="column" marginTop={0}>
            {section.content.split("\n").map((line, lineIndex) => (
              <Text key={`${section.id}-line-${lineIndex}`}>
                {searchQuery ? highlightMatch(line, searchQuery, `${section.id}-line-${lineIndex}`) : pc.dim(line)}
              </Text>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
