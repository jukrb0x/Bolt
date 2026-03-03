// src/init/template-parser.ts
import { YAML } from "bun";
import type { InitSection, ParsedTemplate } from "./template-types";

export function extractInitSection(yamlContent: string): InitSection | undefined {
  const parsed = YAML.parse(yamlContent) as Record<string, unknown> | null;
  if (parsed && typeof parsed._init === "object" && parsed._init !== null) {
    return parsed._init as InitSection;
  }
  return undefined;
}

export function findVariables(content: string): Set<string> {
  const pattern = /\$\{\{\s*_init\.(\w+)\s*\}\}/g;
  const vars = new Set<string>();
  let match;
  while ((match = pattern.exec(content)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

export function parseTemplate(content: string): ParsedTemplate {
  const initSection = extractInitSection(content) || {};
  const variables = findVariables(content);
  return { content, initSection, variables };
}

export function removeInitSection(yamlContent: string): string {
  const parsed = YAML.parse(yamlContent) as Record<string, unknown> | null;
  if (parsed && "_init" in parsed) {
    delete parsed._init;
  }
  return YAML.stringify(parsed, null, 2);
}
