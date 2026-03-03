import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface SelectProps {
  label: string;
  options: string[];
  multi?: boolean;
  defaultValue?: string[];
  onSubmit: (value: string | string[]) => void;
}

export function Select({
  label,
  options,
  multi = false,
  defaultValue = [],
  onSubmit,
}: SelectProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultValue));

  useInput((input, key) => {
    if (key.return) {
      const result = multi ? Array.from(selected) : options[cursor];
      onSubmit(result);
      return;
    }

    if (key.upArrow) {
      setCursor((c) => (c - 1 + options.length) % options.length);
      return;
    }

    if (key.downArrow) {
      setCursor((c) => (c + 1) % options.length);
      return;
    }

    // Toggle with space (key.space or literal space input)
    if (multi && (key.space || input === " ")) {
      const option = options[cursor];
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(option)) {
          next.delete(option);
        } else {
          next.add(option);
        }
        return next;
      });
      return;
    }

    // Single select: immediately select on navigation
    if (!multi && (key.upArrow || key.downArrow)) {
      setSelected(new Set([options[cursor]]));
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color="cyan">
          ?
        </Text>
        <Text bold>{label}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {options.map((option, idx) => {
          const isCursor = idx === cursor;
          const isSelected = selected.has(option);

          return (
            <Box key={option}>
              <Text
                bold={isCursor}
                color={isCursor ? "cyan" : undefined}
              >
                {isCursor ? "❯ " : "  "}
                {multi ? (isSelected ? "◉ " : "○ ") : isSelected ? "◉ " : "○ "}
                {option}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>
          {multi ? "space to toggle, enter to confirm" : "enter to confirm"}
        </Text>
      </Box>
    </Box>
  );
}
