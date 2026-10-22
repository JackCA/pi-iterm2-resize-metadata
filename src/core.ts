export const FULL_REDRAW_CLEAR = "\x1b[2J\x1b[H\x1b[3J";

export type ActivationMode = "auto" | "always" | "off";
export type Environment = Readonly<Record<string, string | undefined>>;

export interface MetadataIdentity {
  user: string;
  host: string;
  directory: string;
}

export interface ResolvedConfiguration {
  mode: ActivationMode;
  enabled: boolean;
  user: string;
  host: string;
  reason: string;
}

export interface TransformResult {
  output: string;
  injections: number;
}

export interface TmuxClientInfo {
  controlMode: boolean;
  features: readonly string[];
}

export type HyperlinkSetting = boolean | "auto" | undefined;
export type ImageProtocol = "kitty" | "iterm2" | undefined;
export type ImageSetting = ImageProtocol | "auto" | false;
export type ItermSessionPath = "direct" | "tmux" | "tmux-control" | "undetected";

export interface ItermDiagnostics {
  path: ItermSessionPath;
  hyperlinksEnabled: boolean;
  hyperlinkMismatch: boolean;
  imageProtocol: ImageProtocol;
  showImages: boolean;
  imageMismatch: boolean;
  tmuxFeatures: readonly string[];
}

export interface RedrawInjector {
  transform(chunk: string): TransformResult;
  reset(): void;
}

export function sanitizeOscValue(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    if (!isControl) {
      sanitized += character;
    }
  }
  return sanitized;
}

export function createMetadataSequence(identity: MetadataIdentity): string | undefined {
  const user = sanitizeOscValue(identity.user);
  const host = sanitizeOscValue(identity.host);
  const directory = sanitizeOscValue(identity.directory);
  if (!(user && host && directory)) {
    return undefined;
  }

  return `\x1b]1337;RemoteHost=${user}@${host}\x07` + `\x1b]1337;CurrentDir=${directory}\x07`;
}

function firstNonempty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value?.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function isTmuxEnvironment(env: Environment): boolean {
  return Boolean(env.TMUX?.trim() || env.TERM?.toLowerCase().startsWith("tmux"));
}

export function hasDirectItermEvidence(env: Environment): boolean {
  return Boolean(
    env.ITERM_SESSION_ID?.trim() ||
      env.LC_TERMINAL?.toLowerCase() === "iterm2" ||
      env.TERM_PROGRAM?.toLowerCase() === "iterm.app",
  );
}

export function hasItermTmuxIntegrationEvidence(env: Environment): boolean {
  return Boolean(
    env.ITERM_ENABLE_SHELL_INTEGRATION_WITH_TMUX?.trim() === "1" ||
      env.iterm2_hostname?.trim() ||
      env.PI_ITERM2_HOST?.trim(),
  );
}

export function resolveConfiguration(
  env: Environment,
  systemHostname: string,
): ResolvedConfiguration {
  const requestedMode = env.PI_ITERM2_METADATA?.trim().toLowerCase();
  const mode: ActivationMode =
    requestedMode === "always" || requestedMode === "off" || requestedMode === "auto"
      ? requestedMode
      : "auto";

  const user = firstNonempty(env.PI_ITERM2_USER, env.USER, env.LOGNAME);
  const host = firstNonempty(env.PI_ITERM2_HOST, env.iterm2_hostname, systemHostname);

  const explicitEvidence = Boolean(env.PI_ITERM2_HOST?.trim() || env.iterm2_hostname?.trim());
  const remoteEvidence = Boolean(env.SSH_CONNECTION?.trim() || env.SSH_CLIENT?.trim());
  const autoDetected = explicitEvidence || (hasDirectItermEvidence(env) && remoteEvidence);

  if (mode === "off") {
    return { mode, enabled: false, user, host, reason: "disabled by PI_ITERM2_METADATA" };
  }
  if (mode === "always") {
    return { mode, enabled: true, user, host, reason: "enabled by PI_ITERM2_METADATA" };
  }
  if (autoDetected) {
    return { mode, enabled: true, user, host, reason: "iTerm2 remote session detected" };
  }
  return { mode, enabled: false, user, host, reason: "no iTerm2 remote-session evidence" };
}

export function resolveHyperlinkCapability(
  env: Environment,
  setting: HyperlinkSetting,
  tmuxClient?: TmuxClientInfo,
): boolean {
  if (typeof setting === "boolean") {
    return setting;
  }
  if (env.PI_HYPERLINKS === "1") {
    return true;
  }
  if (env.PI_HYPERLINKS === "0") {
    return false;
  }

  if (isTmuxEnvironment(env)) {
    return tmuxClient?.features.some((feature) => feature.toLowerCase() === "hyperlinks") ?? false;
  }
  return hasDirectItermEvidence(env);
}

