import { Box, Text } from "ink";
import { useState, useCallback, useMemo } from "react";
import { existsSync } from "fs";
import path from "path";
import { parseTemplate } from "./template-parser";
import { evaluateCondition } from "./condition-eval";
import type { InitSection, InitQuestion } from "./template-types";
import { QuestionHistory } from "./components/QuestionHistory";
import { Input } from "./components/Input";
import { Confirm } from "./components/Confirm";
import { Select } from "./components/Select";

export interface InitOptions {
  location: "." | string | null;
  template?: string;
  remote?: string;
  nonInteractive?: boolean;
}

// Generic answers type - no longer tied to specific fields
export type InitAnswers = Record<string, string | boolean | string[]>;

interface AnsweredQuestion {
  prompt: string;
  answer: string | boolean | string[];
}

interface InitAppProps {
  options: InitOptions;
  templateContent: string;
  onComplete: (answers: InitAnswers & { location: string }) => void;
}

export function InitApp({ options, templateContent, onComplete }: InitAppProps) {
  const [answers, setAnswers] = useState<InitAnswers>({});
  const [history, setHistory] = useState<AnsweredQuestion[]>([]);
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(
    options.location === "." ? process.cwd() : options.location ?? null
  );
  const [error, setError] = useState<string | null>(null);

  // Parse template once
  const parsedTemplate = useMemo(() => parseTemplate(templateContent), [templateContent]);
  const initSection = parsedTemplate.initSection;

  // Get ordered question keys
  const getOrderedQuestions = (section: InitSection): string[] => {
    return Object.keys(section);
  };

  // Filter questions by condition
  const filterByCondition = (
    key: string,
    section: InitSection,
    currentAnswers: InitAnswers
  ): boolean => {
    const question = section[key];
    if (!question?.condition) return true;
    return evaluateCondition(question.condition, currentAnswers);
  };

  // Determine which questions to show based on conditions
  // Also filter out questions that are already answered (e.g., bolt_project_name from location prompt)
  // Always use index 0 as current question - when answer is added, question is filtered out
  // and next question naturally becomes index 0
  const visibleQuestionKeys = useMemo(() => {
    const allKeys = getOrderedQuestions(initSection);
    return allKeys.filter((key) => {
      // Skip if already answered
      if (key in answers) return false;
      // Check condition
      return filterByCondition(key, initSection, answers);
    });
  }, [initSection, answers]);

  // Always use first unanswered question (index 0)
  const currentKey = visibleQuestionKeys[0];
  const currentQuestion = currentKey ? initSection[currentKey] : undefined;
  const isComplete = visibleQuestionKeys.length === 0 && resolvedLocation !== null;

  const handleAnswer = useCallback(
    (key: string, value: string | boolean | string[], prompt: string) => {
      setAnswers((prev) => ({ ...prev, [key]: value }));
      setHistory((prev) => [...prev, { prompt, answer: value }]);
    },
    []
  );

  // Compute dynamic defaults based on previous answers
  const getComputedDefault = useCallback(
    (key: string, q: InitQuestion): string | boolean | string[] | undefined => {
      // For uproject, compute from project_repo_path and bolt_project_name
      if (key === "uproject") {
        const projectPath = answers.project_repo_path as string | undefined;
        const projectName = answers.bolt_project_name as string | undefined;
        if (projectPath && projectName) {
          return `${projectPath}/${projectName}.uproject`;
        }
      }
      // Fall back to template default
      return q.default;
    },
    [answers]
  );

  // Handle location question first if not provided
  if (resolvedLocation === null) {
    // Show error if exists
    if (error) {
      return (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Input
          label="Project name"
          placeholder="my-project"
          defaultValue="my-project"
          onSubmit={(value) => {
            const targetPath = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
            const configPath = path.join(targetPath, "bolt.yaml");

            // Check if bolt.yaml already exists
            if (existsSync(configPath)) {
              setError(`bolt.yaml already exists at ${configPath}`);
              return;
            }

            setResolvedLocation(value);
            setAnswers((prev) => ({ ...prev, bolt_project_name: value }));
            setHistory((prev) => [...prev, { prompt: "Project name", answer: value }]);
          }}
        />
      </Box>
    );
  }

  // All questions answered
  if (isComplete || !currentQuestion) {
    setTimeout(() => {
      onComplete({ ...answers, location: resolvedLocation! });
    }, 0);

    return (
      <Box>
        <Text color="cyan">✓</Text>
        <Text> Creating bolt.yaml...</Text>
      </Box>
    );
  }

  const renderQuestion = (key: string, q: InitQuestion) => {
    const prompt = q.prompt;
    const defaultValue = getComputedDefault(key, q);
    const type = q.type || "text";

    switch (type) {
      case "text":
        return (
          <Input
            key={key}
            label={prompt}
            placeholder={typeof defaultValue === "string" ? defaultValue : undefined}
            defaultValue={typeof defaultValue === "string" ? defaultValue : undefined}
            onSubmit={(value) => handleAnswer(key, value, prompt)}
          />
        );

      case "confirm":
        return (
          <Confirm
            key={key}
            label={prompt}
            defaultValue={typeof defaultValue === "boolean" ? defaultValue : false}
            onSubmit={(value) => handleAnswer(key, value, prompt)}
          />
        );

      case "select":
        return (
          <Select
            key={key}
            label={prompt}
            options={q.options || []}
            multi={Array.isArray(defaultValue)}
            defaultValue={Array.isArray(defaultValue) ? defaultValue : typeof defaultValue === "string" ? [defaultValue] : []}
            onSubmit={(value) => handleAnswer(key, value, prompt)}
          />
        );
    }
  };

  return (
    <Box flexDirection="column">
      <QuestionHistory history={history} />
      {currentQuestion && renderQuestion(currentKey, currentQuestion)}
    </Box>
  );
}
