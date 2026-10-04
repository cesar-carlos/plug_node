import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const baseline = path.resolve(
  process.env.PLUG_BENCH_TYPESCRIPT_BASE ??
    "tmp/dependency-migration-baseline/reconstructed",
);
const scratch = path.join(root, "tmp/typescript-benchmark");
const output = path.resolve(
  process.env.PLUG_BENCH_REPORT_PATH ??
    "tmp/e2e-logs/dependency-migration/typescript-comparison.json",
);
const require = createRequire(path.join(root, "package.json"));
const nativeRoot = path.dirname(require.resolve("@typescript/native/package.json"));
const { default: getExePath } = await import(
  pathToFileURL(path.join(nativeRoot, "lib/getExePath.js"))
);
const nativeExe = getExePath();
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
mkdirSync(scratch, { recursive: true });

const measure = (name, scenario, iteration) => {
  const cwd = name === "baseline" ? baseline : root;
  const directory = path.join(scratch, `${iteration}-${name}-${scenario}`);
  if (!directory.startsWith(scratch + path.sep))
    throw new Error("Invalid benchmark directory");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const executable = name === "baseline" ? process.execPath : nativeExe;
  const args = [
    ...(name === "baseline"
      ? [path.join(baseline, "node_modules/typescript/bin/tsc")]
      : []),
    "--project",
    "packages/n8n-nodes-plug-database/tsconfig.json",
    "--pretty",
    "false",
    "--tsBuildInfoFile",
    path.join(directory, "state.tsbuildinfo"),
    "--outDir",
    path.join(directory, "dist"),
    ...(scenario === "typecheck" ? ["--noEmit"] : []),
  ];
  if (scenario === "incremental") {
    const warm = spawnSync(executable, args, { cwd, encoding: "utf8" });
    if (warm.status !== 0) throw new Error(warm.stdout + warm.stderr);
  }
  const started = performance.now();
  let peakRssBytes;
  if (process.platform === "win32") {
    const stdout = path.join(directory, "stdout.txt"),
      stderr = path.join(directory, "stderr.txt");
    const metrics = path.join(directory, "metrics.json");
    const argumentList = args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`).join(" ");
    const command = `$p = Start-Process -FilePath ${quotePowerShell(executable)} -ArgumentList ${quotePowerShell(argumentList)} -WorkingDirectory ${quotePowerShell(cwd)} -WindowStyle Hidden -RedirectStandardOutput ${quotePowerShell(stdout)} -RedirectStandardError ${quotePowerShell(stderr)} -PassThru; $null = $p.Handle; $peak = 0; $watch = [Diagnostics.Stopwatch]::StartNew(); while (-not $p.HasExited) { $p.Refresh(); $peak = [Math]::Max($peak, $p.PeakWorkingSet64); Start-Sleep -Milliseconds 10 }; $p.WaitForExit(); $watch.Stop(); @{ exitCode = $p.ExitCode; peakRssBytes = $peak; durationMs = $watch.Elapsed.TotalMilliseconds } | ConvertTo-Json | Set-Content -LiteralPath ${quotePowerShell(metrics)}; exit $p.ExitCode`;
    const child = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8" },
    );
    if (child.status !== 0)
      throw new Error(
        child.stderr + readFileSync(stdout, "utf8") + readFileSync(stderr, "utf8"),
      );
    const measurement = JSON.parse(readFileSync(metrics, "utf8").replace(/^\uFEFF/u, ""));
    return { durationMs: measurement.durationMs, peakRssBytes: measurement.peakRssBytes };
  }
  const rss = path.join(directory, "rss.txt");
  const child = spawnSync("/usr/bin/time", ["-f", "%M", "-o", rss, executable, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stdout + child.stderr);
  peakRssBytes = Number(readFileSync(rss, "utf8").trim()) * 1024;
  return { durationMs: performance.now() - started, peakRssBytes };
};

const runs = [];
for (let iteration = 0; iteration < 9; iteration++) {
  const pair = { baseline: {}, candidate: {} };
  for (const name of iteration % 2
    ? ["candidate", "baseline"]
    : ["baseline", "candidate"]) {
    for (const scenario of ["typecheck", "build", "incremental"])
      pair[name][scenario] = measure(name, scenario, iteration);
  }
  runs.push(pair);
  console.log(`Completed isolated compiler comparison ${iteration + 1}/9`);
}
const scenarios = ["typecheck", "build", "incremental"].map((scenario) => {
  const summarize = (name) =>
    Object.fromEntries(
      ["durationMs", "peakRssBytes"].map((metric) => [
        metric,
        median(runs.map((run) => run[name][scenario][metric])),
      ]),
    );
  const base = summarize("baseline"),
    candidate = summarize("candidate");
  return {
    scenario,
    baseline: base,
    candidate,
    durationRatio: candidate.durationMs / base.durationMs,
    rssRatio: candidate.peakRssBytes / base.peakRssBytes,
  };
});
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      node: process.version,
      repetitions: 9,
      methodology:
        "Alternating isolated compiler processes; clean build state for cold checks and emit; unmeasured initial emit for incremental builds; medians and process peak RSS; npm and n8n CLI overhead excluded.",
      baseline,
      scenarios,
      runs,
    },
    null,
    2,
  ) + "\n",
);
console.table(scenarios);
console.log(`Report: ${output}`);
