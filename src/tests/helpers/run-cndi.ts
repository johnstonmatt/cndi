import * as path from "https://deno.land/std@0.172.0/path/mod.ts";
const srcDir = Deno.cwd(); // this is the root of the project, runs on import (side-effect bad?)

export interface RunCndiResult {
  status: Deno.ProcessStatus;
  output: Uint8Array;
  stderror: Uint8Array;
}

const cmd = [
  "deno",
  "run",
  "--allow-all",
  "--unstable",
  path.join(srcDir, "main.ts"),
];

async function runCndi(...args: string[]) {
  const lastIndex = args.length - 1;
  if (args[lastIndex] === "--loud") {
    args.pop();
    const p = Deno.run({
      cmd: [...cmd, ...args],
      stdout: "inherit",
      stderr: "inherit",
    });

    const status = await p.status();
    p.close();
    return { status };
  } else {
    const p = Deno.run({
      cmd: [...cmd, ...args],
      stdout: "piped",
      stderr: "piped",
    });

    const [status, output, stderrOutput] = await Promise.all([
      p.status(),
      p.output(),
      p.stderrOutput(),
    ]);

    p.close();
    return { status, output, stderrOutput };
  }
}

async function runCndiLoud(...args: string[]) {
  const p = Deno.run({
    cmd: [...cmd, ...args],
  });

  const status = await p.status();
  p.close();
  return { status };
}

export { runCndi, runCndiLoud };