/**
 * UE INI File Handler
 *
 * Handles Unreal Engine's special INI format with support for:
 * - Section-based key-value pairs
 * - Array values with +prefix (e.g., +Key=Value)
 * - Removal markers with -prefix (e.g., -Key=Value)
 * - Comment lines starting with ;
 */

import { existsSync } from "fs";

/** Represents a parsed INI file structure */
export interface UEIniData {
  [section: string]: {
    [key: string]: string | string[];
  };
}

/** Options for INI operations */
export interface IniReadOptions {
  /** Type to coerce values to (default: string) */
  valueType?: "string" | "number" | "boolean";
}

export interface IniWriteOptions {
  /** Insert new sections at the front of file instead of appending */
  sectionInsertFront?: boolean;
}

/**
 * Strip comment from a line (everything after ;)
 */
function stripComment(line: string): string {
  const commentIdx = line.indexOf(";");
  return commentIdx >= 0 ? line.substring(0, commentIdx) : line;
}

/**
 * Parse a key name, stripping + or - prefix if present
 */
function parseKeyName(rawKey: string): { prefix: string | null; key: string } {
  const trimmed = rawKey.trim();
  if (trimmed.length > 0 && (trimmed[0] === "+" || trimmed[0] === "-")) {
    return { prefix: trimmed[0], key: trimmed.substring(1).trim() };
  }
  return { prefix: null, key: trimmed };
}

/**
 * Coerce a string value to the specified type
 */
function coerceValue(value: string, type: "string" | "number" | "boolean"): string | number | boolean {
  if (type === "number") {
    const num = Number(value);
    return isNaN(num) ? value : num;
  }
  if (type === "boolean") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
    return value;
  }
  return value;
}

/**
 * Read an INI file and return all data as a structured object
 */
export async function readIniAll(filePath: string, options?: IniReadOptions): Promise<UEIniData> {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = await Bun.file(filePath).text();
  const lines = content.split(/\r?\n/);
  const result: UEIniData = {};
  const valueType = options?.valueType ?? "string";

  let currentSection: string | null = null;

  for (const line of lines) {
    const stripped = stripComment(line).trim();
    if (stripped.length === 0) continue;

    // Section header
    if (stripped[0] === "[" && stripped[stripped.length - 1] === "]") {
      currentSection = stripped.substring(1, stripped.length - 1).trim();
      if (currentSection && !(currentSection in result)) {
        result[currentSection] = {};
      }
      continue;
    }

    // Key-value pair
    if (currentSection !== null) {
      const eqIdx = stripped.indexOf("=");
      if (eqIdx > 0) {
        const rawKey = stripped.substring(0, eqIdx).trim();
        const rawValue = stripped.substring(eqIdx + 1).trim();
        const { prefix, key } = parseKeyName(rawKey);
        const value = coerceValue(rawValue, valueType);

        if (!key) continue;

        const section = result[currentSection];
        if (prefix === "+" || prefix === "-") {
          // Array value
          if (!(key in section)) {
            section[key] = [];
          }
          const arr = section[key];
          if (Array.isArray(arr)) {
            arr.push(value as string);
          }
        } else {
          // Single value
          section[key] = value as string;
        }
      }
    }
  }

  return result;
}

/**
 * Read a specific key value from an INI file
 * Returns single value or array if multiple +prefixed entries exist
 */
export async function readIni(
  filePath: string,
  section: string,
  key: string,
  options?: IniReadOptions,
): Promise<string | number | boolean | (string | number | boolean)[] | undefined> {
  const data = await readIniAll(filePath, options);
  const sectionData = data[section];
  if (!sectionData) return undefined;
  return sectionData[key];
}

/**
 * Parse an INI file into lines with metadata for manipulation
 */
interface ParsedLine {
  raw: string;
  type: "empty" | "comment" | "section" | "key-value";
  section?: string;
  key?: string;
  prefix?: string;
  value?: string;
}

