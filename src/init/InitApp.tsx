import { Box, Text } from "ink";
import { useState, useCallback } from "react";
import { questions, type Question, type InitAnswers } from "./questions";
import { Input } from "./components/Input";
import { Confirm } from "./components/Confirm";
import { Select } from "./components/Select";

export interface InitOptions {
  location: "." | string | null;
  template?: string;
  remote?: string;
  nonInteractive?: boolean;
}

interface InitAppProps {
  options: InitOptions;
  onComplete: (answers: InitAnswers & { location: string }) => void;
}

export function InitApp({ options, onComplete }: InitAppProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<InitAnswers>>({});
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(
    options.location === "." ? process.cwd() : options.location ?? null
  );

  // Determine which questions to show based on conditions
  const visibleQuestions = questions.filter((q) => {
    if (!q.condition) return true;
    return q.condition(answers);
  });

  const currentQuestion = visibleQuestions[step];
  const isComplete = step >= visibleQuestions.length && resolvedLocation !== null;

  const handleAnswer = useCallback(
    (key: string, value: string | boolean | string[]) => {
      setAnswers((prev) => ({ ...prev, [key]: value }));
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
          }}
        />
      </Box>
    );
  }

  // All questions answered
  if (isComplete || !currentQuestion) {
    const finalAnswers: InitAnswers = {
      bolt_project_name: answers.bolt_project_name || "",
      engine_repo_path: answers.engine_repo_path || "./engine",
      engine_repo_vcs: answers.engine_repo_vcs || "git",
      engine_repo_url: answers.engine_repo_url || "",
      engine_repo_branch: answers.engine_repo_branch || "main",
      project_repo_path: answers.project_repo_path || "./project",
      project_repo_vcs: answers.project_repo_vcs || "svn",
      project_repo_url: answers.project_repo_url || "",
      uproject: answers.uproject || "",
      targets: answers.targets || ["editor"],
      notifications: answers.notifications || false,
      webhook_url: answers.webhook_url || "",
    };

    setTimeout(() => {
      onComplete({ ...finalAnswers, location: resolvedLocation! });
    }, 0);

    return (
      <Box>
        <Text color="cyan">✓</Text>
        <Text> Creating bolt.yaml...</Text>
      </Box>
    );
  }

  const renderQuestion = (q: Question) => {
    const defaultProps = {
      label: q.label,
      defaultValue: typeof q.default === "string" ? q.default : undefined,
    };

    switch (q.type) {
      case "text":
        return (
          <Input
            {...defaultProps}
            placeholder={q.placeholder}
            onSubmit={(value) => handleAnswer(q.key, value)}
          />
        );

      case "confirm":
        return (
          <Confirm
            label={q.label}
            defaultValue={typeof q.default === "boolean" ? q.default : false}
            onSubmit={(value) => handleAnswer(q.key, value)}
          />
        );

      case "select":
        return (
          <Select
            label={q.label}
            options={q.options || []}
            multi={q.multi}
            defaultValue={Array.isArray(q.default) ? q.default : []}
            onSubmit={(value) => handleAnswer(q.key, value)}
          />
        );
    }
  };

  return (
    <Box flexDirection="column">
      {renderQuestion(currentQuestion)}
    </Box>
  );
}
