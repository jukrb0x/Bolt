import { Box, Text, useInput } from "ink";
import { useState, useEffect } from "react";

interface InputProps {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}

export function Input({ label, placeholder, defaultValue = "", onSubmit }: InputProps) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);

  // Delay input handling to avoid processing buffered keys from previous component
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useInput((input, key) => {
    if (!ready) return;

    if (key.return) {
      // Use defaultValue if user didn't type anything
      onSubmit(value || defaultValue);
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    // Only accept printable characters
    if (input.length === 1 && input.charCodeAt(0) >= 32) {
      setValue((v) => v + input);
    }
  });

  const showPlaceholder = !value && placeholder;
  const showDefaultHint = defaultValue && !value;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color="cyan">?</Text>
        <Text bold>{label}</Text>
        {showDefaultHint && (
          <Text dimColor>(default: {defaultValue})</Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor={showPlaceholder}>
          {showPlaceholder ? placeholder : value}
        </Text>
        <Text color="cyan" bold>▌</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>enter to confirm</Text>
      </Box>
    </Box>
  );
}
