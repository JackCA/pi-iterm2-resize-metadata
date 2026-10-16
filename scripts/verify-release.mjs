import { readFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

const packageJson = readJson("package.json");
const manifest = readJson(".release-please-manifest.json");
const releaseConfig = readJson("release-please-config.json");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const packageConfig = releaseConfig.packages?.["."];
const version = packageJson.version;

if (manifest["."] !== version) {
  throw new Error(`Release manifest ${manifest["."]} does not match package version ${version}`);
}
if (packageConfig?.["release-type"] !== "node") {
  throw new Error("Release Please must use the node release type");
}
if (packageConfig?.["package-name"] !== packageJson.name) {
  throw new Error("Release Please package name does not match package.json");
}
if (packageConfig?.["include-v-in-tag"] !== true) {
  throw new Error("Release Please tags must retain the v prefix");
}
if (!(changelog.includes(`## ${version}`) || changelog.includes(`## [${version}]`))) {
  throw new Error(`CHANGELOG.md has no heading for version ${version}`);
}
