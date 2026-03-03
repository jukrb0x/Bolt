import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import type { InitAnswers } from "./InitApp";
import { interpolateTemplate } from "./interpolate";
import { removeInitSection } from "./template-parser";

export interface GenerateOptions extends InitAnswers {
  location: string;
}

export interface GenerateResult {
  ok: true;
  path: string;
}

export interface GenerateError {
  ok: false;
  error: string;
}

export type GeneratorResult = GenerateResult | GenerateError;

/**
 * Generate bolt.yaml from template with answers.
 * Template is required and processed through interpolate + removeInitSection pipeline.
 */
export function generateConfig(
  answers: GenerateOptions,
  templateContent: string
): GeneratorResult {
  const targetDir = path.isAbsolute(answers.location)
    ? answers.location
    : path.join(process.cwd(), answers.location);

  // Create directory if it doesn't exist
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `Failed to create directory: ${err}` };
    }
  }

  const configPath = path.join(targetDir, "bolt.yaml");

  // Check if bolt.yaml already exists
  if (existsSync(configPath)) {
    return { ok: false, error: `bolt.yaml already exists at ${configPath}` };
  }

  // 1. Interpolate variables using ${{ _init.var }} syntax
  const interpolated = interpolateTemplate(templateContent, answers);

  // 2. Remove _init section from output
  const finalContent = removeInitSection(interpolated);

  try {
    writeFileSync(configPath, finalContent, "utf8");
    return { ok: true, path: configPath };
  } catch (err) {
    return { ok: false, error: `Failed to write config: ${err}` };
  }
}
