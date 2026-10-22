import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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
  type ImageSetting,
  type ItermDiagnostics,
  type ResolvedConfiguration,
  resolveConfiguration,
  resolveHyperlinkCapability,
  resolveImageCapability,
  resolveItermDiagnostics,
  type TmuxClientInfo,
} from "../../src/core.ts";
import {
  createMetadataDirectoryResolver,
  type MetadataDirectoryMode,
} from "../../src/metadata-directory.ts";

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

interface TerminalSettings {
  hyperlinks: HyperlinkSetting;
  images: ImageSetting;
  showImages: boolean | undefined;
}

function readTerminalSettings(settingsPath: string): TerminalSettings {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      terminal?: { hyperlinks?: unknown; images?: unknown; showImages?: unknown };
    };
    const hyperlinks = settings.terminal?.hyperlinks;
    const images = settings.terminal?.images;
    const showImages = settings.terminal?.showImages;
    return {
      hyperlinks: typeof hyperlinks === "boolean" || hyperlinks === "auto" ? hyperlinks : undefined,
      images:
        images === "kitty" || images === "iterm2" || images === "auto" || images === false
          ? images
          : undefined,
      showImages: typeof showImages === "boolean" ? showImages : undefined,
    };
  } catch {
    return { hyperlinks: undefined, images: undefined, showImages: undefined };
  }
}

function configuredTerminalSettings(ctx: ExtensionContext): TerminalSettings {
  const agentDirectory =
    process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
  const globalSettings = readTerminalSettings(path.join(agentDirectory, "settings.json"));
  if (!ctx.isProjectTrusted()) {
    return globalSettings;
  }

  const projectSettings = readTerminalSettings(path.join(ctx.cwd, ".pi", "settings.json"));
  return {
    hyperlinks: projectSettings.hyperlinks ?? globalSettings.hyperlinks,
    images: projectSettings.images ?? globalSettings.images,
    showImages: projectSettings.showImages ?? globalSettings.showImages,
  };
}

function currentDiagnostics(ctx: ExtensionContext): ItermDiagnostics {
  const tmuxClient = inspectTmuxClient();
  const settings = configuredTerminalSettings(ctx);
  const hyperlinksEnabled = resolveHyperlinkCapability(
    process.env,
    settings.hyperlinks,
    tmuxClient,
  );
  const imageProtocol = resolveImageCapability(process.env, settings.images);
  return resolveItermDiagnostics(
    process.env,
    hyperlinksEnabled,
    imageProtocol,
    settings.showImages ?? true,
    tmuxClient,
  );
}

function formatDiagnostics(diagnostics: ItermDiagnostics): string {
  const inTmux = diagnostics.path === "tmux" || diagnostics.path === "tmux-control";
  const features =
    diagnostics.tmuxFeatures.length > 0
      ? diagnostics.tmuxFeatures.join(",")
      : inTmux
        ? "unadvertised"
        : "not-applicable";
  return `path=${diagnostics.path}; hyperlinks=${diagnostics.hyperlinksEnabled ? "enabled" : "disabled"}; images=${diagnostics.imageProtocol ?? "disabled"}; show-images=${diagnostics.showImages ? "enabled" : "disabled"}; tmux-features=${features}`;
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

interface CurrentDirectoryController {
  readonly directory: string;
  readonly mode: MetadataDirectoryMode | "fallback";
  readonly error: string | undefined;
  update(cwd: string): void;
}

function createCurrentDirectoryController(): CurrentDirectoryController {
  let directory = process.cwd();
  let mode: MetadataDirectoryMode | "fallback" = "cwd";
  let error: string | undefined;
  const resolve = createMetadataDirectoryResolver((cwd) => {
    const projectTmp = path.join(cwd, "tmp");
    mkdirSync(projectTmp, { recursive: true });
    return projectTmp;
  });

  return {
    get directory() {
      return directory;
    },
    get mode() {
      return mode;
    },
    get error() {
      return error;
    },
    update(cwd) {
      try {
        const resolution = resolve(cwd, process.env);
        directory = resolution.directory;
        mode = resolution.mode;
        error = undefined;
      } catch (cause) {
        directory = cwd;
        mode = "fallback";
        error = cause instanceof Error ? cause.message : String(cause);
      }
    },
  };
}

// biome-ignore lint/style/noDefaultExport: Pi packages require a default extension factory.
export default function iterm2ResizeMetadata(pi: ExtensionAPI) {
  const currentDirectory = createCurrentDirectoryController();
  let configuration: ResolvedConfiguration = resolveConfiguration(process.env, os.hostname());
  let interceptor: WriteInterceptor | undefined;
  let capabilityWarningShown = false;

  const sequence = () =>
    createMetadataSequence({
      user: configuration.user,
      host: configuration.host,
      directory: currentDirectory.directory,
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
    configuration = resolveConfiguration(process.env, os.hostname());
    if (ctx.mode !== "tui" || !configuration.enabled) {
      return;
    }
    currentDirectory.update(ctx.cwd);
    const metadata = sequence();
    if (!metadata) {
      ctx.ui.notify(
        "iTerm2 metadata is enabled, but user, host, or working directory is empty",
        "warning",
      );
      return;
    }
    if (currentDirectory.error) {
      ctx.ui.notify(
        `Could not create ${path.join(ctx.cwd, "tmp")}; using Pi's working directory for iTerm2 metadata instead: ${currentDirectory.error}`,
        "warning",
      );
    }

    const diagnostics = currentDiagnostics(ctx);
    if ((diagnostics.hyperlinkMismatch || diagnostics.imageMismatch) && !capabilityWarningShown) {
      capabilityWarningShown = true;
      const message =
        diagnostics.hyperlinkMismatch && diagnostics.imageMismatch
          ? 'iTerm2 tmux integration detected, but Pi OSC 8 hyperlinks are disabled and inline images are not using the iTerm2 protocol. Set terminal.hyperlinks=true and terminal.images="iterm2" in Pi settings, then run /reload.'
          : diagnostics.hyperlinkMismatch
            ? "iTerm2 tmux integration detected, but Pi OSC 8 hyperlinks are disabled. Set terminal.hyperlinks=true in Pi settings and run /reload."
            : 'iTerm2 tmux integration detected, but Pi inline images are not using the iTerm2 protocol. Set terminal.images="iterm2" in Pi settings and run /reload.';
      ctx.ui.notify(message, "warning");
    }

    interceptor = installWriteInterceptor(sequence);
    refresh();
  });

  pi.on("session_shutdown", () => {
    stop();
  });

  const refreshHandler = (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    currentDirectory.update(ctx.cwd);
    configuration = resolveConfiguration(process.env, os.hostname());
    const ok = refresh();
    ctx.ui.notify(
      ok
        ? `Refreshed iTerm2 metadata for ${configuration.user}@${configuration.host}; directory=${currentDirectory.directory}`
        : "Could not emit iTerm2 metadata: user, host, or working directory is empty",
      !ok ? "error" : currentDirectory.error ? "warning" : "info",
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
        `iTerm2 metadata ${state}; mode=${configuration.mode}; target=${configuration.user}@${configuration.host}; current-dir-mode=${currentDirectory.mode}; directory=${currentDirectory.directory}; redraws=${count}; ${formatDiagnostics(diagnostics)}; ${configuration.reason}`,
        interceptor &&
          !diagnostics.hyperlinkMismatch &&
          !diagnostics.imageMismatch &&
          !currentDirectory.error
          ? "info"
          : "warning",
      );
      return Promise.resolve();
    },
  });
}
