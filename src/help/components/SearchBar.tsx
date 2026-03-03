import { Box, Text, useInput } from "ink";
import { useState, useEffect } from "react";
import pc from "picocolors";

interface SearchBarProps {
  active: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function SearchBar({
  active,
  query,
  onQueryChange,
  onSubmit,
  onCancel,
}: SearchBarProps) {
  const [localQuery, setLocalQuery] = useState(query);

  useEffect(() => {
    if (active) {
      setLocalQuery(query);
    }
  }, [active, query]);

  useInput(
    (input, key) => {
      if (!active) return;

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.return) {
        onSubmit();
        return;
      }

      if (key.backspace || key.delete) {
        const newQuery = localQuery.slice(0, -1);
        setLocalQuery(newQuery);
        onQueryChange(newQuery);
        return;
      }

      // Only accept printable characters
      if (input.length === 1 && input.charCodeAt(0) >= 32) {
        const newQuery = localQuery + input;
        setLocalQuery(newQuery);
        onQueryChange(newQuery);
      }
    },
    { isActive: active }
  );

  if (!active) {
    return null;
  }

  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">
        /
      </Text>
      <Box marginLeft={1}>
        <Text>{localQuery}</Text>
        <Text backgroundColor="white" color="black">
          {" "}
        </Text>
      </Box>
    </Box>
  );
}
