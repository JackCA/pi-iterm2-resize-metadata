import assert from "node:assert/strict";
import test from "node:test";
import {
  createMetadataSequence,
  createRedrawInjector,
  FULL_REDRAW_CLEAR,
  hasDirectItermEvidence,
  hasItermTmuxIntegrationEvidence,
  isTmuxEnvironment,
  resolveConfiguration,
  resolveHyperlinkCapability,
  resolveImageCapability,
  resolveItermDiagnostics,
  sanitizeOscValue,
} from "../src/core.ts";

function environment(entries: Array<readonly [string, string]>): Record<string, string> {
  return Object.fromEntries(entries);
}

test("creates iTerm2 RemoteHost and CurrentDir metadata", () => {
  assert.equal(
    createMetadataSequence({ user: "alice", host: "devbox", directory: "/tmp/a b" }),
    "\x1b]1337;RemoteHost=alice@devbox\x07\x1b]1337;CurrentDir=/tmp/a b\x07",
  );
});

test("removes control characters from OSC values", () => {
  assert.equal(sanitizeOscValue("a\x07b\x1bc\nd\x9fe"), "abcde");
});

test("refuses incomplete metadata identities", () => {
  assert.equal(createMetadataSequence({ user: "", host: "host", directory: "/tmp" }), undefined);
  assert.equal(createMetadataSequence({ user: "user", host: "", directory: "/tmp" }), undefined);
  assert.equal(createMetadataSequence({ user: "user", host: "host", directory: "" }), undefined);
});

test("centralizes terminal-path evidence detection", () => {
  assert.equal(hasDirectItermEvidence(environment([["TERM_PROGRAM", "iTerm.app"]])), true);
  assert.equal(hasDirectItermEvidence(environment([["LC_TERMINAL", "iTerm2"]])), true);
  assert.equal(hasDirectItermEvidence(environment([["TERM_PROGRAM", "Apple_Terminal"]])), false);
  assert.equal(isTmuxEnvironment(environment([["TERM", "tmux-256color"]])), true);
  assert.equal(
    hasItermTmuxIntegrationEvidence(
      environment([["ITERM_ENABLE_SHELL_INTEGRATION_WITH_TMUX", "1"]]),
    ),
    true,
  );
});

test("resolves explicit configuration before shell-integration defaults", () => {
  const config = resolveConfiguration(
    environment([
      ["PI_ITERM2_METADATA", "always"],
      ["PI_ITERM2_USER", "explicit-user"],
      ["PI_ITERM2_HOST", "ssh-alias"],
      ["USER", "fallback-user"],
      ["iterm2_hostname", "fallback-host"],
    ]),
    "system-host",
  );
  assert.deepEqual(config, {
    mode: "always",
    enabled: true,
    user: "explicit-user",
    host: "ssh-alias",
    reason: "enabled by PI_ITERM2_METADATA",
  });
});

test("auto mode recognizes iterm2_hostname in remote tmux sessions", () => {
  const config = resolveConfiguration(
    environment([
      ["USER", "alice"],
      ["iterm2_hostname", "devbox"],
      ["TERM_PROGRAM", "tmux"],
    ]),
    "devbox.local",
  );
  assert.equal(config.enabled, true);
  assert.equal(config.host, "devbox");
});

test("auto mode remains inactive without iTerm2 remote-session evidence", () => {
  const config = resolveConfiguration(
    environment([
      ["USER", "alice"],
      ["TERM_PROGRAM", "tmux"],
    ]),
    "host.local",
  );
  assert.equal(config.enabled, false);
});

test("resolves explicit Pi hyperlink settings before tmux auto-detection", () => {
  const env = environment([
    ["TMUX", "/tmp/tmux/default,1,0"],
    ["TERM", "tmux-256color"],
  ]);
  const client = { controlMode: true, features: [] };
  assert.equal(resolveHyperlinkCapability(env, true, client), true);
  assert.equal(resolveHyperlinkCapability(env, false, client), false);
});

test("uses tmux client features for automatic hyperlink detection", () => {
  const env = environment([["TMUX", "/tmp/tmux/default,1,0"]]);
  assert.equal(
    resolveHyperlinkCapability(env, "auto", {
      controlMode: false,
      features: ["RGB", "hyperlinks"],
    }),
    true,
  );
  assert.equal(
    resolveHyperlinkCapability(env, undefined, { controlMode: true, features: [] }),
    false,
  );
});

test("diagnoses Pi capability false-negatives in iTerm2 tmux control mode", () => {
  const diagnostics = resolveItermDiagnostics(
    environment([
      ["TMUX", "/tmp/tmux/default,1,0"],
      ["TERM", "tmux-256color"],
      ["ITERM_ENABLE_SHELL_INTEGRATION_WITH_TMUX", "1"],
    ]),
    false,
    undefined,
    true,
    { controlMode: true, features: [] },
  );
  assert.deepEqual(diagnostics, {
    path: "tmux-control",
    hyperlinksEnabled: false,
    hyperlinkMismatch: true,
    imageProtocol: undefined,
    showImages: true,
    imageMismatch: true,
    tmuxFeatures: [],
  });
});

