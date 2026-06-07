import { readFileSync, writeFileSync } from "node:fs";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const version = rootPackage.version;

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Unsupported package version: ${version}`);
}

function updateJson(path, updater) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  updater(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceFirst(path, pattern, replacement) {
  const current = readFileSync(path, "utf8");
  const next = current.replace(pattern, replacement);
  if (next === current) {
    throw new Error(`No version match found in ${path}`);
  }
  writeFileSync(path, next);
}

updateJson("package-lock.json", (lockFile) => {
  lockFile.version = version;
  if (lockFile.packages?.[""]) {
    lockFile.packages[""].version = version;
  }
});

updateJson("src-tauri/tauri.conf.json", (config) => {
  config.version = version;
});

replaceFirst("src-tauri/Cargo.toml", /^version = ".*"$/m, `version = "${version}"`);
replaceFirst(
  "src-tauri/Cargo.lock",
  /(name = "mediatagger"\nversion = )".*"/,
  `$1"${version}"`
);

console.log(`Synced MediaTagger version ${version}`);
