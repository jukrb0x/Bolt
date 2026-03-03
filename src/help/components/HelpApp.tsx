#!/usr/bin/env bun
/**
 * HelpApp - Interactive help system with man-style navigation
 */

import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useRef, useState, useCallback, useEffect } from "react";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import pc from "picocolors";
import { topics, getTopic } from "../content";
import type { HelpTopic } from "../types";
import { Content } from "./Content";
import { StatusBar } from "./StatusBar";
import { SearchBar } from "./SearchBar";

interface HelpAppProps {
  initialTopic?: string;
}

type Mode = "normal" | "search" | "toc";

export function HelpApp({ initialTopic }: HelpAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const scrollRef = useRef<ScrollViewRef>(null);

  const rows = stdout?.rows || 24;
  const cols = stdout?.columns || 80;
  const tocWidth = 22;

  // Header = 1 line, StatusBar = 3 lines (border top/bottom + content), SearchBar = 3 lines when active
  const statusBarHeight = 3;
  const headerHeight = 1;
  const contentHeight = Math.max(5, rows - headerHeight - statusBarHeight);

  // State
  const [currentTopic, setCurrentTopic] = useState<HelpTopic>(() =>
    initialTopic ? getTopic(initialTopic) : topics[0]
  );
  const [mode, setMode] = useState<Mode>("normal");
  const [searchQuery, setSearchQuery] = useState("");
  const [tocIndex, setTocIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  // Handle terminal resize
  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure();
    stdout?.on("resize", handleResize);
    return () => stdout?.off("resize", handleResize);
  }, [stdout]);

  // Handle keyboard input
  useInput((input, key) => {
    if (mode === "search") return;

    if (mode === "toc") {
      if (input === "j" || key.downArrow) {
        setTocIndex((prev) => Math.min(topics.length - 1, prev + 1));
      } else if (input === "k" || key.upArrow) {
        setTocIndex((prev) => Math.max(0, prev - 1));
      } else if (key.return) {
        setCurrentTopic(topics[tocIndex]);
        setMode("normal");
        scrollRef.current?.scrollToTop();
      } else if (input === "t" || key.escape) {
        setMode("normal");
      } else if (input === "q") {
        exit();
      }
      return;
    }

    // Normal mode
    if (input === "q" || key.escape) {
      exit();
      return;
    }

    if (input === "t") {
      setMode((prev) => prev === "toc" ? "normal" : "toc");
      return;
    }

    if (input === "/") {
      setMode("search");
      return;
    }

    const topicNum = parseInt(input);
    if (topicNum >= 1 && topicNum <= topics.length) {
      setCurrentTopic(topics[topicNum - 1]);
      scrollRef.current?.scrollToTop();
      return;
    }

    if (searchQuery) {
      if (input === "n") {
        setCurrentMatch((prev) => (prev < matchCount ? prev + 1 : 1));
        return;
      }
      if (input === "N") {
        setCurrentMatch((prev) => (prev > 1 ? prev - 1 : matchCount));
        return;
      }
    }

    // Scrolling
    if (input === "j" || key.downArrow) scrollRef.current?.scrollBy(1);
    else if (input === "k" || key.upArrow) scrollRef.current?.scrollBy(-1);
    else if (input === "d") scrollRef.current?.scrollBy(10);
    else if (input === "u") scrollRef.current?.scrollBy(-10);
    else if (input === "f" || key.pageDown) scrollRef.current?.scrollBy(20);
    else if (input === "b" || key.pageUp) scrollRef.current?.scrollBy(-15);
    else if (input === "g" || key.home) scrollRef.current?.scrollToTop();
    else if (input === "G" || key.end) scrollRef.current?.scrollToBottom();
  });

  const handleSearchSubmit = useCallback(() => setMode("normal"), []);
  const handleSearchCancel = useCallback(() => {
    setSearchQuery("");
    setMode("normal");
  }, []);

  // Calculate widths
  const mainWidth = mode === "toc" ? cols - tocWidth - 1 : cols;
  const contentPadding = 1;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* Header - single line with cyan text */}
      <Box width={cols}>
        <Text bgCyan black bold>
          {" Bolt Help "}
        </Text>
        <Text> </Text>
        <Text bold>{currentTopic.title}</Text>
        <Text color="gray" dimColor> ─ </Text>
        <Text dimColor>v0.1.2</Text>
      </Box>

      {/* Main area */}
      <Box flexDirection="row" width={cols} height={contentHeight}>
        {/* TOC */}
        {mode === "toc" && (
          <Box
            flexDirection="column"
            width={tocWidth}
            borderColor="gray"
            borderStyle="single"
            paddingX={1}
          >
            <Text bold underline color="gray">Topics</Text>
            <Box height={1} />
            {topics.map((t, idx) => (
              <Text
                key={t.id}
                bold={tocIndex === idx}
                color={tocIndex === idx ? "cyan" : currentTopic.id === t.id ? "white" : "gray"}
              >
                {tocIndex === idx ? "> " : "  "}{t.title}
              </Text>
            ))}
            <Box height={1} />
            <Text dimColor>j/k nav Enter sel</Text>
            <Text dimColor>t/Esc close</Text>
          </Box>
        )}

        {/* Content */}
        <Box flexDirection="column" flexGrow={1} width={mainWidth} paddingLeft={contentPadding}>
          <ScrollView ref={scrollRef}>
            <Content topic={currentTopic} searchQuery={searchQuery} />
          </ScrollView>
        </Box>
      </Box>

      {/* Search */}
      <SearchBar
        active={mode === "search"}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onSubmit={handleSearchSubmit}
        onCancel={handleSearchCancel}
      />

      {/* Status */}
      <StatusBar
        topic={currentTopic}
        showTOC={mode === "toc"}
        searchMode={mode === "search"}
        matchCount={matchCount}
        currentMatch={currentMatch}
      />
    </Box>
  );
}
