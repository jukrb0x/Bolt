/**
 * ue/doctor_ddc: project DefaultEngine.ini DDC section vs engine flavor.
 * An installed engine reads the Installed graph. A source engine reads the other one.
 * This check does not write the ini.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { ok, type HandlerResult, type JsonValue } from "../plugin";

export const DDC_CHECK_ID = "ue.ddc.installed_vs_source";

const SOURCE_SECTION = "DerivedDataBackendGraph";
const INSTALLED_SECTION = "InstalledDerivedDataBackendGraph";
const INSTALLED_MARKER = path.join("Engine", "Build", "InstalledBuild.txt");

interface SectionSpan {
  name: string;
  startLine: number;
  endLine: number;
  keys: number;
}

interface DdcCheck {
  id: string;
  level: "pass" | "info" | "warn" | "error";
  message: string;
  fix?: string;
  path?: string;
  span?: { start_line: number; end_line: number };
}

function parseSections(text: string): SectionSpan[] {
  const lines = text.split(/\r?\n/);
  const sections: SectionSpan[] = [];
  let current: SectionSpan | undefined;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const trimmed = lines[i].replace(/;.*$/, "").trim();
    const header = /^\[([^[\]]+)\]$/.exec(trimmed);
    if (header) {
      if (current) {
        current.endLine = lineNo - 1;
        sections.push(current);
      }
      current = { name: header[1].trim(), startLine: lineNo, endLine: lineNo, keys: 0 };
      continue;
    }
    if (current && trimmed.includes("=")) current.keys += 1;
  }
  if (current) {
    current.endLine = lines.length;
    sections.push(current);
  }
  return sections;
}

/** Pure check. `installed` is true when the engine tree has InstalledBuild.txt. */
export function ddcSectionCheck(input: {
  iniPath: string;
  iniText: string;
  installed: boolean;
}): DdcCheck {
  const active = input.installed ? INSTALLED_SECTION : SOURCE_SECTION;
  const inactive = input.installed ? SOURCE_SECTION : INSTALLED_SECTION;
  const flavor = input.installed ? "installed" : "source";
  const sections = parseSections(input.iniText);
  const activeSec = sections.find((section) => section.name === active);
  const inactiveSec = sections.find((section) => section.name === inactive);
  const activeSet = (activeSec?.keys ?? 0) > 0;
  const inactiveSet = (inactiveSec?.keys ?? 0) > 0;
  if (inactiveSet && !activeSet && inactiveSec) {
    return {
      id: DDC_CHECK_ID,
      level: "error",
      message: `DDC graph is set in [${inactive}] but this ${flavor} engine reads [${active}].`,
      fix: `Move the DDC graph in ${input.iniPath} from [${inactive}] to [${active}].`,
      path: input.iniPath,
      span: { start_line: inactiveSec.startLine, end_line: inactiveSec.endLine },
    };
  }
  if (activeSet) {
    return {
      id: DDC_CHECK_ID,
      level: "pass",
      message: `DDC graph for this ${flavor} engine is in [${active}].`,
      path: input.iniPath,
    };
  }
  return {
    id: DDC_CHECK_ID,
    level: "pass",
    message: `No DDC graph override in ${input.iniPath}.`,
    path: input.iniPath,
  };
}

export function engineIsInstalled(enginePath: string): boolean {
  return existsSync(path.join(enginePath, INSTALLED_MARKER));
}

/** Read the project ini and return one check. Does not mutate the file. */
export function doctorDdcCheck(input: { enginePath: string; projectPath: string }): HandlerResult {
  const iniPath = path.join(input.projectPath, "Config", "DefaultEngine.ini");
  if (!existsSync(iniPath)) {
    return ok("no project DefaultEngine.ini", {
      data: {
        checks: [
          {
            id: DDC_CHECK_ID,
            level: "info",
            message: `No Config/DefaultEngine.ini under ${input.projectPath}.`,
            path: iniPath,
          },
        ],
      },
    });
  }
  const iniText = readFileSync(iniPath, "utf8");
  const check = ddcSectionCheck({
    iniPath,
    iniText,
    installed: engineIsInstalled(input.enginePath),
  });
  return ok(check.message, { data: { checks: [checkRecord(check)] } });
}

function checkRecord(check: DdcCheck): Record<string, JsonValue> {
  const item: Record<string, JsonValue> = {
    id: check.id,
    level: check.level,
    message: check.message,
  };
  if (check.fix) item.fix = check.fix;
  if (check.path) item.path = check.path;
  if (check.span) {
    item.span = { start_line: check.span.start_line, end_line: check.span.end_line };
  }
  return item;
}