test("accepts explicit Pi capability overrides in iTerm2 tmux control mode", () => {
  const diagnostics = resolveItermDiagnostics(
    environment([
      ["TMUX", "/tmp/tmux/default,1,0"],
      ["iterm2_hostname", "devbox"],
    ]),
    true,
    "iterm2",
    true,
    { controlMode: true, features: [] },
  );
  assert.equal(diagnostics.path, "tmux-control");
  assert.equal(diagnostics.hyperlinkMismatch, false);
  assert.equal(diagnostics.imageMismatch, false);
});

test("does not report an iTerm2 issue for unrelated tmux sessions", () => {
  const diagnostics = resolveItermDiagnostics(
    environment([
      ["TMUX", "/tmp/tmux/default,1,0"],
      ["TERM", "tmux-256color"],
    ]),
    false,
    undefined,
    true,
    { controlMode: false, features: ["RGB"] },
  );
  assert.equal(diagnostics.path, "undetected");
  assert.equal(diagnostics.hyperlinkMismatch, false);
  assert.equal(diagnostics.imageMismatch, false);
});

test("resolves explicit Pi image settings before environment detection", () => {
  const env = environment([
    ["TMUX", "/tmp/tmux/default,1,0"],
    ["PI_IMAGE_PROTOCOL", "kitty"],
  ]);
  assert.equal(resolveImageCapability(env, "iterm2"), "iterm2");
  assert.equal(resolveImageCapability(env, false), undefined);
});

test("uses Pi image environment overrides before automatic detection", () => {
  const env = environment([
    ["TMUX", "/tmp/tmux/default,1,0"],
    ["PI_IMAGE_PROTOCOL", "iterm2"],
  ]);
  assert.equal(resolveImageCapability(env, "auto"), "iterm2");
});

test("disables automatic images inside tmux and detects direct iTerm2", () => {
  assert.equal(
    resolveImageCapability(
      environment([
        ["TMUX", "/tmp/tmux/default,1,0"],
        ["ITERM_SESSION_ID", "w0t0p0:example"],
      ]),
      "auto",
    ),
    undefined,
  );
  assert.equal(
    resolveImageCapability(environment([["TERM_PROGRAM", "iTerm.app"]]), "auto"),
    "iterm2",
  );
});

test("suppresses the image warning when image display is intentionally hidden", () => {
  const diagnostics = resolveItermDiagnostics(
    environment([
      ["TMUX", "/tmp/tmux/default,1,0"],
      ["ITERM_ENABLE_SHELL_INTEGRATION_WITH_TMUX", "1"],
    ]),
    true,
    undefined,
    false,
    { controlMode: true, features: [] },
  );
  assert.equal(diagnostics.imageMismatch, false);
});

test("direct iTerm2 sessions do not produce an image mismatch", () => {
  const diagnostics = resolveItermDiagnostics(
    environment([["TERM_PROGRAM", "iTerm.app"]]),
    true,
    undefined,
    true,
  );
  assert.equal(diagnostics.path, "direct");
  assert.equal(diagnostics.imageMismatch, false);
});

test("injects immediately after a complete redraw marker", () => {
  const injector = createRedrawInjector(() => "<metadata>");
  const input = `before${FULL_REDRAW_CLEAR}after`;
  assert.deepEqual(injector.transform(input), {
    output: `before${FULL_REDRAW_CLEAR}<metadata>after`,
    injections: 1,
  });
});

test("returns nonmatching writes unchanged", () => {
  const injector = createRedrawInjector(() => "<metadata>");
  const input = "ordinary terminal output";
  const result = injector.transform(input);
  assert.equal(result.output, input);
  assert.equal(result.injections, 0);
});

test("recognizes redraw markers split at every boundary", () => {
  for (let split = 1; split < FULL_REDRAW_CLEAR.length; split += 1) {
    const injector = createRedrawInjector(() => "<metadata>");
    const first = injector.transform(`prefix${FULL_REDRAW_CLEAR.slice(0, split)}`);
    const second = injector.transform(`${FULL_REDRAW_CLEAR.slice(split)}suffix`);
    assert.equal(first.output + second.output, `prefix${FULL_REDRAW_CLEAR}<metadata>suffix`);
    assert.equal(first.injections + second.injections, 1);
  }
});

test("injects after every marker in one write", () => {
  const injector = createRedrawInjector(() => "<m>");
  const result = injector.transform(`${FULL_REDRAW_CLEAR}x${FULL_REDRAW_CLEAR}`);
  assert.equal(result.output, `${FULL_REDRAW_CLEAR}<m>x${FULL_REDRAW_CLEAR}<m>`);
  assert.equal(result.injections, 2);
});

test("reset prevents matching across unrelated writes", () => {
  const injector = createRedrawInjector(() => "<metadata>");
  const split = 5;
  const first = injector.transform(FULL_REDRAW_CLEAR.slice(0, split));
  injector.reset();
  const second = injector.transform(FULL_REDRAW_CLEAR.slice(split));
  assert.equal(first.injections + second.injections, 0);
});
