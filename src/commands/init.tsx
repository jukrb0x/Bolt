import { defineCommand } from "citty";
import { render } from "ink";
import pc from "picocolors";
import React from "react";
import path from "path";
import { existsSync } from "fs";
import { InitApp, type InitOptions, type InitAnswers } from "../init/InitApp";
import { loadTemplate } from "../init/template";
import { generateConfig } from "../init/generator";

export default defineCommand({
  meta: {
    description: "Initialize a new bolt.yaml with interactive Q&A",
  },
  args: {
    location: {
      type: "positional",
      description: "Location: '.' for CWD, or folder name to create",
      required: false,
    },
    template: {
      type: "string",
      alias: "t",
      description: "Path to template yaml file",
    },
    remote: {
      type: "string",
      alias: "r",
      description: "URL to remote template",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip Q&A, use defaults",
      default: false,
    },
  },
  async run({ args }) {
    const location = args.location as string | undefined;
    const template = args.template as string | undefined;
    const remote = args.remote as string | undefined;
    const nonInteractive = args.yes as boolean;

    // Resolve location early
    let targetLocation: string | null = null;
    if (location === ".") {
      targetLocation = process.cwd();
    } else if (location) {
      targetLocation = path.isAbsolute(location) ? location : path.join(process.cwd(), location);
    }

    // Check for existing bolt.yaml BEFORE asking questions (if location is known)
    if (targetLocation) {
      const configPath = path.join(targetLocation, "bolt.yaml");
      if (existsSync(configPath)) {
        console.error(pc.red(`Error: bolt.yaml already exists at ${configPath}`));
        process.exit(1);
      }
    }

    // Always load template (bundled fallback is used if no explicit template)
    const templateResult = await loadTemplate({ remote, template });
    if (!templateResult.ok) {
      console.error(pc.red(`Error: ${templateResult.error}`));
      process.exit(1);
    }
    const templateContent = templateResult.content;

    // Non-interactive mode: use defaults
    if (nonInteractive) {
      let folderName: string;
      let finalLocation: string;

      if (location === ".") {
        folderName = path.basename(process.cwd());
        finalLocation = process.cwd();
      } else if (location) {
        folderName = path.basename(location);
        finalLocation = targetLocation!;
      } else {
        folderName = "new-project";
        finalLocation = folderName;
      }

      const defaultAnswers: InitAnswers & { location: string } = {
        bolt_project_name: folderName,
        engine_repo_path: "./engine",
        engine_repo_vcs: "git",
        engine_repo_url: "",
        engine_repo_branch: "main",
        project_repo_path: "./project",
        project_repo_vcs: "svn",
        project_repo_url: "",
        uproject: `./project/${folderName}.uproject`,
        targets: ["editor"],
        notifications: false,
        webhook_url: "",
        location: finalLocation,
      };

      const result = generateConfig(defaultAnswers, templateContent);
      if (!result.ok) {
        console.error(pc.red(`Error: ${result.error}`));
        process.exit(1);
      }

      console.log(pc.green(`✓ Created bolt.yaml at ${result.path}`));
      process.exit(0);
    }

    // Interactive mode - resolve location for InitApp
    const resolvedLocation: "." | string | null = location === "." ? "." : location || null;

    const options: InitOptions = {
      location: resolvedLocation,
      template,
      remote,
      nonInteractive,
    };

    const { waitUntilExit } = render(
      React.createElement(InitApp, {
        options,
        templateContent,
        onComplete: (answers) => {
          const result = generateConfig(answers, templateContent);
          if (!result.ok) {
            console.error(pc.red(`Error: ${result.error}`));
            process.exit(1);
          }
          console.log(pc.green(`✓ Created bolt.yaml at ${result.path}`));
          process.exit(0);
        },
      }),
      { exitOnCtrlC: false }
    );

    await waitUntilExit();
  },
});
