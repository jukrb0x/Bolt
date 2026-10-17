/**
 * ue/diagnose_uat: one actionable diagnosis from a UAT or Cook log.
 * "Unknown Cook Failure" is the AutomationTool wrapper. The cause is an earlier
 * cook, shader, or crash line. A bare "Error:" line is not a cause.
 */
import { readFileSync } from "fs";
import { ok, skipped, warn, type HandlerResult } from "../plugin";

export interface CookFinding {
  code: string;
  message: string;
  fix: string;
  line: number;
}

/** ponytail: one winner by a fixed rank, last line of that rank. A cook trace that links a crash to the package on the stack would replace this. */
const RANK = { package: 1, shader: 2, cook: 3, crash: 4 } as const;

const WRAPPER = /unknown cook failure|Error_UnknownCookFailure/i;

interface Hit extends CookFinding {
  rank: number;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}

function packagePath(token: string): string {
  return token.replace(/[.,;:]+$/, "");
}

function wrapperOnly(text: string): boolean {
  const flat = text.replace(/\s+/g, " ").trim();
  return WRAPPER.test(flat) && flat.length < 80 && !/\/(?:Game|Engine)\//.test(flat);
}

function missingPackage(detail: string, line: number): Hit | undefined {
  const match =
    /couldn'?t find file for package\s+(\/[A-Za-z0-9_./-]+)(?:\s+requested by\s+(\/[A-Za-z0-9_./-]+))?/i.exec(
      detail,
    );
  if (!match) return undefined;
  const pkg = packagePath(match[1]);
  const requested = match[2] ? packagePath(match[2]) : undefined;
  return {
    rank: RANK.package,
    line,
    code: "UE_COOK_MISSING_PACKAGE",
    message: requested
      ? `Cook failed because ${pkg} is missing (requested by ${requested}).`
      : `Cook failed because ${pkg} is missing.`,
    fix: requested
      ? `Restore or retarget ${pkg}, which ${requested} references, then cook again.`
      : `Restore or retarget ${pkg}, then cook again.`,
  };
}

function cookError(detail: string, line: number): Hit | undefined {
  if (wrapperOnly(detail)) return undefined;
  return (
    missingPackage(detail, line) ?? {
      rank: RANK.cook,
      line,
      code: "UE_COOK_ERROR",
      message: `Cook error: ${clip(detail, 160)}`,
      fix: "Fix the cook error at this log line, then cook again.",
    }
  );
}

function crash(body: string, line: number): Hit {
  const file = /\[File:\s*(.+?)\s*\]/i.exec(body);
  const lineRef = /\[Line:\s*(\d+)\s*\]/i.exec(body);
  const rest = clip(body.replace(/\[File:.*?\]/gi, "").replace(/\[Line:.*?\]/gi, ""), 120);
  const base = file ? file[1].split(/[/\\]/).pop() || file[1] : "";
  const where = base ? `${base}${lineRef ? `:${lineRef[1]}` : ""}` : "";
  const message = where
    ? rest
      ? `Cook crashed in ${where}: ${rest}`
      : `Cook crashed in ${where}.`
    : `Cook crashed: ${rest || "fatal error"}`;
  return {
    rank: RANK.crash,
    line,
    code: "UE_COOK_FATAL",
    message: clip(message, 180),
    fix: "Fix the crash named in this message, then cook again.",
  };
}

function classify(line: string, lineNo: number): Hit | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const cook = /LogCook:\s*Error:\s*(.+)$/i.exec(trimmed);
  if (cook) return cookError(cook[1], lineNo);
  const shader = /LogShaderCompilers:\s*Error:\s*(.+)$/i.exec(trimmed);
  if (shader && !wrapperOnly(shader[1])) {
    return {
      rank: RANK.shader,
      line: lineNo,
      code: "UE_COOK_SHADER",
      message: `Shader compile failed: ${clip(shader[1], 140)}`,
      fix: "Fix the shader or material named in that compiler error, then cook again.",
    };
  }
  const fatal = /Fatal error:\s*(.*)$/i.exec(trimmed);
  if (fatal) return crash(fatal[1], lineNo);
  const assertion = /Assertion failed:\s*(.*)$/i.exec(trimmed);
  if (assertion) return crash(assertion[1], lineNo);
  return undefined;
}

function better(next: Hit, best: Hit | undefined): boolean {
  if (!best) return true;
  return next.rank < best.rank || (next.rank === best.rank && next.line > best.line);
}

export function diagnoseCookLog(text: string): CookFinding | undefined {
  const lines = text.split(/\r?\n/);
  let best: Hit | undefined;
  let wrapperLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (!wrapperLine && WRAPPER.test(lines[i])) wrapperLine = lineNo;
    const hit = classify(lines[i], lineNo);
    if (hit && better(hit, best)) best = hit;
  }
  if (best) return { code: best.code, message: best.message, fix: best.fix, line: best.line };
  if (!wrapperLine) return undefined;
  return {
    code: "UE_COOK_UNKNOWN_ROOTCAUSE",
    line: wrapperLine,
    message: "Cook ended as Unknown Cook Failure with no package, shader, or crash line above it.",
    fix: "Re-run the cook and keep the full log. Unknown Cook Failure is the wrapper, not the cause.",
  };
}

export function diagnoseUatLog(logPath: string): HandlerResult {
  const trimmed = logPath.trim();
  if (!trimmed) return skipped("diagnose log path is missing");
  let text: string;
  try {
    text = readFileSync(trimmed, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return warn("Could not read cook log", {
      diagnostics: [
        {
          level: "warn",
          code: "UE_COOK_LOG_UNREADABLE",
          message: `Could not read cook log: ${message}`,
          file: trimmed,
        },
      ],
    });
  }
  const found = diagnoseCookLog(text);
  if (!found) return ok("no cook failure in log");
  return ok(clip(found.message, 200), {
    diagnostics: [
      {
        level: "error",
        code: found.code,
        message: found.message,
        fix: found.fix,
        file: trimmed,
        line: found.line,
      },
    ],
  });
}
