// src/tests/init/condition-eval.test.ts
import { expect, test } from "bun:test";
import { evaluateCondition } from "../../init/condition-eval";

test("evaluates equality condition", () => {
  const answers = { engine_repo_vcs: "git" };
  expect(evaluateCondition("engine_repo_vcs == 'git'", answers)).toBe(true);
  expect(evaluateCondition("engine_repo_vcs == 'svn'", answers)).toBe(false);
});

test("evaluates inequality condition", () => {
  const answers = { engine_repo_vcs: "git" };
  expect(evaluateCondition("engine_repo_vcs != 'svn'", answers)).toBe(true);
  expect(evaluateCondition("engine_repo_vcs != 'git'", answers)).toBe(false);
});

test("returns true for empty condition", () => {
  const answers = {};
  expect(evaluateCondition("", answers)).toBe(true);
  expect(evaluateCondition(undefined, answers)).toBe(true);
});

test("handles boolean values", () => {
  const answers = { notifications: "true" };
  expect(evaluateCondition("notifications == 'true'", answers)).toBe(true);
});

test("handles actual boolean type in answers", () => {
  const answers = { enabled: true };
  expect(evaluateCondition("enabled == 'true'", answers)).toBe(true);
  expect(evaluateCondition("enabled == 'false'", answers)).toBe(false);
});

test("handles missing answer keys", () => {
  const answers = {};
  expect(evaluateCondition("missing == 'value'", answers)).toBe(false);
  expect(evaluateCondition("missing == 'undefined'", answers)).toBe(true);
});

test("handles double quotes", () => {
  const answers = { vcs: "git" };
  expect(evaluateCondition('vcs == "git"', answers)).toBe(true);
  expect(evaluateCondition('vcs == "svn"', answers)).toBe(false);
});

test("rejects mismatched quote pairs", () => {
  const answers = { vcs: "git" };
  // Mismatched quotes should not match, defaulting to true
  expect(evaluateCondition('vcs == \'git"', answers)).toBe(true);
  expect(evaluateCondition('vcs == "git\'', answers)).toBe(true);
});
