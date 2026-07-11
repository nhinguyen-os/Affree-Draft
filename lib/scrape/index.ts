import type { Chain } from "@/lib/types";
import type { ChainScraper, ScrapedRow } from "./types";
import { scrapeBhx } from "./bhx";
import { scrapeConcung } from "./concung";
import { scrapeCoop } from "./coop";
import { scrapeAeon } from "./aeon";

export type { ScrapedRow } from "./types";

const SCRAPERS: Record<Chain, ChainScraper> = {
  bhx: scrapeBhx,
  concung: scrapeConcung,
  coop: scrapeCoop,
  aeon: scrapeAeon,
};

export interface ScrapeResult {
  rows: ScrapedRow[];
  perChain: Record<string, number>;
  errors: Record<string, string>;
}

/**
 * Cào tất cả chuỗi song song. Một chuỗi lỗi không làm hỏng cả mẻ —
 * vẫn upsert những chuỗi cào được.
 */
export async function scrapeAll(only?: Chain[]): Promise<ScrapeResult> {
  const chains = (only ?? (Object.keys(SCRAPERS) as Chain[]));
  const settled = await Promise.allSettled(chains.map((c) => SCRAPERS[c]()));

  const rows: ScrapedRow[] = [];
  const perChain: Record<string, number> = {};
  const errors: Record<string, string> = {};

  settled.forEach((res, i) => {
    const chain = chains[i];
    if (res.status === "fulfilled") {
      rows.push(...res.value);
      perChain[chain] = res.value.length;
    } else {
      errors[chain] = String(res.reason);
    }
  });

  return { rows, perChain, errors };
}
