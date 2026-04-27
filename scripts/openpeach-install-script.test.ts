import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("install-openpeach.sh", () => {
  it("runs npm install with the project-local Node.js first on PATH", () => {
    const script = readFileSync("deploy/linux/install-openpeach.sh", "utf8");

    expect(script).toMatch(/env PATH=\\?"\$NODE_CURRENT_DIR\/bin:\$PATH\\?"/);
    expect(script).toMatch(/\\?"\$NPM_BIN\\?" install/);
  });

  it("allows overriding the Python interpreter used by node-gyp", () => {
    const script = readFileSync("deploy/linux/install-openpeach.sh", "utf8");

    expect(script).toContain("OPENPEACH_NODE_GYP_PYTHON");
    expect(script).toMatch(/NODE_GYP_FORCE_PYTHON=\\?"\$NODE_GYP_PYTHON\\?"/);
    expect(script).toMatch(/PYTHON=\\?"\$NODE_GYP_PYTHON\\?"/);
  });
});
