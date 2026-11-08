#!/usr/bin/env node
/**
 * Warm-cache proof for R2 Item 2 loan-return import-chain versioning.
 *
 * Warm a browser on base 1867753, switch the same origin to the candidate
 * worktree without clearing cache, then:
 *  1. Reject any stale/old ?v= URLs for changed modules.
 *  2. Drive the real co-terminal renewal flow in that warmed context.
 *
 *   CHROME_PATH=... node scripts/qaWarmCacheLoanReturnImportChain.mjs
 */
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_COMMIT = process.env.BASE_COMMIT || "186775393ce1b433543758816ee2bda4f68c0f32";
const OUT_DIR = join(root, "qa/r2-02-evidence/warm-cache");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const WATCH = [
  "main.js",
  "loanMarket.js",
  "contractLifecycle.js",
  "seasonSimulator.js",
  "chronologicalSeason.js",
  "membershipBrowserFixture.js",
  "transferMigration.js",
  "careerSnapshot.js",
];

/** Minimum accepted candidate versions for modules changed by Item 2. */
const NEED = {
  "loanMarket.js": 105,
  "contractLifecycle.js": 103,
  "seasonSimulator.js": 107,
  "chronologicalSeason.js": 105,
  "membershipBrowserFixture.js": 107,
  "transferMigration.js": 103,
  "careerSnapshot.js": 103,
  "main.js": 114,
};

/** Base tip versions that must not be served after the candidate switch. */
const BASE_FORBIDDEN = {
  "loanMarket.js": new Set(["91"]),
  "contractLifecycle.js": new Set(["102"]),
  "seasonSimulator.js": new Set(["94"]),
  "chronologicalSeason.js": new Set(["94"]),
  "membershipBrowserFixture.js": new Set(["103"]),
  "transferMigration.js": new Set(["102"]),
  "careerSnapshot.js": new Set(["102"]),
  "main.js": new Set(["108"]),
};

function note(msg, data) {
  console.log(`• ${msg}`, data ? JSON.stringify(data) : "");
}

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}

function exportCommitTree(commit, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync(
    "bash",
    ["-lc", `git -C ${JSON.stringify(root)} archive --format=tar ${JSON.stringify(commit)} | tar -xf -`],
    { cwd: dest, stdio: ["ignore", "inherit", "inherit"] }
  );
}

