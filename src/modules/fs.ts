import { copyFileSync, rmSync, mkdirSync, renameSync } from "fs"
import path from "path"

export class FsModule {
  copy(p: Record<string, string>)   { mkdirSync(path.dirname(p.dst), { recursive: true }); copyFileSync(p.src, p.dst) }
  move(p: Record<string, string>)   { mkdirSync(path.dirname(p.dst), { recursive: true }); renameSync(p.src, p.dst) }
  delete(p: Record<string, string>) { rmSync(p.path, { recursive: true, force: true }) }
  mkdir(p: Record<string, string>)  { mkdirSync(p.path, { recursive: true }) }
}
