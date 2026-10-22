import assert from "node:assert/strict";
import test from "node:test";
import { createMetadataDirectoryResolver } from "../src/metadata-directory.ts";

function environment(entries: Array<readonly [string, string]>): Record<string, string> {
  return Object.fromEntries(entries);
}

test("uses a project tmp directory by default", () => {
  const resolve = createMetadataDirectoryResolver((cwd) => `${cwd}/tmp`);

  assert.deepEqual(resolve("/work/project", environment([])), {
    directory: "/work/project/tmp",
    mode: "cwd-tmp",
  });
});

test("accepts an explicit cwd mode override", () => {
  let calls = 0;
  const resolve = createMetadataDirectoryResolver(() => {
    calls += 1;
    return "/tmp/unexpected";
  });

  assert.deepEqual(
    resolve("/work/project", environment([["PI_ITERM2_CURRENT_DIR_MODE", " CWD "]])),
    {
      directory: "/work/project",
      mode: "cwd",
    },
  );
  assert.equal(calls, 0);
});

test("accepts explicit cwd-tmp mode", () => {
  const resolve = createMetadataDirectoryResolver((cwd) => `${cwd}/tmp`);

  assert.deepEqual(
    resolve("/work/project", environment([["PI_ITERM2_CURRENT_DIR_MODE", "cwd-tmp"]])),
    {
      directory: "/work/project/tmp",
      mode: "cwd-tmp",
    },
  );
});

test("reuses one project tmp directory per working directory", () => {
  let calls = 0;
  const resolve = createMetadataDirectoryResolver((cwd) => {
    calls += 1;
    return `${cwd}/tmp`;
  });

  assert.equal(resolve("/work/one", environment([])).directory, "/work/one/tmp");
  assert.equal(resolve("/work/one", environment([])).directory, "/work/one/tmp");
  assert.equal(resolve("/work/two", environment([])).directory, "/work/two/tmp");
  assert.equal(calls, 2);
});

test("unknown modes retain the cwd-tmp default", () => {
  const resolve = createMetadataDirectoryResolver((cwd) => `${cwd}/tmp`);

  assert.equal(
    resolve("/work/project", environment([["PI_ITERM2_CURRENT_DIR_MODE", "unknown"]])).mode,
    "cwd-tmp",
  );
});

test("rejects an empty project temporary-directory result", () => {
  const resolve = createMetadataDirectoryResolver(() => "");

  assert.throws(
    () => resolve("/work/project", environment([])),
    /project temporary directory is empty/,
  );
});