function parseIniLines(content: string): ParsedLine[] {
  const lines = content.split(/\r?\n/);
  const result: ParsedLine[] = [];
  let currentSection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line
    if (trimmed.length === 0) {
      result.push({ raw: line, type: "empty" });
      continue;
    }

    // Comment line
    if (trimmed[0] === ";") {
      result.push({ raw: line, type: "comment" });
      continue;
    }

    // Section header
    if (trimmed[0] === "[" && trimmed[trimmed.length - 1] === "]") {
      currentSection = trimmed.substring(1, trimmed.length - 1).trim();
      result.push({ raw: line, type: "section", section: currentSection });
      continue;
    }

    // Key-value pair
    const commentIdx = trimmed.indexOf(";");
    const lineWithoutComment = commentIdx >= 0 ? trimmed.substring(0, commentIdx).trim() : trimmed;

    const eqIdx = lineWithoutComment.indexOf("=");
    if (eqIdx > 0 && currentSection !== null) {
      const rawKey = lineWithoutComment.substring(0, eqIdx).trim();
      const value = lineWithoutComment.substring(eqIdx + 1).trim();
      const { prefix, key } = parseKeyName(rawKey);

      result.push({
        raw: line,
        type: "key-value",
        section: currentSection,
        key,
        prefix: prefix ?? undefined,
        value,
      });
      continue;
    }

    // Unknown line, preserve as-is
    result.push({ raw: line, type: "comment" });
  }

  return result;
}

/**
 * Serialize parsed lines back to string
 */
function serializeLines(lines: ParsedLine[]): string {
  return lines.map((l) => l.raw).join("\n");
}

/**
 * Find line indices for a section
 */
function findSectionRange(lines: ParsedLine[], sectionName: string): { start: number; end: number } {
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === "section") {
      if (start === -1) {
        if (line.section === sectionName) {
          start = i;
        }
      } else {
        end = i;
        break;
      }
    }
  }

  return { start, end };
}

/**
 * Find all line indices for a key within a section range
 */
function findKeyLines(
  lines: ParsedLine[],
  sectionStart: number,
  sectionEnd: number,
  keyName: string,
): number[] {
  const result: number[] = [];

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const line = lines[i];
    if (line.type === "key-value" && line.key === keyName) {
      result.push(i);
    }
  }

  return result;
}

/**
 * Remove a key from a section in an INI file
 */
export async function removeSectionKey(
  filePath: string,
  section: string,
  key: string,
): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false;
  }

  const content = await Bun.file(filePath).text();
  const lines = parseIniLines(content);
  const { start: sectionStart, end: sectionEnd } = findSectionRange(lines, section);

  if (sectionStart === -1) {
    return false; // Section not found
  }

  const keyLines = findKeyLines(lines, sectionStart, sectionEnd, key);
  if (keyLines.length === 0) {
    return false; // Key not found
  }

  // Remove lines in reverse order to preserve indices
  for (let i = keyLines.length - 1; i >= 0; i--) {
    lines.splice(keyLines[i], 1);
  }

  const newContent = serializeLines(lines);
  await Bun.write(filePath, newContent);
  return true;
}

/**
 * Set a key value in a section
 * For array values, use array notation which generates +Key=Value lines
 */
