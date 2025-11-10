// fetchOperators.js
// Usage: node src/fetchOperators.js
// NOTE: add "type": "module" to package.json to avoid ESM warnings.

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pages qui listent les opérateurs par rareté (tu peux modifier/ajouter)
const rarityPages = [
  "Operator/1-star",
  "Operator/2-star",
  "Operator/3-star",
  "Operator/4-star",
  "Operator/5-star",
  "Operator/6-star"
];

const BASE = "https://arknights.wiki.gg/wiki/";

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: {
      // User-Agent plus "normal" pour éviter certains blocages
      "User-Agent": "Mozilla/5.0 (compatible; fetchOperatorsBot/1.0; +https://example.local)"
    }
  });
  return res.data;
}

function textMatches(a, b) {
  if (!a) return false;
  return a.trim().toLowerCase().includes(b.toLowerCase());
}

/**
 * Robust helper that tries several ways to read an infobox field:
 * - portable-infobox data-source attributes (.pi-data-label / .pi-data-value)
 * - classic table th/td pairs
 * - fallback: find label text and the following sibling text
 */
function extractField($, label) {
  // 1) portable-infobox style: div.pi-data with .pi-data-label and .pi-data-value
  const pi = $(`.pi-data`).filter((i, el) => {
    const lbl = $(el).find(".pi-data-label").text();
    return lbl && lbl.trim().toLowerCase() === label.toLowerCase();
  }).first();
  if (pi && pi.length) {
    const val = pi.find(".pi-data-value").text().trim();
    if (val) return val;
  }

  // 2) search .pi-data-label contains label
  const pi2 = $(`.pi-data-label`).filter((i, el) => {
    return $(el).text().trim().toLowerCase() === label.toLowerCase();
  }).first();
  if (pi2 && pi2.length) {
    const val = pi2.next(".pi-data-value").text().trim();
    if (val) return val;
  }

  // 3) classic table: find th with label
  const th = $(`th`).filter((i, el) => textMatches($(el).text(), label)).first();
  if (th && th.length) {
    const td = th.next("td");
    if (td && td.length) {
      const txt = td.text().trim();
      if (txt) return txt;
    }
  }

  // 4) fallback: any element whose text equals label, take next sibling text
  const candidate = $(`*:contains("${label}")`).filter((i, el) => {
    return $(el).children().length === 0 && $(el).text().trim().toLowerCase() === label.toLowerCase();
  }).first();
  if (candidate && candidate.length) {
    const sib = candidate.next();
    if (sib && sib.length) {
      const t = sib.text().trim();
      if (t) return t;
    }
  }

  return ""; // nothing found
}

async function parseOperatorPage(opUrl) {
  try {
    const html = await fetchHtml(opUrl);
    const $ = cheerio.load(html);

    // Name
    let name = $("#firstHeading").text().trim() || $(".pi-title").text().trim();

    // Try OG image for full image
    let fullImage = $('meta[property="og:image"]').attr("content") || "";

    // Portrait: try portable-infobox image
    let portrait = "";
    const piImage = $(".pi-image .image img").first();
    if (piImage && piImage.length) portrait = piImage.attr("src");

    // If portrait is relative, prefix with site root
    if (portrait && portrait.startsWith("//")) portrait = "https:" + portrait;
    if (portrait && portrait.startsWith("/")) portrait = "https://arknights.wiki.gg" + portrait;

    if (fullImage && fullImage.startsWith("//")) fullImage = "https:" + fullImage;
    if (fullImage && fullImage.startsWith("/")) fullImage = "https://arknights.wiki.gg" + fullImage;

    // Fields
    const rarityRaw = extractField($, "Rarity") || extractField($, "Rarity/Stars") || extractField($, "Star");
    const rarity = (rarityRaw.match(/★/g) || []).length || (rarityRaw.match(/\d+/) ? Number(rarityRaw.match(/\d+/)[0]) : "");

    const gender = extractField($, "Gender") || extractField($, "Sex") || "";
    const className = extractField($, "Class") || extractField($, "Role") || "";
    const archetype = extractField($, "Archetype") || extractField($, "Type") || "";
    const faction = extractField($, "Faction") || extractField($, "Affiliation") || "";
    const race = extractField($, "Race") || "";
    const region = extractField($, "Region") || extractField($, "Origin") || "";

    // Release info: try to find 'Released' / 'Release date' / 'Recruitment' etc.
    const releaseRaw = extractField($, "Released") || extractField($, "Release") || extractField($, "Release Date") || extractField($, "Recruitment") || "";
    let date_global = "";
    let event_name = "";

    if (releaseRaw) {
      // try to parse a date (very fuzzy): look for yyyy-mm-dd or dd Month yyyy or yyyy/mm/dd
      const iso = releaseRaw.match(/\d{4}-\d{2}-\d{2}/);
      if (iso) date_global = iso[0];
      else {
        const y = releaseRaw.match(/\d{4}/);
        if (y) date_global = y[0]; // fallback to year
      }

      // for event name, try to remove date parts
      event_name = releaseRaw.replace(date_global, "").trim();
      if (!event_name) event_name = releaseRaw;
    }

    // tidy strings
    const tidy = (s) => (s ? s.replace(/\s+/g, " ").trim() : "");

    return {
      name: tidy(name),
      gender: tidy(gender),
      rarity: rarity || "",
      class: tidy(className),
      archetype: tidy(archetype),
      faction: tidy(faction),
      race: tidy(race),
      region: tidy(region),
      release: { date_global: tidy(date_global), event_name: tidy(event_name) },
      image: { portrait: tidy(portrait), full: tidy(fullImage) },
      source: opUrl
    };
  } catch (err) {
    console.error("parseOperatorPage error for", opUrl, err.message);
    return null;
  }
}

