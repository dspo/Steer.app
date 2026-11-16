import { expect, test } from "nsh/test";
import {
  addProjectRoot,
  normalizeRootPath,
  removeProjectRoot,
  rootPayload,
  setPrimaryProjectRoot,
} from "../core/project-roots";

test("a picked path is normalized and must be absolute", () => {
  expect(normalizeRootPath("  /Users/me/Project/  ")).toBe("/Users/me/Project");
  expect(normalizeRootPath("/")).toBe("/");
  expect(normalizeRootPath("relative/path")).toBe(null);
  expect(normalizeRootPath("")).toBe(null);
  expect(normalizeRootPath("/tmp/a\nb")).toBe(null);
});

test("the first picked root is primary and duplicates are ignored", () => {
  let roots = addProjectRoot([], "/tmp/one");
  expect(roots).toEqual([{ path: "/tmp/one", primary: true }]);
  roots = addProjectRoot(roots, "/tmp/two/");
  expect(roots).toEqual([
    { path: "/tmp/one", primary: true },
    { path: "/tmp/two", primary: false },
  ]);
  expect(addProjectRoot(roots, "/tmp/one/")).toEqual(roots);
  expect(addProjectRoot(roots, "not-absolute")).toEqual(roots);
});

test("removing the primary promotes the first remaining root", () => {
  const roots = [
    { path: "/tmp/one", primary: true },
    { path: "/tmp/two", primary: false },
    { path: "/tmp/three", primary: false },
  ];
  expect(removeProjectRoot(roots, "/tmp/one")).toEqual([
    { path: "/tmp/two", primary: true },
    { path: "/tmp/three", primary: false },
  ]);
  expect(removeProjectRoot(roots, "/tmp/two")).toEqual([
    { path: "/tmp/one", primary: true },
    { path: "/tmp/three", primary: false },
  ]);
  expect(removeProjectRoot([{ path: "/tmp/one", primary: true }], "/tmp/one")).toEqual([]);
});

test("setting a primary leaves exactly one, and the payload keeps the flags", () => {
  const roots = [
    { path: "/tmp/one", primary: true },
    { path: "/tmp/two", primary: false },
  ];
  const next = setPrimaryProjectRoot(roots, "/tmp/two");
  expect(next).toEqual([
    { path: "/tmp/one", primary: false },
    { path: "/tmp/two", primary: true },
  ]);
  expect(setPrimaryProjectRoot(roots, "/tmp/missing")).toEqual(roots);
  expect(rootPayload(next)).toEqual([
    { path: "/tmp/one", primary: false },
    { path: "/tmp/two", primary: true },
  ]);
});
