import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {test} from "node:test";
import {customFilename, namingSettings, paperFilename} from "../extension/papers.js";

const doi = "10.1038/s41467-021-26674-1";
const pmcid = "PMC8578255";
const title = "Network analysis reveals rare disease signatures across multiple levels of biological organization";
const expected = "2021-Buphamalai-Network_analysis_reveals_rare_disease_signatures_across_multiple_levels_of_biological_organization.pdf";
const nature = "https://www.nature.com/articles/s41467-021-26674-1.pdf";
const pmc = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8578255/pdf/41467_2021_Article_26674.pdf";
const repository = "https://repository.example/download/42";

const handlers = {};
let session = {};
let naming;
let requests = [];
let offline = false;
let slowPmid = false;
let pmidMatches = [{source: "MED", doi, id: "34753928"}];
const event = name => ({addListener: listener => { handlers[name] = listener; }});
globalThis.chrome = {
  permissions: {contains: async () => true, onAdded: event("grant"), onRemoved: event("revoke")},
  runtime: {onStartup: event("start"), onInstalled: event("install"), onMessage: event("message")},
  downloads: {onDeterminingFilename: event("download")},
  storage: {local: {get: async () => ({naming})}, session: {
    get: async () => session,
    set: async value => { session = {...session, ...value}; },
  }},
};
globalThis.fetch = async (value, options) => {
  requests.push(new URL(value));
  assert.equal(options.credentials, "omit");
  if (offline) throw new Error("Network unavailable");
  if (requests.at(-1).searchParams.get("query")?.includes("SRC:MED")) {
    if (slowPmid) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {once: true});
      });
    }
    return {ok: true, json: async () => ({hitCount: pmidMatches.length, resultList: {result: pmidMatches}})};
  }
  const record = requests.at(-1).hostname === "api.crossref.org"
    ? {message: {DOI: doi, type: "journal-article", "published-online": {"date-parts": [[2021]]},
      title: [title], "container-title": ["Nature Communications"], author: [{family: "Buphamalai"}]}}
    : {resultList: {result: [{pmcid, doi, title, pmid: "34753928", journalInfo: {journal: {title: "Nature Communications"}}, firstPublicationDate: "2021-11-09",
      authorList: {author: [{lastName: "Buphamalai"}]}}]}};
  return {ok: true, json: async () => record};
};

await import("../extension/background.js");

function suggest(url, overrides) {
  return new Promise(resolve => handlers.download({url, finalUrl: url, filename: "paper.pdf",
    mime: "application/pdf", ...overrides}, resolve));
}

test("Nature and PMC produce the same filename, including a redirected download", async () => {
  for (const url of [nature, pmc]) {
    assert.deepEqual(await suggest(url, {finalUrl: "https://cdn.example/file.pdf"}), {
      filename: expected, conflictAction: "uniquify",
    });
  }
  assert.equal(requests[1].searchParams.get("query"), `PMCID:${pmcid}`);
});

test("Generic citation tags tie metadata to the exact PDF URL", async () => {
  const script = await readFile(new URL("../extension/article-page.js", import.meta.url), "utf8");
  const page = "https://repository.example/article/42";
  const tags = {
    citation_title: title, citation_author: "Buphamalai, Pisanu", citation_date: "2021-11-09",
    citation_journal_title: "Nature Communications", citation_pdf_url: "/download/42",
  };
  const registered = new Promise(resolve => {
    runInNewContext(script, {
      URL,
      document: {baseURI: page, querySelectorAll: selector => selector === "meta[name]"
        ? Object.entries(tags).map(([name, content]) => ({name, content})) : []},
      chrome: {runtime: {sendMessage: message => new Promise(reply => {
        handlers.message(message, {url: page, frameId: 0}, result => {
          resolve(result);
          reply(result);
        });
      })}},
    });
  });
  assert.equal(await registered, true);
  assert.equal((await suggest(repository)).filename, expected);
  assert.equal(await suggest(repository + "?supplement=1"), undefined);
});

test("Ordinary, supplemental, non-PDF and conflicting links retain their names", async () => {
  const count = requests.length;
  for (const [url, overrides] of [
    ["https://example.org/manual.pdf"],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC8578255/bin/41467_2021_26674_MOESM3_ESM.pdf"],
    [pmc, {filename: "reporting_summary.pdf"}],
    [pmc + "?supplement=1"],
    [nature, {mime: "text/html"}],
    [nature, {finalUrl: "https://www.nature.com/articles/s41467-021-26674-2.pdf"}],
  ]) assert.equal(await suggest(url, overrides), undefined);
  assert.equal(requests.length, count);
});

test("Failed metadata requests preserve the original Chrome filename", async () => {
  offline = true;
  try {
    assert.equal(await suggest(nature), undefined);
  } finally {
    offline = false;
  }
});

test("Unicode survives truncation and unsafe filename characters are removed", () => {
  assert.equal(paperFilename({year: 2021, family: "de la Cruz", title: "A: B &amp; C / D"}), "2021-de_la_Cruz-A_B_&_C_D.pdf");
  const name = paperFilename({year: 2021, family: "山田", title: "論文".repeat(100)});
  assert.match(name, /^2021-山田-[論文]+\.pdf$/);
  assert.ok(Buffer.byteLength(name) <= 230);
});

test("Saved format is applied across metadata sources", async () => {
  naming = {template: "PMID-{pmid}-{journal}", space: " "};
  try {
    for (const url of [nature, pmc]) {
      assert.equal((await suggest(url)).filename, "PMID-34753928-Nature Communications.pdf");
    }
    assert.equal(requests.filter(url => url.searchParams.get("query")?.includes("SRC:MED")).length, 1);
  } finally {
    naming = undefined;
  }
});

test("Missing, conflicting, or mismatched PMID uses the default format", async () => {
  naming = {template: "PMID-{pmid}", space: "_"};
  const original = pmidMatches;
  try {
    for (const rows of [[], [{source: "MED", doi: "10.1038/other", id: "1"}],
      [...original, {source: "MED", doi, id: "1"}]]) {
      pmidMatches = rows;
      assert.equal((await suggest(nature)).filename, expected);
    }
  } finally {
    pmidMatches = original;
    naming = undefined;
  }
});

test("Custom formatting validates input and retains trailing identifiers", () => {
  for (const template of ["", "fixed", "{unknown}", "{year}/{author}", "{{year}}"]) {
    assert.equal(namingSettings(template, "_"), null);
  }
  const record = {year: 2021, family: "de la Cruz", title: "論文".repeat(100), doi};
  for (const space of ["_", " ", "-"]) {
    assert.equal(customFilename(record, namingSettings("{author}.pdf", space)),
      `de${space}la${space}Cruz.pdf`);
  }
  const filename = customFilename(record, namingSettings("{title}-{doi}", " "));
  assert.ok(filename.endsWith("-10.1038_s41467-021-26674-1.pdf"));
  assert.ok(Buffer.byteLength(filename) <= 230);
});

test("PMID lookup timeout retains the already resolved default filename", async () => {
  naming = {template: "{pmid}", space: "_"};
  slowPmid = true;
  try {
    assert.equal((await suggest(nature)).filename, expected);
  } finally {
    slowPmid = false;
    naming = undefined;
  }
});