async function fetchOperatorLinksFromListing(listPageUrl) {
  const html = await fetchHtml(listPageUrl);
  const $ = cheerio.load(html);

  // Collect links inside the main content that look like operator pages.
  // Heuristics: href containing '/Operator' or links to pages that look like operator names.
  const links = new Set();

  // 1) specific pattern: links under content with '/Operator/'
  $("#mw-content-text a[href^='/wiki/Operator']").each((i, el) => {
    const h = $(el).attr("href");
    if (h && !h.includes(":")) links.add(new URL(h, "https://arknights.wiki.gg").href);
  });

  // 2) fallback: any link in content that is not a category or file, filter by likely operator pages (no colons, not Help)
  $("#mw-content-text a[href^='/wiki/']").each((i, el) => {
    const h = $(el).attr("href");
    if (!h) return;
    if (h.includes(":")) return; // skip File:, Category:, Help:, etc.
    // skip obvious non-operator pages like /wiki/Operators or lists
    if (h.match(/Operator(s)?$/)) return;
    // Heuristic: many operator pages are of the form /wiki/<Name> or /wiki/Operator/<name>
    // Accept if link text length < 40 and contains letters
    const txt = $(el).text().trim();
    if (txt && txt.length < 40 && /[A-Za-z\u00C0-\u024F]/.test(txt)) {
      links.add(new URL(h, "https://arknights.wiki.gg").href);
    }
  });

  return Array.from(links);
}

async function main() {
  const operatorUrls = new Set();

  for (const page of rarityPages) {
    const url = BASE + page;
    console.log("Fetching listing:", url);
    try {
      const links = await fetchOperatorLinksFromListing(url);
      console.log(` → found ${links.length} links on ${page}`);
      links.forEach((l) => operatorUrls.add(l));
      // be polite: short delay
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.error("Failed to fetch listing", url, err.message);
    }
  }

  const urls = Array.from(operatorUrls).sort();
  console.log("Total unique operator pages to parse:", urls.length);

  const operators = [];
  for (const u of urls) {
    console.log("Parsing:", u);
    const op = await parseOperatorPage(u);
    if (op) operators.push(op);
    // small delay to avoid hammering the wiki
    await new Promise((r) => setTimeout(r, 500));
  }

  // normalize & dedupe by name, then alphabetical sort
  const byName = new Map();
  for (const o of operators) {
    if (!o || !o.name) continue;
    if (!byName.has(o.name)) byName.set(o.name, o);
  }
  const final = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));

  const outPath = path.join(__dirname, "components", "operators.json");
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2), "utf8");
  console.log(`✅ ${final.length} operators saved to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
