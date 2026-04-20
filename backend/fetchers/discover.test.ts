import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractFunding,
  parseRssItems,
  cleanCompanyName,
  normalizeRound,
  normalizeAmount,
  roundMatches,
  sectorMatches,
} from "./discover/parse";
import { run } from "./discover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(resolve(__dirname, "../schema.sql"), "utf8");
  db.exec(schema);
  const cols = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("ats_source")) db.exec(`ALTER TABLE companies ADD COLUMN ats_source TEXT`);
  if (!names.has("ats_slug")) db.exec(`ALTER TABLE companies ADD COLUMN ats_slug TEXT`);
  if (!names.has("watching")) db.exec(`ALTER TABLE companies ADD COLUMN watching INTEGER NOT NULL DEFAULT 0`);
  if (!names.has("archived")) db.exec(`ALTER TABLE companies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  return db;
}

const TODAY = new Date().toISOString().split("T")[0];

function rssItem(title: string, date: string, link?: string, desc?: string): string {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <link>${link ?? `https://example.com/${title.toLowerCase().replace(/\s+/g, "-")}/`}</link>
    <pubDate>${new Date(date).toUTCString()}</pubDate>
    <description><![CDATA[${desc ?? "Some description about the company."}]]></description>
  </item>`;
}

function rssFeed(items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  ${items.join("\n")}
</channel></rss>`;
}

/** Mock fetch that returns the given XML for any URL. */
function mockFetchAll(xml: string) {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    text: async () => xml,
  }));
}

/** Mock fetch that returns TC XML for TC URLs, Google News XML for GN URLs,
 *  and 404 for TC pagination past page 1. */
function mockFetchSplit(tcXml: string, gnXml: string) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("news.google.com")) {
      return { ok: true, text: async () => gnXml };
    }
    // TC page 2+ → 404
    if (url.includes("paged=")) {
      return { ok: false, status: 404, statusText: "Not Found" };
    }
    return { ok: true, text: async () => tcXml };
  });
}

function withMockedFetch(fn: (mock: ReturnType<typeof vi.fn>) => Promise<void>, mock: ReturnType<typeof vi.fn>) {
  const orig = globalThis.fetch;
  globalThis.fetch = mock as any;
  return fn(mock).finally(() => { globalThis.fetch = orig; });
}

// ---------------------------------------------------------------------------
// Unit tests: parse.ts
// ---------------------------------------------------------------------------

describe("extractFunding", () => {
  it("parses 'raises $XM Series A'", () => {
    const r = extractFunding("Acme raises $20M Series A to build widgets");
    expect(r).toEqual({ company: "Acme", round: "Series A", amount: "$20M" });
  });

  it("parses 'closes $XM Series B'", () => {
    const r = extractFunding("FooBar closes $150M Series B led by Sequoia");
    expect(r).toEqual({ company: "FooBar", round: "Series B", amount: "$150M" });
  });

  it("parses seed round", () => {
    const r = extractFunding("Zeta raises $10M seed round to disrupt logistics");
    expect(r).toEqual({ company: "Zeta", round: "Seed", amount: "$10M" });
  });

  it("handles 'million' suffix", () => {
    const r = extractFunding("BigCo raises $200 million Series A to scale");
    expect(r?.amount).toBe("$200M");
  });

  it("handles 'billion' suffix", () => {
    const r = extractFunding("MegaCorp raises $1.5 billion Series B");
    expect(r?.amount).toBe("$1.5B");
  });

  it("handles alternative verbs", () => {
    expect(extractFunding("Alpha secures $25M Series A")?.company).toBe("Alpha");
    expect(extractFunding("Beta nabs $12M seed")?.company).toBe("Beta");
    expect(extractFunding("Gamma lands $40M Series B")?.company).toBe("Gamma");
    expect(extractFunding("Delta pulls in $8M seed")?.company).toBe("Delta");
  });

  it("returns null for non-funding titles", () => {
    expect(extractFunding("TechCo launches new AI product")).toBeNull();
    expect(extractFunding("OpenAI announces partnership")).toBeNull();
  });

  it("handles fallback pattern (round before amount)", () => {
    const r = extractFunding("WidgetCo announces Series A round of $30M");
    expect(r).toEqual({ company: "WidgetCo", round: "Series A", amount: "$30M" });
  });
});

describe("cleanCompanyName", () => {
  it("strips Exclusive: prefix", () => {
    expect(cleanCompanyName("Exclusive: StealthCo")).toBe("StealthCo");
  });
  it("strips possessive suffix", () => {
    expect(cleanCompanyName("Acme's")).toBe("Acme");
  });
  it("strips lead-in descriptors", () => {
    expect(cleanCompanyName("AI-powered media monitoring startup PeakMetrics")).toBe("PeakMetrics");
    expect(cleanCompanyName("Stablecoin card issuing infrastructure platform Kulipa")).toBe("Kulipa");
    expect(cleanCompanyName("Workforce planning startup Sona")).toBe("Sona");
  });
  it("strips trademark symbols", () => {
    expect(cleanCompanyName("Antaris™")).toBe("Antaris");
  });
  it("leaves simple names alone", () => {
    expect(cleanCompanyName("Acme")).toBe("Acme");
  });
});

describe("normalizeRound", () => {
  it("normalizes series letters", () => {
    expect(normalizeRound("series a")).toBe("Series A");
    expect(normalizeRound("Series B")).toBe("Series B");
  });
  it("normalizes seed", () => {
    expect(normalizeRound("seed")).toBe("Seed");
    expect(normalizeRound("pre-seed")).toBe("Pre-seed");
  });
});

