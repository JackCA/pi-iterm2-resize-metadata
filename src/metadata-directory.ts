import type { Environment } from "./core.ts";

export type MetadataDirectoryMode = "cwd" | "cwd-tmp";

export interface ResolvedMetadataDirectory {
  directory: string;
  mode: MetadataDirectoryMode;
}

export type MetadataDirectoryResolver = (
  cwd: string,
  env: Environment,
) => ResolvedMetadataDirectory;

export function createMetadataDirectoryResolver(
  createProjectTemporaryDirectory: (cwd: string) => string,
): MetadataDirectoryResolver {
  const projectTemporaryDirectories = new Map<string, string>();

  return (cwd, env) => {
    if (env.PI_ITERM2_CURRENT_DIR_MODE?.trim().toLowerCase() === "cwd") {
      return { directory: cwd, mode: "cwd" };
    }

    let directory = projectTemporaryDirectories.get(cwd);
    if (!directory) {
      directory = createProjectTemporaryDirectory(cwd);
      if (!directory.trim()) {
        throw new Error("project temporary directory is empty");
      }
      projectTemporaryDirectories.set(cwd, directory);
    }

    return { directory, mode: "cwd-tmp" };
  };
}
