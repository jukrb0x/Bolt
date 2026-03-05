import { Box, Text, useInput, useApp } from "ink";
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
  const { exit } = useApp();

  // Find initial cursor position based on default value
  const getInitialCursor = (): number => {
    if (defaultValue.length > 0) {
      const idx = options.indexOf(defaultValue[0]);
      if (idx >= 0) return idx;
    }
    return 0;
  };

  const [cursor, setCursor] = useState(getInitialCursor);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultValue));
  const [ready, setReady] = useState(false);

  // Delay input handling to avoid processing buffered keys from previous component
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useInput(
    (input, key) => {
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

      // Space key: select/toggle current option (no submit)
      if (input === " ") {
        if (multi) {
          // Multi-select: toggle current option
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
        } else {
          // Single-select: select current option (visual only)
          setSelected(new Set([options[cursor]]));
        }
        return;
      }

      // Submit with Enter
      if (key.return) {
        if (multi) {
          onSubmit(Array.from(selected));
        } else {
          // Single-select: submit selected option (or cursor position if none selected)
          const selectedOption = Array.from(selected)[0] || options[cursor];
          onSubmit(selectedOption);
        }
        return;
      }

      // Ctrl-C: exit
      if (key.ctrl && input === "c") {
        exit();
        return;
      }
    },
    { isActive: ready }
  );

  // Keyboard hint based on mode
  const hint = multi
    ? "j/k to navigate, space to toggle, enter to confirm"
    : "j/k to navigate, space to select, enter to confirm";

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

          // Visual indicators differ by mode
          // Single-select: dots (○ / ●)
          // Multi-select: boxes (☐ / ☑)
          const cursorIndicator = isCursor ? "❯" : " ";
          const selectionIndicator = multi
            ? (isSelected ? "☑" : "☐")
            : (isSelected ? "●" : "○");

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
