import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface ConfirmProps {
  label: string;
  defaultValue?: boolean;
  onSubmit: (value: boolean) => void;
}

export function Confirm({ label, defaultValue = false, onSubmit }: ConfirmProps) {
  const [selected, setSelected] = useState(defaultValue);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(selected);
      return;
    }

    if (key.leftArrow || key.upArrow || input === "h" || input === "y") {
      setSelected(true);
      return;
    }

    if (key.rightArrow || key.downArrow || input === "l" || input === "n") {
      setSelected(false);
      return;
    }

    if (input.toLowerCase() === "y") {
      setSelected(true);
      onSubmit(true);
      return;
    }

    if (input.toLowerCase() === "n") {
      setSelected(false);
      onSubmit(false);
      return;
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
      <Box marginLeft={2} gap={2}>
        <Text
          bold={selected}
          color={selected ? "green" : undefined}
        >
          {selected ? "◉ " : "○ "}Yes
        </Text>
        <Text
          bold={!selected}
          color={!selected ? "red" : undefined}
        >
          {!selected ? "◉ " : "○ "}No
        </Text>
      </Box>
    </Box>
  );
}
