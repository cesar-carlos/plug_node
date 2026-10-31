import { readdirSync } from "node:fs";
import path from "node:path";

export const listBuiltArtifacts = (directory, prefix = "dist") =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}/${entry.name}`;
    return entry.isDirectory()
      ? listBuiltArtifacts(path.join(directory, entry.name), relative)
      : [relative];
  });

export const validatePublishedArtifacts = (builtFiles, publishedFiles) => {
  const built = new Set(builtFiles);
  const published = new Set(publishedFiles.filter((file) => file.startsWith("dist/")));
  for (const file of built) {
    // Keep maps in local builds; npm consumers do not receive their TypeScript sources.
    if (!file.endsWith(".js.map") && !published.has(file)) {
      throw new Error(
        `Built artifact missing from tarball: ${file}. Update package.json files when adding runtime assets.`,
      );
    }
  }
  for (const file of published) {
    if (file.endsWith(".js.map")) {
      throw new Error(`Development source map must not be published: ${file}`);
    }
    if (!built.has(file)) {
      throw new Error(
        `Tarball contains an artifact absent from the current build: ${file}`,
      );
    }
  }
};
