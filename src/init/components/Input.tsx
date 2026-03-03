import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface InputProps {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}

export function Input({ label, placeholder, defaultValue = "", onSubmit }: InputProps) {
  const [value, setValue] = useState(defaultValue);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value || defaultValue);
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    if (input.length === 1 && input.charCodeAt(0) >= 32) {
      setValue((v) => v + input);
    }
  });

  const showPlaceholder = !value && placeholder;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color="cyan">
          ?
        </Text>
        <Text bold>{label}</Text>
        {defaultValue && !value && (
          <Text dimColor>(default: {defaultValue})</Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor={showPlaceholder}>
          {showPlaceholder ? placeholder : value}
        </Text>
        <Text color="cyan" bold>▌</Text>
      </Box>
    </Box>
  );
}
