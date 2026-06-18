import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ascendToRepoRoot, tokenFromEnvFile, refreshBrokerageToken } from "../src/lib.js";

// Pins the systematic-staleness fix. Two defects this guards against:
//   1) repo-root resolution used a brittle fixed `../..` that silently pointed at the wrong
//      dir under a different build layout, breaking .env / data-file loading;
//   2) the only 401 recovery re-scraped Chrome, so a long-running process (the MCP) could
//      never pick up an out-of-band / peer-synced token — it kept serving the stale one.
// The fix: robust upward root resolution + RE-READ the .env file on a 401 (works headless,
// no logged-in Chrome required) before falling back to a local scrape.

function tmpEnv(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rh-env-"));
  const p = join(dir, ".env");
  writeFileSync(p, contents);
  return p;
}

describe("ascendToRepoRoot", () => {
  it("walks up to the repo root marker rather than assuming a fixed depth", () => {
    const root = ascendToRepoRoot();
    expect(typeof root).toBe("string");
    expect(existsSync(join(root as string, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("returns undefined when no marker can be found", () => {
    expect(ascendToRepoRoot(["this-marker-does-not-exist-anywhere.xyz"])).toBeUndefined();
  });
});

describe("tokenFromEnvFile", () => {
  it("reads the brokerage token, ignoring comments and blank lines", () => {
    const p = tmpEnv("# header comment\n\nROBINHOOD_BROKERAGE_TOKEN=abc123\nOTHER=x\n");
    expect(tokenFromEnvFile(p)).toBe("abc123");
  });

  it("strips surrounding quotes", () => {
    const p = tmpEnv('ROBINHOOD_BROKERAGE_TOKEN="quoted-tok"\n');
    expect(tokenFromEnvFile(p)).toBe("quoted-tok");
  });

  it("returns undefined for a missing file or a file with no token line", () => {
    expect(tokenFromEnvFile(join(tmpdir(), "definitely-missing-rh-xyz.env"))).toBeUndefined();
    expect(tokenFromEnvFile(tmpEnv("OTHER=1\n"))).toBeUndefined();
  });
});

describe("refreshBrokerageToken — disk re-read (scrape disabled)", () => {
  it("returns the on-disk token when it differs from the current stale one", () => {
    const p = tmpEnv("ROBINHOOD_BROKERAGE_TOKEN=fresh-from-disk\n");
    expect(refreshBrokerageToken("stale-old", { scrape: false, envPath: p })).toBe("fresh-from-disk");
  });

  it("returns undefined when the on-disk token equals the current one (nothing fresher)", () => {
    const p = tmpEnv("ROBINHOOD_BROKERAGE_TOKEN=same-tok\n");
    expect(refreshBrokerageToken("same-tok", { scrape: false, envPath: p })).toBeUndefined();
  });

  it("never scrapes when scrape:false and the file has no token", () => {
    const p = tmpEnv("OTHER=1\n");
    expect(refreshBrokerageToken("whatever", { scrape: false, envPath: p })).toBeUndefined();
  });
});
