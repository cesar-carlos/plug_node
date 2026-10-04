export const readNpmPackOutput = (stdout, packageName) => {
  const parsed = JSON.parse(stdout);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`Unexpected npm pack output for ${packageName}`);
  }
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const entry = entries.find((value) => value?.name === packageName);
  if (
    !entry ||
    typeof entry.filename !== "string" ||
    !Array.isArray(entry.files) ||
    !Number.isFinite(entry.size) ||
    !Number.isFinite(entry.unpackedSize)
  ) {
    throw new Error(`Unexpected npm pack output for ${packageName}`);
  }
  return entry;
};
