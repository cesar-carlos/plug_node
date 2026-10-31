import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const directory = new URL("../.cursor/rules/", import.meta.url);
const files = readdirSync(directory).filter((file) => file.endsWith(".mdc"));
assert.ok(files.length > 0, "No project rules found");
for (const file of files) {
  const text = readFileSync(new URL(file, directory), "utf8").replace(/\r\n/g, "\n");
  const metadata = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  assert.ok(metadata, `${file}: missing frontmatter delimiters`);
  assert.match(metadata, /^description: "[^"\n]+"$/m, `${file}: description`);
  assert.match(metadata, /^alwaysApply: (true|false)$/m, `${file}: alwaysApply`);
  const globs = /^globs: (\[.*\])$/m.exec(metadata)?.[1];
  assert.ok(globs, `${file}: globs must be a JSON-compatible array`);
  assert.ok(
    JSON.parse(globs).every((glob) => typeof glob === "string" && glob.length > 0),
  );
  for (const [, reference] of text.matchAll(/`([\w-]+\.mdc)`/g)) {
    assert.ok(files.includes(reference), `${file}: missing referenced rule ${reference}`);
  }
}
console.log(
  `Verified frontmatter and local references in ${files.length} project rules.`,
);
