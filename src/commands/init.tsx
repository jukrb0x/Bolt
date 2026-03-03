import { defineCommand } from "citty";
import { render } from "ink";
import pc from "picocolors";
import React from "react";
import path from "path";
import { InitApp, type InitOptions } from "../init/InitApp";
import { loadTemplate } from "../init/template";
import { generateConfig } from "../init/generator";
import type { InitAnswers } from "../init/questions";

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

    // Resolve location
    let resolvedLocation: "." | string | null;
    if (location === ".") {
      resolvedLocation = ".";
    } else if (location) {
      resolvedLocation = location;
    } else {
      resolvedLocation = null;
    }

    // Load template only if explicitly provided
    let templateContent: string | undefined;
    if (template || remote) {
      const templateResult = await loadTemplate({ remote, template });
      if (!templateResult.ok) {
        console.error(pc.red(`Error: ${templateResult.error}`));
        process.exit(1);
      }
      templateContent = templateResult.content;
    }

    // Non-interactive mode: use defaults
    if (nonInteractive) {
      let folderName: string;
      let targetLocation: string;

      if (location === ".") {
        folderName = path.basename(process.cwd());
        targetLocation = process.cwd();
      } else if (location) {
        folderName = path.basename(location);
        targetLocation = location;
      } else {
        folderName = "new-project";
        targetLocation = folderName;
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
        location: targetLocation,
      };

      const result = generateConfig(defaultAnswers, templateContent);
      if (!result.ok) {
        console.error(pc.red(`Error: ${result.error}`));
        process.exit(1);
      }

      console.log(pc.green(`✓ Created bolt.yaml at ${result.path}`));
      process.exit(0);
    }

    // Interactive mode
    const options: InitOptions = {
      location: resolvedLocation,
      template,
      remote,
      nonInteractive,
    };

    const { waitUntilExit } = render(
      React.createElement(InitApp, {
        options,
        onComplete: (answers) => {
          const result = generateConfig(answers, templateContent);
          if (!result.ok) {
            console.error(pc.red(`Error: ${result.error}`));
            process.exit(1);
          }
          console.log(pc.green(`✓ Created bolt.yaml at ${result.path}`));
          process.exit(0);
        },
      })
    );

    await waitUntilExit();
  },
});