function createSwitchableServer(initialRoot) {
  const state = { docRoot: initialRoot };
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      const filePath = normalize(join(state.docRoot, rel));
      if (!filePath.startsWith(state.docRoot)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      const ext = extname(filePath);
      const cacheControl =
        ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.message || err));
    }
  });
  return {
    state,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(process.env.PORT ? Number(process.env.PORT) : 0, "127.0.0.1", () =>
          resolve(server.address().port)
        );
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function classifyRequested(requested) {
  const classified = {};
  for (const name of WATCH) {
    const urls = requested.filter((u) => {
      try {
        const path = new URL(u).pathname;
        return path.endsWith(`/${name}`) || path.endsWith(name);
      } catch {
        return u.includes(`/${name}`) || u.includes(name);
      }
    });
    classified[name] = urls.map((u) => {
      const version = (u.match(/\?v=(\d+)/) || [])[1] || null;
      return { url: u, versioned: Boolean(version), version };
    });
  }
  return classified;
}

function assertCandidateChain(classified) {
  const failures = [];
  for (const [name, minV] of Object.entries(NEED)) {
    const rows = classified[name] || [];
    if (!rows.length) {
      // Some modules only load after fixture/simulate; checked later if needed.
      continue;
    }
    const ok = rows.some((r) => r.versioned && Number(r.version) >= minV);
    const bare = rows.some((r) => !r.versioned);
    const tooOld = rows.filter(
      (r) =>
        !r.versioned ||
        Number(r.version) < minV ||
        (BASE_FORBIDDEN[name] && BASE_FORBIDDEN[name].has(String(r.version)))
    );
    if (!ok) failures.push({ name, reason: `missing ?v>=${minV}`, rows });
    if (bare) failures.push({ name, reason: "unversioned URL still requested", rows });
    if (tooOld.length) {
      failures.push({
        name,
        reason: `stale/old URL still requested after candidate switch (need >=${minV})`,
        rows: tooOld,
      });
    }
  }
  return failures;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "r2-02-warm-"));
  const baseRoot = join(work, "base");
  note("exporting base commit tree", { BASE_COMMIT, baseRoot });
  exportCommitTree(BASE_COMMIT, baseRoot);

  const switcher = createSwitchableServer(baseRoot);
  const port = await switcher.listen();
  const baseUrl = `http://127.0.0.1:${port}/`;
  note("server listening", { baseUrl });

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const report = {
    baseCommit: BASE_COMMIT,
    candidateRoot: root,
    origin: baseUrl,
    cacheCleared: false,
  };

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    const baseMods = await page.evaluate((watch) => {
      const allJs = (performance.getEntriesByType("resource") || [])
        .map((e) => e.name)
        .filter((u) => /\.m?js(\?|$)/i.test(u));
      const byName = {};
      for (const w of watch) byName[w] = allJs.filter((u) => u.includes(w));
      return { byName, main: allJs.filter((u) => /\/main\.js/.test(u)) };
    }, WATCH);
    report.baseModules = baseMods;
    await writeFile(join(OUT_DIR, "base-modules.json"), JSON.stringify(baseMods, null, 2));

    switcher.state.docRoot = root;
    note("switched origin to candidate (cache retained)");

    const page2 = await context.newPage();
    const requested = [];
    page2.on("request", (req) => {
      const u = req.url();
      if (/\.m?js(\?|$)/i.test(u)) requested.push(u);
    });
    const pageErrors = [];
    page2.on("pageerror", (e) => pageErrors.push(String(e)));
    await page2.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    await page.close().catch(() => {});

    // Force the Item 2 import graph through the membership coterminal fixture.
    const loaded = await page2.evaluate(() =>
      window.__loadMembershipBrowserFixture?.({ mode: "ui-loan-return-coterminal", seed: 42 })
    );
    assert(loaded?.ok, "coterminal fixture loads on warm-switched candidate", loaded);

    const classified = classifyRequested(requested);
    report.candidateModules = { requested: [...new Set(requested)], classified };
    await writeFile(join(OUT_DIR, "candidate-modules.json"), JSON.stringify(report.candidateModules, null, 2));

    const failures = assertCandidateChain(classified);
    // Require the critical changed modules to have appeared with new versions.
    for (const name of ["loanMarket.js", "contractLifecycle.js", "membershipBrowserFixture.js", "main.js"]) {
      const rows = classified[name] || [];
      const minV = NEED[name];
      const ok = rows.some((r) => r.versioned && Number(r.version) >= minV);
      if (!ok) failures.push({ name, reason: `required module never requested at ?v>=${minV}`, rows });
    }
    report.importChainOk = failures.length === 0;
    report.importChainFailures = failures;
    assert(report.importChainOk, "candidate must load new Item 2 modules and reject stale URLs", {
      failures,
    });

    const endLoanProbe = await page2.evaluate(async () => {
      const urls = [...performance.getEntriesByType("resource")].map((e) => e.name);
      const lmUrl = urls.find((u) => {
        const m = u.match(/loanMarket\.js\?v=(\d+)/);
        return m && Number(m[1]) >= 105;
      });
      if (!lmUrl) return { ok: false, reason: "loanMarket-v105+-missing", urls: urls.filter((u) => u.includes("loanMarket")) };
      const mod = await import(lmUrl);
      return {
        ok:
          typeof mod.endLoan === "function" &&
          typeof mod.resolveLoanReturnEffectiveDate === "function" &&
          typeof mod.repairStalePendingLoanReturnBoundary === "function",
        lmUrl,
      };
    });
    report.endLoanProbe = endLoanProbe;
    assert(endLoanProbe.ok, "warm-loaded loanMarket exposes return + repair helpers", endLoanProbe);

    // Complete the real co-terminal renewal flow in this warmed context.
    const pre = await page2.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      const d = window.__getLiveCareerDebug?.() || {};
      return {
        seasons: snap?.player?.seasons?.length ?? 0,
        review: snap?.player?.pendingContractReview?.status || null,
        loan: snap?.player?.activeLoan?.status || null,
        next: d.nextAction || null,
        simDisabled: Boolean(document.getElementById("simulate-btn")?.disabled),
      };
    });
    assert(pre.review === "pending" && pre.loan === "active", "coterminal preconditions", pre);
    assert(pre.simDisabled === false, "Simulate enabled for soft-settle", pre);

    await page2.click("#simulate-btn");
    await page2.waitForTimeout(600);
    const gated = await page2.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      const overlay = document.getElementById("season-animation-overlay");
      return {
        seasons: snap?.player?.seasons?.length ?? 0,
        review: snap?.player?.pendingContractReview?.status || null,
        loan: snap?.player?.activeLoan?.status || null,
        clubLeagueId: snap?.player?.club?.leagueId || null,
        renewalOfferId: (snap?.player?.pendingOffers || []).find((o) => o.isRenewal)?.offerId || null,
        overlayHidden: !overlay || overlay.classList.contains("hidden"),
      };
    });
    assert(gated.review === "pending", "review intact after soft settle", gated);
    assert(gated.seasons === pre.seasons, "zero new season commits", gated);
    assert(gated.overlayHidden, "no season animation on pending gate", gated);
    assert(gated.clubLeagueId === "league:england-championship", "live CH after settle", gated);
    assert(gated.renewalOfferId, "renewal tray intact", gated);

    const accepted = await page2.evaluate((offerId) => {
      const snap = window.__exportCareerSnapshot?.();
      const offer = (snap?.player?.pendingOffers || []).find((o) => o.offerId === offerId);
      const fn = window.__acceptPipelineOffer || window.__acceptTransferOffer;
      if (!fn || !offer) return { ok: false, reason: "missing-accept" };
      return fn(offer);
    }, gated.renewalOfferId);
    assert(accepted?.ok, "accepted renewal in warmed context", accepted);

    await page2.click("#simulate-btn");
    // Drive presentation lightly until a new season commits.
    const started = Date.now();
    let after = null;
    while (Date.now() - started < 240000) {
      after = await page2.evaluate(() => {
        const visible = (el) => Boolean(el && !el.disabled && el.offsetParent !== null);
        const d = window.__getLiveCareerDebug?.() || {};
        const senior = document.getElementById("senior-scenario-overlay");
        const scenarioNext = document.getElementById("senior-scenario-next");
        if (visible(scenarioNext)) scenarioNext.click();
        else if (
          (d.nextAction?.id === "resolve-scenario" || (senior && !senior.classList.contains("hidden"))) &&
          window.__applyPendingSeniorScenarioPolicy
        ) {
          const applied = window.__applyPendingSeniorScenarioPolicy("balanced");
          const choices = [
            ...(document.getElementById("senior-scenario-choices")?.querySelectorAll("button") || []),
          ].filter(visible);
          const hit = choices[0];
          if (applied?.ok && hit) hit.click();
        } else {
          for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "continue-btn"]) {
            const b = document.getElementById(id);
            if (visible(b) || (id === "continue-btn" && b && !document.getElementById("animation-continue")?.classList.contains("hidden"))) {
              b.click();
              break;
            }
          }
          const stay = [...document.querySelectorAll("button")].filter(visible).find((b) =>
            /decline offers|stay|continue at|reject/i.test((b.textContent || "").trim())
          );
          if (stay && (d.pendingOffers?.length || d.pendingDecision)) stay.click();
        }
        const snap = window.__exportCareerSnapshot?.();
        const overlay = document.getElementById("season-animation-overlay");
        return {
          seasons: snap?.player?.seasons?.length ?? 0,
          clubLeagueId: snap?.player?.club?.leagueId || null,
          overlayHidden: !overlay || overlay.classList.contains("hidden"),
          next: d.nextAction?.id || null,
        };
      });
      if (after.seasons >= pre.seasons + 1 && after.overlayHidden && after.next !== "resolve-scenario") break;
      await page2.waitForTimeout(200);
    }
    assert(after?.seasons >= pre.seasons + 1, "warmed renewal played parent season", after);
    assert(after.clubLeagueId === "league:england-championship", "warmed desk is Championship", after);
    assert(pageErrors.length === 0, "no page errors in warmed renewal flow", { pageErrors });

    report.renewalFlow = { pre, gated, accepted, after, pageErrors };
    report.ok = true;
    await writeFile(join(OUT_DIR, "warm-cache-report.json"), JSON.stringify(report, null, 2));
    note("warm-cache proof PASS", { out: join(OUT_DIR, "warm-cache-report.json") });
  } catch (err) {
    report.ok = false;
    report.error = { message: String(err?.message || err), data: err?.data || null };
    await writeFile(join(OUT_DIR, "warm-cache-report.json"), JSON.stringify(report, null, 2)).catch(() => {});
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await switcher.close().catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("FAIL", err?.message || err, err?.data || "");
  process.exit(1);
});
