// src/runtime/types.ts

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
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
