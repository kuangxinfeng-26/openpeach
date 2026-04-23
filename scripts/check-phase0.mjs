import { spawn } from "node:child_process";

const commands = [
  ["run", "check"],
  ["test"],
  ["run", "doctor"],
];

for (const args of commands) {
  const exitCode = await runNpm(args);
  if (exitCode !== 0) {
    process.exit(exitCode ?? 1);
  }
}

async function runNpm(args) {
  console.log(`> npm ${args.join(" ")}`);

  const child =
    process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
          stdio: "inherit",
        })
      : spawn("npm", args, {
          stdio: "inherit",
        });

  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
