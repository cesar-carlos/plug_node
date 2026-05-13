import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const markdownLinkHref = /\[[^\]]*]\(([^)]+)\)/g;

const collectMarkdownFiles = (absoluteDir, acc) => {
  if (!existsSync(absoluteDir)) {
    return;
  }
  for (const entry of readdirSync(absoluteDir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") {
      continue;
    }
    const full = path.join(absoluteDir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectMarkdownFiles(full, acc);
    } else if (entry.endsWith(".md")) {
      acc.push(full);
    }
  }
};

const rootsToScan = [
  path.join(rootDir, "README.md"),
  path.join(rootDir, "CONTRIBUTING.md"),
  path.join(rootDir, "SECURITY.md"),
  path.join(rootDir, "docs"),
  path.join(rootDir, "packages", "n8n-nodes-plug-database", "README.md"),
];

const markdownFiles = [];
for (const entry of rootsToScan) {
  if (!existsSync(entry)) {
    continue;
  }
  if (statSync(entry).isDirectory()) {
    collectMarkdownFiles(entry, markdownFiles);
  } else {
    markdownFiles.push(entry);
  }
}

const failures = [];

for (const filePath of markdownFiles) {
  const text = readFileSync(filePath, "utf8");
  let match;
  while ((match = markdownLinkHref.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#")) {
      continue;
    }
    if (/^(https?:|mailto:)/i.test(raw)) {
      continue;
    }

    const withoutTitle = raw.split(/\s+/)[0];
    const [pathPart] = withoutTitle.split("#");
    if (!pathPart) {
      continue;
    }

    const resolved = path.normalize(path.join(path.dirname(filePath), pathPart));
    const relFromRoot = path.relative(rootDir, resolved);
    if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
      failures.push({
        file: path.relative(rootDir, filePath).replaceAll("\\", "/"),
        href: raw,
        reason: "Link resolves outside the repository",
      });
      continue;
    }

    if (!existsSync(resolved)) {
      failures.push({
        file: path.relative(rootDir, filePath).replaceAll("\\", "/"),
        href: raw,
        reason: "Target path does not exist",
      });
    }
  }
}

if (failures.length > 0) {
  for (const f of failures) {
    console.error(`${f.file}: broken link "${f.href}" (${f.reason})`);
  }
  throw new Error(`${failures.length} broken documentation link(s).`);
}

console.log(
  `Verified relative links in ${markdownFiles.length} Markdown file(s) under docs/, README, CONTRIBUTING, SECURITY, and package README.`,
);
