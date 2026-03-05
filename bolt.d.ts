/**
 * Type declarations for Bolt plugins.
 * Import as: import type { BoltPlugin, BoltPluginContext } from "bolt";
 */

declare module "bolt" {
  /**
   * Public API types for Bolt plugins.
   * These are minimal, Zod-free types for plugin developers.
   */
  /** Repository configuration */
  export interface RepoConfig {
  	path: string;
  	vcs: "git" | "svn";
  	url?: string;
  	branch?: string;
  }
  /** Project configuration accessible to plugins via ctx.cfg.project */
  export interface Project {
  	name: string;
  	engine_repo: RepoConfig;
  	project_repo: RepoConfig;
  	uproject: string;
  	use_tortoise?: boolean;
  	/** Extra fields defined in bolt.yaml are accessible as ctx.cfg.project[key] */
  	[key: string]: string | boolean | undefined | RepoConfig;
  }
  /** Minimal config exposed to plugin handlers */
  export interface BoltPluginConfig {
  	project: Project;
  	vars: Record<string, string>;
  }
  /** Logger interface for plugin handlers */
  export interface BoltLogger {
  	info(msg: string): void;
  	warn(msg: string): void;
  	error(msg: string): void;
  	debug(msg: string): void;
  	cmd(msg: string): void;
  }
  /** Context passed to plugin handlers */
  export interface BoltPluginContext {
  	cfg: BoltPluginConfig;
  	dryRun: boolean;
  	logger: BoltLogger;
  }
  /** Handler function signature */
  export type BoltPluginHandler = (params: Record<string, string>, ctx: BoltPluginContext) => Promise<void>;
  /** Plugin definition */
  export interface BoltPlugin {
  	namespace: string;
  	handlers: Record<string, BoltPluginHandler>;
  }
}
