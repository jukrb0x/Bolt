import "./virtual-module"; // Register "boltstack" virtual module before anything loads plugins
import { defineCommand, renderUsage, runMain, type CommandDef } from "citty";
import { cleanupInstalledBolt } from "./commands/update";
import { commands } from "./commands";
import { VERSION } from "./version";
import { checkCommandName, checkGlobalArgs } from "./global-args";
import { loadUsageConfig, printUsageError, USAGE_EXIT_CODE } from "./commands/run";
import { requestsJson } from "./agent-run";
import { findConfig } from "./discover";
import {
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issueFromCliMessage,
  JSON_SCHEMA,
} from "./json-envelope";
import {
  leafAllowsParams,
  parseStrictArgs,
  parseStrictArgsOrExit,
  resolveLeafCommand,
  specFromCittyArgs,
  UsageError,
} from "./strict-args";
import { installProcessGuards } from "./process-guards";

if (process.platform === "win32") cleanupInstalledBolt(process.execPath);

const main = defineCommand({
  meta: {
    name: "bolt",
    version: VERSION,
    description: "Bolt - build and workflow automation for game development",
  },
  subCommands: commands,
});

/**
 * citty builds the usage line from the parent's and the command's meta.name only, so a
 * nested command would read "plugin new" and a nameless one falls back to the script path
 * (`/$bunfs/root/bolt`). Prefix the full command path instead: "bolt plugin new".
 */
async function showUsage(cmd: CommandDef<any>, parent?: CommandDef<any>): Promise<void> {
  const argv = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const path: string[] = [];
  let node: CommandDef<any> = main;
  for (const name of argv) {
    if (node === cmd) break;
    const subs = (node.subCommands ?? {}) as Record<string, CommandDef<any>>;
    if (!Object.hasOwn(subs, name)) break;
    path.push(name);
    node = subs[name];
  }
  const parentName = ["bolt", ...path.slice(0, -1)].join(" ");
  const fakeParent = parent ? { meta: { name: parentName, version: VERSION } } : undefined;
  console.log(`${await renderUsage(cmd, fakeParent as CommandDef<any> | undefined)}\n`);
}

const argv = process.argv.slice(2);
const globalError = checkGlobalArgs(argv);
if (globalError) {
  printUsageError(globalError);
  process.exit(USAGE_EXIT_CODE);
}

const first = argv.find((arg) => !arg.startsWith("-"));
const needsProjectNames =
  first !== undefined &&
  !Object.hasOwn(commands, first) &&
  first !== "help" &&
  first !== "update" &&
  first !== "upgrade";

const usage = needsProjectNames ? await loadUsageConfig() : undefined;
const projectNames =
  usage?.kind === "loaded"
    ? [...Object.keys(usage.cfg.tasks), ...Object.keys(usage.cfg.flows)]
    : undefined;

const commandError = checkCommandName(argv, main, projectNames);
if (commandError) {
  printUsageError(commandError);
  process.exit(USAGE_EXIT_CODE);
}

// BOLT-CLI-1: every leaf command rejects unknown and reserved flags before citty runs.
const leaf = resolveLeafCommand(argv, main);
if (leaf) {
  const command = leaf.path.join(" ");
  const args = (leaf.def.args ?? {}) as Record<
    string,
    { type?: string; alias?: string | string[] }
  >;
  const spec = specFromCittyArgs(command, args, { allowParams: leafAllowsParams(leaf.path) });
  // Validate only; discard the result. citty still parses for most commands; run/inspect
  // re-parse via parseRunArgsOrExit so values stay in one place.
  // This check exits before the command runs, so agent JSON has to be emitted here.
  if (command === "run" && requestsJson(leaf.rest)) {
    try {
      parseStrictArgs(leaf.rest, spec);
    } catch (error) {
      if (error instanceof UsageError) {
        installJsonStdoutGuard();
        emitJsonAndExit({
          schema: JSON_SCHEMA.run,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(await findConfig(process.cwd())),
          data: null,
          errors: [issueFromCliMessage("USAGE", error.message)],
        });
      }
      throw error;
    }
  } else {
    parseStrictArgsOrExit(leaf.rest, spec);
  }
}

installProcessGuards();
runMain(main, { showUsage });