export async function setSectionKeyValue(
  filePath: string,
  section: string,
  key: string,
  value: string | number | boolean | (string | number | boolean)[] | null,
  options?: IniWriteOptions,
): Promise<void> {
  let content = "";

  if (existsSync(filePath)) {
    content = await Bun.file(filePath).text();
  }

  const lines = parseIniLines(content);
  const { start: sectionStart, end: sectionEnd } = findSectionRange(lines, section);

  // Build new key-value line(s)
  let newLines: string[];
  if (value === null || value === undefined) {
    newLines = [];
  } else if (Array.isArray(value)) {
    newLines = value.map((v) => `+${key}=${v}`);
  } else {
    newLines = [`${key}=${value}`];
  }

  if (sectionStart !== -1) {
    // Section exists, find existing key lines
    const keyLines = findKeyLines(lines, sectionStart, sectionEnd, key);

    if (keyLines.length > 0) {
      // Replace first occurrence, remove others
      if (newLines.length > 0) {
        lines[keyLines[0]] = {
          raw: newLines[0],
          type: "key-value",
          section,
          key,
          prefix: newLines[0][0] === "+" ? "+" : undefined,
          value: newLines[0].substring(newLines[0].indexOf("=") + 1),
        };

        // Insert additional lines after the first one
        for (let i = 1; i < newLines.length; i++) {
          const newLine: ParsedLine = {
            raw: newLines[i],
            type: "key-value",
            section,
            key,
            prefix: "+",
            value: newLines[i].substring(newLines[i].indexOf("=") + 1),
          };
          lines.splice(keyLines[0] + i, 0, newLine);
        }

        // Remove remaining old key lines (adjust indices for insertions)
        for (let i = keyLines.length - 1; i >= 1; i--) {
          const adjustedIdx = keyLines[i] + (newLines.length - 1);
          lines.splice(adjustedIdx, 1);
        }
      } else {
        // Remove all key lines (value is null)
        for (let i = keyLines.length - 1; i >= 0; i--) {
          lines.splice(keyLines[i], 1);
        }
      }
    } else {
      // Key doesn't exist, insert after section header
      const insertIdx = sectionStart + 1;
      for (let i = 0; i < newLines.length; i++) {
        const newLine: ParsedLine = {
          raw: newLines[i],
          type: "key-value",
          section,
          key,
          prefix: newLines[i][0] === "+" ? "+" : undefined,
          value: newLines[i].substring(newLines[i].indexOf("=") + 1),
        };
        lines.splice(insertIdx + i, 0, newLine);
      }
    }
  } else {
    // Section doesn't exist, create it
    const sectionLine: ParsedLine = {
      raw: `[${section}]`,
      type: "section",
      section,
    };
    const keyValueLines: ParsedLine[] = newLines.map((l) => ({
      raw: l,
      type: "key-value" as const,
      section,
      key,
      prefix: l[0] === "+" ? "+" : undefined,
      value: l.substring(l.indexOf("=") + 1),
    }));

    if (options?.sectionInsertFront) {
      // Insert at beginning
      let insertIdx = 0;
      lines.splice(insertIdx, 0, sectionLine);
      insertIdx++;
      for (const kvLine of keyValueLines) {
        lines.splice(insertIdx, 0, kvLine);
        insertIdx++;
      }
    } else {
      // Append at end
      // Add blank line before new section if file is not empty
      if (lines.length > 0 && lines[lines.length - 1].type !== "empty") {
        lines.push({ raw: "", type: "empty" });
      }
      lines.push(sectionLine);
      for (const kvLine of keyValueLines) {
        lines.push(kvLine);
      }
    }
  }

  const newContent = serializeLines(lines);
  await Bun.write(filePath, newContent);
}

/**
 * Override target INI with values from override INI
 * Removes existing keys first, then applies new values
 */
export async function overrideIniData(targetPath: string, overridePath: string): Promise<void> {
  const overrideData = await readIniAll(overridePath);

  // First, remove all existing keys that will be overridden
  for (const [section, keys] of Object.entries(overrideData)) {
    for (const key of Object.keys(keys)) {
      await removeSectionKey(targetPath, section, key);
    }
  }

  // Then, set the new values
  for (const [section, keys] of Object.entries(overrideData)) {
    for (const [key, value] of Object.entries(keys)) {
      // Skip empty string values
      if (typeof value === "string" && value === "") continue;
      await setSectionKeyValue(targetPath, section, key, value);
    }
  }
}

/**
 * Get all section names from an INI file
 */
export async function getSections(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = await Bun.file(filePath).text();
  const sections: string[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed[0] === "[" && trimmed[trimmed.length - 1] === "]") {
      sections.push(trimmed.substring(1, trimmed.length - 1).trim());
    }
  }

  return sections;
}
