export type QuestionType = "text" | "confirm" | "select";

export interface Question {
  key: string;
  type: QuestionType;
  label: string;
  placeholder?: string;
  default?: string | boolean | string[];
  required?: boolean;
  options?: string[];
  multi?: boolean;
  condition?: (answers: Record<string, unknown>) => boolean;
}

export const questions: Question[] = [
  {
    key: "engine_repo_path",
    type: "text",
    label: "Engine root path",
    placeholder: "./engine",
    default: "./engine",
  },
  {
    key: "engine_repo_vcs",
    type: "select",
    label: "Engine VCS",
    options: ["git", "svn"],
    default: ["git"],
  },
  {
    key: "engine_repo_url",
    type: "text",
    label: "Engine repo URL",
    placeholder: "https://github.com/EpicGames/UnrealEngine.git",
    condition: (answers) => !!answers.engine_repo_url,
  },
  {
    key: "engine_repo_branch",
    type: "text",
    label: "Engine branch",
    default: "main",
    condition: (answers) => answers.engine_repo_vcs === "git",
  },
  {
    key: "project_repo_path",
    type: "text",
    label: "Project root path",
    placeholder: "./project",
    default: "./project",
  },
  {
    key: "project_repo_vcs",
    type: "select",
    label: "Project VCS",
    options: ["git", "svn"],
    default: ["svn"],
  },
  {
    key: "project_repo_url",
    type: "text",
    label: "Project repo URL",
    placeholder: "svn://svn.example.com/project/trunk",
    condition: (answers) => !!answers.project_repo_url,
  },
  {
    key: "uproject",
    type: "text",
    label: ".uproject file path",
    placeholder: "./project/MyGame.uproject",
    required: true,
  },
  {
    key: "targets",
    type: "select",
    label: "Build targets",
    options: ["editor", "client", "server"],
    multi: true,
    default: ["editor"],
  },
  {
    key: "notifications",
    type: "confirm",
    label: "Enable notifications?",
    default: false,
  },
  {
    key: "webhook_url",
    type: "text",
    label: "Webhook URL",
    placeholder: "https://hooks.slack.com/...",
    condition: (answers) => answers.notifications === true,
  },
];

export interface InitAnswers {
  bolt_project_name: string;
  engine_repo_path: string;
  engine_repo_vcs: string;
  engine_repo_url: string;
  engine_repo_branch: string;
  project_repo_path: string;
  project_repo_vcs: string;
  project_repo_url: string;
  uproject: string;
  targets: string[];
  notifications: boolean;
  webhook_url: string;
}
