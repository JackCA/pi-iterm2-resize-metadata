export const FULL_REDRAW_CLEAR = "\x1b[2J\x1b[H\x1b[3J";

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/g;

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

export interface RedrawInjector {
  transform(chunk: string): TransformResult;
  reset(): void;
}

export function sanitizeOscValue(value: string): string {
  return value.replace(CONTROL_CHARACTERS, "");
}

export function createMetadataSequence(identity: MetadataIdentity): string | undefined {
  const user = sanitizeOscValue(identity.user);
  const host = sanitizeOscValue(identity.host);
  const directory = sanitizeOscValue(identity.directory);
  if (!user || !host || !directory) return undefined;

  return (
    `\x1b]1337;RemoteHost=${user}@${host}\x07` +
    `\x1b]1337;CurrentDir=${directory}\x07`
  );
}

function firstNonempty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return "";
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
  const directItermEvidence = Boolean(
    env.ITERM_SESSION_ID?.trim() ||
      env.LC_TERMINAL?.toLowerCase() === "iterm2" ||
      env.TERM_PROGRAM === "iTerm.app",
  );
  const remoteEvidence = Boolean(env.SSH_CONNECTION?.trim() || env.SSH_CLIENT?.trim());
  const autoDetected = explicitEvidence || (directItermEvidence && remoteEvidence);

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

/**
 * Creates a stateful transform that inserts metadata after Pi's full-redraw
 * clear marker. It also recognizes a marker split across adjacent writes.
 */
export function createRedrawInjector(
  getSequence: () => string | undefined,
  marker = FULL_REDRAW_CLEAR,
): RedrawInjector {
  if (!marker) throw new Error("The redraw marker must not be empty");

  let tail = "";

  return {
    transform(chunk: string): TransformResult {
      if (!chunk) return { output: chunk, injections: 0 };

      const combined = tail + chunk;
      const tailLength = tail.length;
      const insertionPoints: number[] = [];
      let searchFrom = 0;

      while (true) {
        const index = combined.indexOf(marker, searchFrom);
        if (index < 0) break;

        const end = index + marker.length;
        if (end > tailLength) {
          const point = end - tailLength;
          if (point >= 0 && point <= chunk.length) insertionPoints.push(point);
        }
        searchFrom = end;
      }

      tail = combined.slice(-Math.max(0, marker.length - 1));
      if (insertionPoints.length === 0) return { output: chunk, injections: 0 };

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
    },

    reset() {
      tail = "";
    },
  };
}
