import { readFileSync, writeFileSync } from "fs"

export class JsonModule {
  set(p: Record<string, string>): void {
    const data = JSON.parse(readFileSync(p.file, "utf8"))
    const keys = p.key.split(".")
    let obj: any = data
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
    obj[keys[keys.length - 1]] = p.value
    writeFileSync(p.file, JSON.stringify(data, null, 2))
  }

  merge(p: Record<string, string>): void {
    const base  = JSON.parse(readFileSync(p.file,  "utf8"))
    const patch = JSON.parse(readFileSync(p.patch, "utf8"))
    writeFileSync(p.file, JSON.stringify({ ...base, ...patch }, null, 2))
  }
}
