const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const groups = new Map();
const missing = [];
function collect(label, dir) {
  const names = fs
    .readdirSync(dir)
    .filter(
      (n) =>
        /^(licen[sc]e|copying|notice)(\.|-|$)/i.test(n) &&
        fs.statSync(path.join(dir, n)).isFile(),
    );
  if (!names.length) {
    missing.push(label);
    return;
  }
  for (const name of names) {
    const content = fs.readFileSync(path.join(dir, name), "utf8").trim();
    const labels = groups.get(content) || [];
    labels.push(label + " / " + name);
    groups.set(content, labels);
  }
}
function npmPackages(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const sub = path.join(dir, item.name);
    if (item.name.startsWith("@")) {
      npmPackages(sub);
      continue;
    }
    const manifest = path.join(sub, "package.json");
    if (fs.existsSync(manifest)) {
      const p = JSON.parse(fs.readFileSync(manifest, "utf8"));
      collect(`${p.name} ${p.version}`, sub);
    }
    if (fs.existsSync(path.join(sub, "node_modules")))
      npmPackages(path.join(sub, "node_modules"));
  }
}
npmPackages(path.join(root, "node_modules"));
const registry = path.join(
  process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"),
  "registry/src",
);
const sources = fs.readdirSync(registry).map((n) => path.join(registry, n));
const lock = fs.readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8");
for (const block of lock.split("[[package]]").slice(1)) {
  if (!block.includes('source = "registry+')) continue;
  const name = /\bname = "([^"]+)"/.exec(block)[1];
  const version = /\bversion = "([^"]+)"/.exec(block)[1];
  const dir = sources
    .map((base) => path.join(base, `${name}-${version}`))
    .find(fs.existsSync);
  if (dir) collect(`${name} ${version}`, dir);
  else missing.push(`${name} ${version} (source not cached)`);
}
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
let out = `# Third-party software notices\n\n拾签 ${version} includes open-source components. The following license and notice texts accompany the locked build dependencies. Entries may include development or platform-specific dependencies that are not present in every binary.\n\n`;
for (const [content, labels] of groups) {
  out += `## ${labels.join(" · ")}\n\n\`\`\`text\n${content}\n\`\`\`\n\n`;
}
out +=
  "## Components without a top-level license file in the cached package\n\n" +
  missing.map((s) => `- ${s}`).join("\n") +
  "\n\nConsult each component’s package manifest and upstream repository for additional attribution.\n";
fs.writeFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), out);
console.log(
  `Collected ${groups.size} unique notice texts; ${missing.length} packages have no top-level license file.`,
);
