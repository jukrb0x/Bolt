import runCmd from "./run";
import listCmd from "./list";
import infoCmd from "./info";
import checkCmd from "./check";
import doctorCmd from "./doctor";
import whyCmd from "./why";
import envCmd from "./env";
import migrateCmd from "./migrate";
import versionCmd from "./version";
import updateCmd from "./update";
import pluginCmd from "./plugin";
import configCmd from "./config";
import inspectCmd from "./inspect";
import initCmd from "./init";
import typesCmd from "./types";
import aiCmd from "./ai";
import statusCmd from "./status";
import sessionCmd from "./session";
import dashCmd from "./dash";

/** Top-level `bolt` subcommands. Used by src/main.ts and the docs generator. */
export const commands = {
  run: runCmd,
  list: listCmd,
  info: infoCmd,
  check: checkCmd,
  doctor: doctorCmd,
  why: whyCmd,
  env: envCmd,
  migrate: migrateCmd,
  config: configCmd,
  init: initCmd,
  types: typesCmd,
  plugin: pluginCmd,
  inspect: inspectCmd,
  status: statusCmd,
  session: sessionCmd,
  dash: dashCmd,
  "self-update": updateCmd,
  ai: aiCmd,
  version: versionCmd,
};

/** Source file (under src/commands) for each top-level subcommand. */
export const commandSources: Record<keyof typeof commands, string> = {
  run: "run.ts",
  list: "list.ts",
  info: "info.ts",
  check: "check.ts",
  doctor: "doctor.ts",
  why: "why.ts",
  env: "env.ts",
  migrate: "migrate.ts",
  config: "config.ts",
  init: "init.ts",
  types: "types.ts",
  plugin: "plugin.ts",
  inspect: "inspect.ts",
  status: "status.ts",
  session: "session.ts",
  dash: "dash.ts",
  "self-update": "update.ts",
  ai: "ai.ts",
  version: "version.ts",
};
