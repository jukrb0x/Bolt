// src/init/components/QuestionHistory.tsx
import { Box, Text } from "ink";

interface AnsweredQuestion {
  prompt: string;
  answer: string | boolean | string[];
}

interface QuestionHistoryProps {
  history: AnsweredQuestion[];
}

export function QuestionHistory({ history }: QuestionHistoryProps) {
  if (history.length === 0) return null;

  return (
    <Box flexDirection="column">
      {history.map((item, idx) => (
        <Box key={idx} flexDirection="column">
          <Box gap={1}>
            <Text bold color="cyan">?</Text>
            <Text bold>{item.prompt}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              {typeof item.answer === "boolean"
                ? item.answer ? "Yes" : "No"
                : Array.isArray(item.answer)
                  ? item.answer.join(", ")
                  : item.answer}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
