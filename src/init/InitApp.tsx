import { Box, Text } from "ink";
import { useState, useCallback, useMemo } from "react";
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
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<InitAnswers>({});
  const [history, setHistory] = useState<AnsweredQuestion[]>([]);
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(
    options.location === "." ? process.cwd() : options.location ?? null
  );

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
  const visibleQuestionKeys = useMemo(() => {
    const allKeys = getOrderedQuestions(initSection);
    return allKeys.filter((key) => filterByCondition(key, initSection, answers));
  }, [initSection, answers]);

  const currentKey = visibleQuestionKeys[step];
  const currentQuestion = currentKey ? initSection[currentKey] : undefined;
  const isComplete = step >= visibleQuestionKeys.length && resolvedLocation !== null;

  const handleAnswer = useCallback(
    (key: string, value: string | boolean | string[], prompt: string) => {
      setAnswers((prev) => ({ ...prev, [key]: value }));
      setHistory((prev) => [...prev, { prompt, answer: value }]);
      setStep((s) => s + 1);
    },
    []
  );

  // Handle location question first if not provided
  if (resolvedLocation === null) {
    return (
      <Box flexDirection="column">
        <Input
          label="Project name"
          placeholder="my-project"
          onSubmit={(value) => {
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
    const defaultValue = q.default;
    const type = q.type || "text";

    switch (type) {
      case "text":
        return (
          <Input
            label={prompt}
            placeholder={typeof defaultValue === "string" ? defaultValue : undefined}
            defaultValue={typeof defaultValue === "string" ? defaultValue : undefined}
            onSubmit={(value) => handleAnswer(key, value, prompt)}
          />
        );

      case "confirm":
        return (
          <Confirm
            label={prompt}
            defaultValue={typeof defaultValue === "boolean" ? defaultValue : false}
            onSubmit={(value) => handleAnswer(key, value, prompt)}
          />
        );

      case "select":
        return (
          <Select
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
