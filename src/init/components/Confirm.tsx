import { Box, Text, useInput } from "ink";
import { useState, useEffect } from "react";

interface ConfirmProps {
  label: string;
  defaultValue?: boolean;
  onSubmit: (value: boolean) => void;
}

export function Confirm({ label, defaultValue = false, onSubmit }: ConfirmProps) {
  const [selected, setSelected] = useState(defaultValue);
  const [ready, setReady] = useState(false);

  // Delay input handling to avoid processing buffered keys from previous component
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useInput((input, key) => {
    if (!ready) return;

    if (key.return) {
      onSubmit(selected);
      return;
    }

    // Navigate/select Yes: left arrow, up arrow, h, or y
    if (key.leftArrow || key.upArrow || input === "h") {
      setSelected(true);
      return;
    }

    // Navigate/select No: right arrow, down arrow, l, or n
    if (key.rightArrow || key.downArrow || input === "l") {
      setSelected(false);
      return;
    }

    // Quick confirm with 'y'
    if (input.toLowerCase() === "y") {
      setSelected(true);
      onSubmit(true);
      return;
    }

    // Quick reject with 'n'
    if (input.toLowerCase() === "n") {
      setSelected(false);
      onSubmit(false);
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color="cyan">?</Text>
        <Text bold>{label}</Text>
      </Box>
      <Box marginLeft={2} gap={2}>
        <Text bold={selected} color={selected ? "green" : undefined}>
          {selected ? "◉ " : "○ "}Yes
        </Text>
        <Text bold={!selected} color={!selected ? "red" : undefined}>
          {!selected ? "◉ " : "○ "}No
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>y/n or ←/→ to select, enter to confirm</Text>
      </Box>
    </Box>
  );
}
