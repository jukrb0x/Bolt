import { Box, Text, useInput, useApp } from "ink";
import { useState, useEffect } from "react";

interface InputProps {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}

export function Input({ label, placeholder, defaultValue = "", onSubmit }: InputProps) {
  const { exit } = useApp();
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [ready, setReady] = useState(false);

  // Delay input handling to avoid processing buffered keys from previous component
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useInput(
    (input, key) => {
      if (!ready) return;

      // Ctrl-C: clear input if there's content, otherwise exit
      if (key.ctrl && input === "c") {
        if (value) {
          setValue("");
          setCursorPos(0);
        } else {
          exit();
        }
        return;
      }

      if (key.return) {
        // Use defaultValue if user didn't type anything
        onSubmit(value || defaultValue);
        return;
      }

      // Move cursor left
      if (key.leftArrow) {
        setCursorPos((p) => Math.max(0, p - 1));
        return;
      }

      // Move cursor right
      if (key.rightArrow) {
        setCursorPos((p) => Math.min(value.length, p + 1));
        return;
      }

      // Home: move cursor to start
      if (key.ctrl && input === "a") {
        setCursorPos(0);
        return;
      }

      // End: move cursor to end
      if (key.ctrl && input === "e") {
        setCursorPos(value.length);
        return;
      }

      // Backspace/Delete: delete character before cursor
      // Note: Some terminals report backspace as key.delete
      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos));
          setCursorPos((p) => p - 1);
        }
        return;
      }

      // Accept printable characters (including multi-char paste)
      const printable = [...input].filter((ch) => ch.charCodeAt(0) >= 32).join("");
      if (printable.length > 0) {
        setValue((v) => v.slice(0, cursorPos) + printable + v.slice(cursorPos));
        setCursorPos((p) => p + printable.length);
      }
    },
    { isActive: ready }
  );

  const showPlaceholder = value === "" && placeholder !== undefined;
  const showDefaultHint = defaultValue && !value;

  // Render input with cursor at position
  const renderInput = () => {
    if (showPlaceholder) {
      return (
        <>
          <Text dimColor>{placeholder}</Text>
          <Text color="cyan">█</Text>
        </>
      );
    }

    const beforeCursor = value.slice(0, cursorPos);
    const atCursor = value.slice(cursorPos, cursorPos + 1);
    const afterCursor = value.slice(cursorPos + 1);

    return (
      <>
        <Text>{beforeCursor}</Text>
        <Text color="cyan" inverse>{atCursor || " "}</Text>
        <Text>{afterCursor}</Text>
      </>
    );
  };

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
        {renderInput()}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>enter to confirm, ctrl-c to {value ? "clear" : "exit"}</Text>
      </Box>
    </Box>
  );
}
