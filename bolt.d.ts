/**
 * Type declarations for Bolt plugins.
 * Import as: import { PluginBase, handler } from "boltstack";
 */

declare module "boltstack" {
  export interface SpawnResult {
  	exitCode: number;
  	stdout: string;
  	stderr: string;
  }
  export interface SpawnOptions {
  	cwd?: string;
  	env?: Record<string, string>;
  	/** Called with each chunk of stdout/stderr output, for logging to file. */
  	onOutput?: (text: string) => void;
  }
  export interface Runtime {
  	/** Spawn a process and wait for completion */
  	spawn(cmd: string[], opts?: SpawnOptions): Promise<SpawnResult>;
  	/** Spawn a process synchronously */
  	spawnSync(cmd: string[], opts?: SpawnOptions): SpawnResult;
  	/** Execute a shell command */
  	shell(command: string, opts?: SpawnOptions): Promise<SpawnResult>;
  	/** Parse YAML string */
  	parseYaml(text: string): unknown;
  }
  /** Subset of Logger exposed to plugin handlers. */
  export interface BoltLogger {
  	info(msg: string): void;
  	warn(msg: string): void;
  	error(msg: string): void;
  	debug(msg: string): void;
  	cmd(msg: string): void;
  }
  export interface RepoConfig {
  	path: string;
  	vcs: "git" | "svn";
  	url?: string;
  	branch?: string;
  }
  export interface Project {
  	name: string;
  	engine_repo: RepoConfig;
  	project_repo: RepoConfig;
  	uproject: string;
  	use_tortoise?: boolean;
  	[key: string]: string | boolean | undefined | RepoConfig;
  }
  /** Subset of BoltConfig exposed to external plugin/library consumers. */
  export interface BoltPluginConfig {
  	project: Project;
  	vars: Record<string, string>;
  }
  /** Public plugin context — uses narrow BoltPluginConfig to avoid leaking internals. */
  export interface BoltPluginContext {
  	cfg: BoltPluginConfig;
  	configDir: string;
  	dryRun: boolean;
  	logger: BoltLogger;
  	runtime: Runtime;
  }
  export type BoltPluginHandler = (params: Record<string, string>, ctx: BoltPluginContext) => Promise<void>;
  export type DescribeFunction = (handler: string, params: Record<string, string>) => string | undefined;
  export interface BoltPlugin {
  	namespace: string;
  	handlers: Record<string, BoltPluginHandler>;
  	describe?: DescribeFunction;
  }
  export interface RunOptions {
  	config?: BoltPluginConfig;
  	configPath?: string;
  	cwd?: string;
  	dryRun?: boolean;
  }
  /**
   * Method decorator — mark a method as a plugin handler.
   * Only decorated methods are exposed as handlers by PluginBase.
   *
   * @param description  Optional description template for `bolt ai`.
   * @param alias        Optional handler name override (defaults to method name).
   */
  export declare function handler(description?: string, alias?: string): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;
  /**
   * Base class for class-based plugins.
   * Only methods decorated with @handler() are exposed as handlers.
   */
  export declare abstract class PluginBase implements BoltPlugin {
  	abstract namespace: string;
  	descriptor?: PluginDescriptor<any>;
  	config?: unknown;
  	deps?: Record<string, BoltPlugin>;
  	get handlers(): Record<string, BoltPluginHandler>;
  	describe(handler: string, params: Record<string, string>): string | undefined;
  	onInit?(ctx: BoltPluginContext): Promise<void>;
  	onBeforeStep?(handlerName: string, params: Record<string, string>, ctx: BoltPluginContext): Promise<void>;
  	onAfterStep?(handlerName: string, params: Record<string, string>, ctx: BoltPluginContext): Promise<void>;
  	static withDescriptor<TConfig = unknown>(desc: PluginDescriptor<TConfig>): {
  		new (config?: TConfig, deps?: Record<string, BoltPlugin>): PluginBase & {
  			config: TConfig | undefined;
  			deps: Record<string, BoltPlugin> | undefined;
  			descriptor: PluginDescriptor<TConfig>;
  		};
  	};
  }
  export interface PluginDescriptor<TConfig = unknown> {
  	namespace: string;
  	version: string;
  	description: string;
  	configSchema?: import("zod").ZodType<TConfig>;
  	deps?: string[];
  }
  /**
   * Define a plugin descriptor. Pass to `PluginBase.withDescriptor()`.
   */
  export declare function definePlugin<TConfig = unknown>(opts: PluginDescriptor<TConfig>): PluginDescriptor<TConfig>;
  /**
   * Parameter decorator — document a named parameter for a handler method.
   */
  export declare function param(name: string, description: string): (target: any, propertyKey: string, parameterIndex: number) => void;
  /** Optional lifecycle hooks for class-based plugins. */
  export interface PluginLifecycleHooks {
  	onInit?(ctx: BoltPluginContext): Promise<void>;
  	onBeforeStep?(handlerName: string, params: Record<string, string>, ctx: BoltPluginContext): Promise<void>;
  	onAfterStep?(handlerName: string, params: Record<string, string>, ctx: BoltPluginContext): Promise<void>;
  }
}
