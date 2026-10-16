import os from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  createMetadataSequence,
  createRedrawInjector,
  type ResolvedConfiguration,
  resolveConfiguration,
} from "../src/core.ts";

type StdoutWrite = typeof process.stdout.write;

interface WriteInterceptor {
  uninstall(): void;
  writeDirect(data: string): boolean;
  injectionCount(): number;
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
    if (ctx.mode !== "tui" || !configuration.enabled || !sequence()) {
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
      ctx.ui.notify(
        `iTerm2 metadata ${state}; mode=${configuration.mode}; target=${configuration.user}@${configuration.host}; redraws=${count}; ${configuration.reason}`,
        interceptor ? "info" : "warning",
      );
      return Promise.resolve();
    },
  });
}
