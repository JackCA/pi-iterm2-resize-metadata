import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createMetadataSequence,
  createRedrawInjector,
  type HyperlinkSetting,
  type ItermDiagnostics,
  type ResolvedConfiguration,
  resolveConfiguration,
  resolveHyperlinkCapability,
  resolveItermDiagnostics,
  type TmuxClientInfo,
} from "../../src/core.ts";

type StdoutWrite = typeof process.stdout.write;

interface WriteInterceptor {
  uninstall(): void;
  writeDirect(data: string): boolean;
  injectionCount(): number;
}

function inspectTmuxClient(): TmuxClientInfo | undefined {
  if (!process.env.TMUX?.trim()) {
    return undefined;
  }

  try {
    const output = execFileSync(
      "tmux",
      ["display-message", "-p", "#{client_control_mode}\t#{client_termfeatures}"],
      { encoding: "utf8", timeout: 250, stdio: ["ignore", "pipe", "ignore"] },
    );
    const [controlMode, featureList = ""] = output.trimEnd().split("\t", 2);
    return {
      controlMode: controlMode === "1",
      features: featureList
        .split(",")
        .map((feature) => feature.trim())
        .filter(Boolean),
    };
  } catch {
    return undefined;
  }
}

function readHyperlinkSetting(settingsPath: string): HyperlinkSetting {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      terminal?: { hyperlinks?: unknown };
    };
    const value = settings.terminal?.hyperlinks;
    return typeof value === "boolean" || value === "auto" ? value : undefined;
  } catch {
    return undefined;
  }
}

function configuredHyperlinkSetting(ctx: ExtensionContext): HyperlinkSetting {
  const agentDirectory =
    process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
  const globalSetting = readHyperlinkSetting(path.join(agentDirectory, "settings.json"));
  if (!ctx.isProjectTrusted()) {
    return globalSetting;
  }
  return readHyperlinkSetting(path.join(ctx.cwd, ".pi", "settings.json")) ?? globalSetting;
}

function currentDiagnostics(ctx: ExtensionContext): ItermDiagnostics {
  const tmuxClient = inspectTmuxClient();
  const hyperlinksEnabled = resolveHyperlinkCapability(
    process.env,
    configuredHyperlinkSetting(ctx),
    tmuxClient,
  );
  return resolveItermDiagnostics(process.env, hyperlinksEnabled, tmuxClient);
}

function formatDiagnostics(diagnostics: ItermDiagnostics): string {
  const inTmux = diagnostics.path === "tmux" || diagnostics.path === "tmux-control";
  const features =
    diagnostics.tmuxFeatures.length > 0
      ? diagnostics.tmuxFeatures.join(",")
      : inTmux
        ? "unadvertised"
        : "not-applicable";
  return `path=${diagnostics.path}; hyperlinks=${diagnostics.hyperlinksEnabled ? "enabled" : "disabled"}; tmux-features=${features}`;
}

function installWriteInterceptor(getSequence: () => string | undefined): WriteInterceptor {
  const stdout = process.stdout;
  const downstream = stdout.write;
  const injector = createRedrawInjector(getSequence);
  let active = true;
  let count = 0;

  const wrapper = function (this: NodeJS.WriteStream, chunk: unknown, ...args: unknown[]): boolean {
    if (!active || typeof chunk !== "string") {
      if (typeof chunk !== "string") {
        injector.reset();
      }
      return Reflect.apply(downstream, this, [chunk, ...args]) as boolean;
    }

    const result = injector.transform(chunk);
    count += result.injections;
    return Reflect.apply(downstream, this, [result.output, ...args]) as boolean;
  } as unknown as StdoutWrite;

  stdout.write = wrapper;

  return {
    uninstall() {
      active = false;
      if (stdout.write === wrapper) {
        stdout.write = downstream;
      }
      injector.reset();
    },
    writeDirect(data: string) {
      return downstream.call(stdout, data);
    },
    injectionCount() {
      return count;
    },
  };
}

// biome-ignore lint/style/noDefaultExport: Pi packages require a default extension factory.
export default function iterm2ResizeMetadata(pi: ExtensionAPI) {
  let cwd = process.cwd();
  let configuration: ResolvedConfiguration = resolveConfiguration(process.env, os.hostname());
  let interceptor: WriteInterceptor | undefined;
  let hyperlinkWarningShown = false;

  const sequence = () =>
    createMetadataSequence({
      user: configuration.user,
      host: configuration.host,
      directory: cwd,
    });

  const refresh = () => {
    const metadata = sequence();
    if (!metadata) {
      return false;
    }
    if (interceptor) {
      interceptor.writeDirect(metadata);
    } else {
      process.stdout.write(metadata);
    }
    return true;
  };

  const stop = () => {
    interceptor?.uninstall();
    interceptor = undefined;
  };

  pi.on("session_start", (_event, ctx) => {
    stop();
    cwd = ctx.cwd;
    configuration = resolveConfiguration(process.env, os.hostname());
    const metadata = sequence();
    if (ctx.mode !== "tui") {
      return;
    }
    if (configuration.enabled && !metadata) {
      ctx.ui.notify(
        "iTerm2 metadata is enabled, but user, host, or working directory is empty",
        "warning",
      );
      return;
    }

    const diagnostics = currentDiagnostics(ctx);
    if (configuration.enabled && diagnostics.hyperlinkMismatch && !hyperlinkWarningShown) {
      hyperlinkWarningShown = true;
      ctx.ui.notify(
        "iTerm2 tmux integration detected, but Pi OSC 8 hyperlinks are disabled. Set terminal.hyperlinks=true in Pi settings and run /reload.",
        "warning",
      );
    }
    if (!configuration.enabled) {
      return;
    }

    interceptor = installWriteInterceptor(sequence);
    refresh();
  });

  pi.on("session_shutdown", () => {
    stop();
  });

  const refreshHandler = (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    cwd = ctx.cwd;
    configuration = resolveConfiguration(process.env, os.hostname());
    const ok = refresh();
    ctx.ui.notify(
      ok
        ? `Refreshed iTerm2 metadata for ${configuration.user}@${configuration.host}`
        : "Could not emit iTerm2 metadata: user, host, or working directory is empty",
      ok ? "info" : "error",
    );
    return Promise.resolve();
  };

  pi.registerCommand("iterm-metadata-refresh", {
    description: "Re-emit iTerm2 remote-host and current-directory metadata",
    handler: refreshHandler,
  });

  // Compatibility with the original personal extension.
  pi.registerCommand("iterm-scp-refresh", {
    description: "Alias for /iterm-metadata-refresh",
    handler: refreshHandler,
  });

  pi.registerCommand("iterm-metadata-status", {
    description: "Show iTerm2 redraw-metadata status",
    handler: (_args, ctx) => {
      configuration = resolveConfiguration(process.env, os.hostname());
      const state = interceptor ? "active" : "inactive";
      const count = interceptor?.injectionCount() ?? 0;
      const diagnostics = currentDiagnostics(ctx);
      ctx.ui.notify(
        `iTerm2 metadata ${state}; mode=${configuration.mode}; target=${configuration.user}@${configuration.host}; redraws=${count}; ${formatDiagnostics(diagnostics)}; ${configuration.reason}`,
        interceptor && !diagnostics.hyperlinkMismatch ? "info" : "warning",
      );
      return Promise.resolve();
    },
  });
}
