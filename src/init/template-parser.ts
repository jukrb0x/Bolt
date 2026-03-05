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
  // Use text-based approach to preserve comments
  // Find and remove the _init section (top-level key with optional nested content)
  // Pattern: _init: followed by content until next top-level key or end of file
  const lines = yamlContent.split("\n");
  const result: string[] = [];
  let inInitSection = false;
  let skipInitComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || "";

    // Check for start of _init section (top-level key, no indentation)
    if (/^_init\s*:/.test(line)) {
      inInitSection = true;
      continue;
    }

    // Check for comment that precedes _init section
    // Look ahead to see if next non-empty, non-comment line is _init:
    if (/^\s*#/.test(line) && !inInitSection) {
      let foundInit = false;
      for (let j = i + 1; j < lines.length; j++) {
        const lookAhead = lines[j];
        if (/^\s*#/.test(lookAhead)) continue; // skip comments
        if (/^\s*$/.test(lookAhead)) continue; // skip blank lines
        if (/^_init\s*:/.test(lookAhead)) {
          foundInit = true;
        }
        break;
      }
      if (foundInit) {
        skipInitComment = true;
        continue;
      }
    }

    // Check for next top-level key (no indentation, contains colon)
    // This ends the _init section
    if (inInitSection && /^[a-zA-Z_]\w*\s*:/.test(line)) {
      inInitSection = false;
      skipInitComment = false;
    }

    // Skip lines that are part of _init section
    if (inInitSection || skipInitComment) {
      continue;
    }

    result.push(line);
  }

  // Clean up multiple blank lines
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
