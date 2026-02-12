import { expect, test } from "bun:test"
import { Logger } from "./logger"

test("info logs with prefix", () => {
  const lines: string[] = []
  const logger = new Logger({ sink: (l) => lines.push(l) })
  logger.info("hello")
  expect(lines[0]).toContain("hello")
})

test("error logs with prefix", () => {
  const lines: string[] = []
  const logger = new Logger({ sink: (l) => lines.push(l) })
  logger.error("bad")
  expect(lines[0]).toContain("bad")
})
