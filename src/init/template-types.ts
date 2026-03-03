// src/init/template-types.ts
export type QuestionType = "text" | "select" | "confirm";

export interface InitQuestion {
  prompt: string;
  type?: QuestionType;
  default?: string | boolean | string[];
  options?: string[];        // for select type
  required?: boolean;
  condition?: string;        // expression like "engine_repo_vcs == 'git'"
}

export interface InitSection {
  [key: string]: InitQuestion;
}

export interface ParsedTemplate {
  content: string;           // raw template content
  initSection: InitSection;  // parsed _init section
  variables: Set<string>;    // all ${{ _init.var }} references found
}
