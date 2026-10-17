import { execFileSync } from "node:child_process";
import path from "node:path";

export default function globalTeardown() {
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "backend", "python", "-m", "app.cli.archive_test_menu", "--apply"],
    { cwd: path.resolve(__dirname, "../.."), stdio: "inherit" },
  );
}