describe("normalizeAmount", () => {
  it("handles M suffix", () => {
    expect(normalizeAmount("20", "M")).toBe("$20M");
    expect(normalizeAmount("150", "million")).toBe("$150M");
  });
  it("handles B suffix", () => {
    expect(normalizeAmount("1.5", "billion")).toBe("$1.5B");
  });
  it("defaults to M with no suffix", () => {
    expect(normalizeAmount("50")).toBe("$50M");
  });
});

describe("roundMatches", () => {
  it("matches by letter", () => {
    expect(roundMatches("Series A", ["a", "b"])).toBe(true);
    expect(roundMatches("Series C", ["a", "b"])).toBe(false);
  });
  it("matches seed", () => {
    expect(roundMatches("Seed", ["seed", "a"])).toBe(true);
  });
});

describe("sectorMatches", () => {
  it("returns true when no sectors specified", () => {
    expect(sectorMatches("anything", "anything", [])).toBe(true);
  });
  it("matches word boundaries", () => {
    expect(sectorMatches("AI infrastructure", "", ["AI"])).toBe(true);
    expect(sectorMatches("food delivery raises money", "", ["AI"])).toBe(false);
  });
});

describe("parseRssItems", () => {
  it("parses multiple items", () => {
    const xml = rssFeed([
      rssItem("Title One", "2026-04-01"),
      rssItem("Title Two", "2026-04-02"),
    ]);
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Title One");
    expect(items[1].title).toBe("Title Two");
  });

  it("strips HTML from descriptions", () => {
    const xml = rssFeed([
      rssItem("Title", "2026-04-01", undefined, "<p>Some <b>bold</b> text</p>"),
    ]);
    const items = parseRssItems(xml);
    expect(items[0].description).toBe("Some bold text");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: run() with mocked fetch
// ---------------------------------------------------------------------------

describe("discover run()", () => {
  it("merges candidates from multiple sources", async () => {
    const tcXml = rssFeed([
      rssItem("AlphaTC raises $20M Series A", TODAY),
    ]);
    const gnXml = rssFeed([
      rssItem("BetaGN raises $15M Series B", TODAY),
    ]);
    const db = setupDb();
    await withMockedFetch(async () => {
      const report = await run(db, { months: 1, rounds: ["a", "b"] });
      expect(report.candidates).toHaveLength(2);
      expect(report.sources_used).toContain("techcrunch");
      expect(report.sources_used).toContain("google-news");
    }, mockFetchSplit(tcXml, gnXml));
  });

  it("deduplicates the same company across sources", async () => {
    const tcXml = rssFeed([
      rssItem("SameCo raises $20M Series A for platform", TODAY),
    ]);
    const gnXml = rssFeed([
      rssItem("SameCo raises $20M Series A for platform", TODAY),
    ]);
    const db = setupDb();
    await withMockedFetch(async () => {
      const report = await run(db, { months: 1, rounds: ["a"] });
      expect(report.candidates).toHaveLength(1);
    }, mockFetchSplit(tcXml, gnXml));
  });

  it("deduplicates against existing companies in DB", async () => {
    const xml = rssFeed([
      rssItem("Existing Inc raises $30M Series A", TODAY),
      rssItem("NewCo raises $15M Series B", TODAY),
    ]);
    const db = setupDb();
    db.prepare(`INSERT INTO companies (name) VALUES (?)`).run("Existing Inc");
    await withMockedFetch(async () => {
      const report = await run(db, { months: 1, rounds: ["a", "b"] });
      expect(report.candidates).toHaveLength(1);
      expect(report.candidates[0].company).toBe("NewCo");
      expect(report.already_tracked).toBe(1);
    }, mockFetchAll(xml));
  });

  it("deduplicates existing companies case-insensitively", async () => {
    const xml = rssFeed([
      rssItem("acme raises $30M Series A", TODAY),
    ]);
    const db = setupDb();
    db.prepare(`INSERT INTO companies (name) VALUES (?)`).run("Acme");
    await withMockedFetch(async () => {
      const report = await run(db, { months: 1, rounds: ["a"] });
      expect(report.candidates).toHaveLength(0);
      expect(report.already_tracked).toBe(1);
    }, mockFetchAll(xml));
  });

  it("skips articles older than the lookback window", async () => {
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 6);
    const xml = rssFeed([
      rssItem("OldCo raises $20M Series A", oldDate.toISOString()),
      rssItem("NewCo raises $10M Series B", TODAY),
    ]);
    const db = setupDb();
    await withMockedFetch(async () => {
      const report = await run(db, { months: 3, rounds: ["a", "b"] });
      // Only NewCo should appear (OldCo is 6 months old, window is 3)
      const companies = report.candidates.map((c) => c.company);
      expect(companies).toContain("NewCo");
      expect(companies).not.toContain("OldCo");
    }, mockFetchAll(xml));
  });

  it("survives a source failure gracefully", async () => {
    const tcXml = rssFeed([
      rssItem("GoodCo raises $20M Series A", TODAY),
    ]);
    const mock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("news.google.com")) {
        throw new Error("network error");
      }
      if (url.includes("paged=")) {
        return { ok: false, status: 404, statusText: "Not Found" };
      }
      return { ok: true, text: async () => tcXml };
    });
    const db = setupDb();
    await withMockedFetch(async () => {
      const report = await run(db, { months: 1, rounds: ["a"] });
      expect(report.candidates).toHaveLength(1);
      expect(report.candidates[0].company).toBe("GoodCo");
      expect(report.sources_used).toContain("techcrunch");
      expect(report.sources_used).not.toContain("google-news");
    }, mock);
  });
});
