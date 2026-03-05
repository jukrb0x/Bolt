import { Box, Text, useInput } from "ink";
import { useState, useEffect } from "react";

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
  const [ready, setReady] = useState(false);

  // Delay input handling to avoid processing buffered keys from previous component
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useInput((input, key) => {
    if (!ready) return;

    // Navigate up: up arrow or 'k'
    if (key.upArrow || input === "k") {
      setCursor((c) => (c - 1 + options.length) % options.length);
      return;
    }

    // Navigate down: down arrow or 'j'
    if (key.downArrow || input === "j") {
      setCursor((c) => (c + 1) % options.length);
      return;
    }

    // Toggle selection with space (multi-select only)
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

    // Submit with Enter
    if (key.return) {
      if (multi) {
        onSubmit(Array.from(selected));
      } else {
        // For single-select, return the option under cursor
        onSubmit(options[cursor]);
      }
      return;
    }
  });

  // Keyboard hint based on mode
  const hint = multi
    ? "j/k to navigate, space to toggle, enter to confirm"
    : "j/k to navigate, enter to confirm";

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color="cyan">?</Text>
        <Text bold>{label}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {options.map((option, idx) => {
          const isCursor = idx === cursor;
          const isSelected = selected.has(option);

          // Cursor indicator and selection indicator
          const cursorIndicator = isCursor ? "❯" : " ";
          const selectionIndicator = isSelected ? "◉" : "○";

          return (
            <Box key={option}>
              <Text
                bold={isCursor}
                color={isCursor ? "cyan" : undefined}
              >
                {cursorIndicator} {selectionIndicator} {option}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  );
}
