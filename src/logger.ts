import pc from "picocolors";
import { createWriteStream, type WriteStream } from "fs";

type Sink = (line: string) => void;

interface LoggerOptions {
  sink?: Sink;
  logFile?: string;
}

export class Logger {
  private sink: Sink;
  private file?: WriteStream;

  constructor(opts: LoggerOptions = {}) {
    this.sink = opts.sink ?? ((l) => process.stdout.write(l + "\n"));
    if (opts.logFile) {
      this.file = createWriteStream(opts.logFile, { flags: "a" });
    }
  }

  info(msg: string) {
    this.log("INFO", (s) => pc.green(s), msg);
  }
  warn(msg: string) {
    this.log("WARN", (s) => pc.yellow(s), msg);
  }
  error(msg: string) {
    this.log("ERROR", (s) => pc.red(s), msg);
  }
  debug(msg: string) {
    this.log("DEBUG", (s) => pc.dim(s), msg);
  }

  cmd(msg: string) {
    const line = `  $ ${msg}`;
    this.sink(pc.dim(line));
    this.file?.write(line + "\n");
  }

  step(name: string) {
    this.sink(pc.blue(`>> ${name}`));
    this.file?.write(`>> ${name}\n`);
  }

  step_detail(text: string) {
    const line = `   · ${text}`;
    this.sink(pc.dim(line));
    this.file?.write(line + "\n");
  }

  success(name: string, dur: number) {
    this.sink(`${pc.blue("<<")} ${name}: ${pc.green("SUCCESS")} (${dur.toFixed(1)}s)`);
    this.file?.write(`<< ${name}: SUCCESS (${dur.toFixed(1)}s)\n`);
  }

  fail(name: string, dur: number) {
    this.sink(`${pc.blue("<<")} ${name}: ${pc.red("FAILED")} (${dur.toFixed(1)}s)`);
    this.file?.write(`<< ${name}: FAILED (${dur.toFixed(1)}s)\n`);
  }

  /** Write raw text (e.g. child-process output) to the log file only. */
  writeRaw(text: string) {
    this.file?.write(text);
  }

  close() {
    this.file?.end();
  }

  private log(level: string, colour: (s: string) => string, msg: string) {
    const line = `[${colour(level)}] ${msg}`;
    this.sink(line);
    this.file?.write(`[${level}] ${msg}\n`);
  }
}