export function resolveImageCapability(env: Environment, setting: ImageSetting): ImageProtocol {
  if (setting === "kitty" || setting === "iterm2") {
    return setting;
  }
  if (setting === false) {
    return undefined;
  }

  const override = env.PI_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (override === "kitty" || override === "iterm2") {
    return override;
  }
  if (override === "none" || override === "0") {
    return undefined;
  }

  const term = env.TERM?.toLowerCase() ?? "";
  if (isTmuxEnvironment(env) || term.startsWith("screen")) {
    return undefined;
  }

  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
  if (
    termProgram === "herdr" ||
    env.KITTY_WINDOW_ID?.trim() ||
    termProgram === "kitty" ||
    termProgram === "ghostty" ||
    term.includes("ghostty") ||
    env.GHOSTTY_RESOURCES_DIR?.trim() ||
    env.WEZTERM_PANE?.trim() ||
    termProgram === "wezterm" ||
    termProgram === "warpterminal" ||
    env.WARP_SESSION_ID?.trim() ||
    env.WARP_TERMINAL_SESSION_UUID?.trim()
  ) {
    return "kitty";
  }
  if (hasDirectItermEvidence(env)) {
    return "iterm2";
  }
  return undefined;
}

export function resolveItermDiagnostics(
  env: Environment,
  hyperlinksEnabled: boolean,
  imageProtocol: ImageProtocol,
  showImages: boolean,
  tmuxClient?: TmuxClientInfo,
): ItermDiagnostics {
  const inTmux = isTmuxEnvironment(env);
  const directIterm = hasDirectItermEvidence(env);
  const integratedTmux = hasItermTmuxIntegrationEvidence(env);

  let path: ItermSessionPath = "undetected";
  if (inTmux && integratedTmux && tmuxClient?.controlMode) {
    path = "tmux-control";
  } else if (inTmux && integratedTmux) {
    path = "tmux";
  } else if (directIterm) {
    path = "direct";
  }

  const integratedPath = path === "tmux" || path === "tmux-control";
  return {
    path,
    hyperlinksEnabled,
    hyperlinkMismatch: integratedPath && !hyperlinksEnabled,
    imageProtocol,
    showImages,
    imageMismatch: integratedPath && showImages && imageProtocol !== "iterm2",
    tmuxFeatures: tmuxClient?.features ?? [],
  };
}

function findInsertionPoints(
  combined: string,
  marker: string,
  tailLength: number,
  chunkLength: number,
): number[] {
  const insertionPoints: number[] = [];
  let searchFrom = 0;

  while (true) {
    const index = combined.indexOf(marker, searchFrom);
    if (index < 0) {
      return insertionPoints;
    }

    const end = index + marker.length;
    const point = end - tailLength;
    if (end > tailLength && point >= 0 && point <= chunkLength) {
      insertionPoints.push(point);
    }
    searchFrom = end;
  }
}

function insertSequences(
  chunk: string,
  insertionPoints: number[],
  getSequence: () => string | undefined,
): TransformResult {
  let output = "";
  let offset = 0;
  let injections = 0;

  for (const point of insertionPoints) {
    const sequence = getSequence();
    output += chunk.slice(offset, point);
    if (sequence) {
      output += sequence;
      injections += 1;
    }
    offset = point;
  }
  output += chunk.slice(offset);
  return { output, injections };
}

/**
 * Creates a stateful transform that inserts metadata after Pi's full-redraw
 * clear marker. It also recognizes a marker split across adjacent writes.
 */
export function createRedrawInjector(
  getSequence: () => string | undefined,
  marker = FULL_REDRAW_CLEAR,
): RedrawInjector {
  if (!marker) {
    throw new Error("The redraw marker must not be empty");
  }

  let tail = "";

  return {
    transform(chunk: string): TransformResult {
      if (!chunk) {
        return { output: chunk, injections: 0 };
      }

      const combined = tail + chunk;
      const insertionPoints = findInsertionPoints(combined, marker, tail.length, chunk.length);
      tail = combined.slice(-Math.max(0, marker.length - 1));

      return insertionPoints.length === 0
        ? { output: chunk, injections: 0 }
        : insertSequences(chunk, insertionPoints, getSequence);
    },

    reset() {
      tail = "";
    },
  };
}
