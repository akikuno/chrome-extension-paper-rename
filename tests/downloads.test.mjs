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
const springerDoi = "10.1038/s44318-026-00977-9";
const springerTitle = "NFYA regulates spermatogenesis through multifaceted chromatin interactions";
const springerReferenceDoi = "10.1186/s13059-026-04335-0";
const springerReferenceTitle = "quasar: flexible and efficient count-distribution and mixed-model methods for eQTL mapping";
const oupDoi = "10.1093/molbev/msaf023";
const narDoi = "10.1093/nar/gkaf1108";
const narTitle = "connectomeDB2025: a rigorously curated, multi-species resource of experimentally supported ligand–receptor interactions";
const oupTitle = "Combinatorial In Vivo Genome Editing Identifies Widespread Epistasis and an Accessible Fitness Landscape During Lung Tumorigenesis";

const handlers = {};
let session = {};
let naming;
let requests = [];
let offline = false;
let slowPmid = false;
let pmidMatches = [{source: "MED", doi, id: "34753928"}];
const bioinformaticsWork = {
  DOI: "10.1093/bioinformatics/bty605", type: "journal-article", volume: "34", issue: "17", page: "i857-i865",
  published: {"date-parts": [[2018]]}, title: ["Ontology-based validation and identification of regulatory phenotypes"],
  author: [{family: "Kulmanov"}],
};
let bioinformaticsMatches = [{...bioinformaticsWork, page: "i856-i857"}, bioinformaticsWork];
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
  if (requests.at(-1).searchParams.has("query.bibliographic")) {
    return {ok: true, json: async () => ({message: {items: bioinformaticsMatches}})};
  }
  if (decodeURIComponent(requests.at(-1).pathname) === `/works/${oupDoi}`) {
    return {ok: true, json: async () => ({message: {DOI: oupDoi, type: "journal-article",
      "published-online": {"date-parts": [[2025]]}, title: [oupTitle], author: [{family: "Hebert"}]}})};
  }
  if (decodeURIComponent(requests.at(-1).pathname) === `/works/${narDoi}`) {
    return {ok: true, json: async () => ({message: {DOI: narDoi, type: "journal-article",
      "published-online": {"date-parts": [[2025]]}, title: [narTitle], author: [{family: "Liu"}]}})};
  }
  if (decodeURIComponent(requests.at(-1).pathname) === `/works/${springerDoi}`) {
    return {ok: true, json: async () => ({message: {DOI: springerDoi, type: "journal-article",
      "published-online": {"date-parts": [[2026]]}, title: [springerTitle], author: [{family: "Wang"}]}})};
  }
  if (decodeURIComponent(requests.at(-1).pathname) === `/works/${springerReferenceDoi}`) {
    return {ok: true, json: async () => ({message: {DOI: springerReferenceDoi, type: "journal-article",
      "published-online": {"date-parts": [[2026]]}, title: [springerReferenceTitle], author: [{family: "Pullin"}]}})};
  }
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

test("Springer article PDF uses the DOI without the file extension", async () => {
  const url = `https://link.springer.com/content/pdf/${springerDoi}.pdf`;
  assert.deepEqual(await suggest(url), {
    filename: "2026-Wang-NFYA_regulates_spermatogenesis_through_multifaceted_chromatin_interactions.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(decodeURIComponent(requests.at(-1).pathname), `/works/${springerDoi}`);
});

test("Springer Article in Press PDF excludes the reference suffix from the DOI", async () => {
  const url = `https://link.springer.com/content/pdf/${springerReferenceDoi}_reference.pdf`;
  assert.equal((await suggest(url))?.filename,
    "2026-Pullin-quasar_flexible_and_efficient_count-distribution_and_mixed-model_methods_for_eQTL_mapping.pdf");
  assert.equal(decodeURIComponent(requests.at(-1).pathname), `/works/${springerReferenceDoi}`);
});

test("Oxford Academic issue and advance PDFs resolve the same DOI across a CDN redirect", async () => {
  const publisher = "https://academic.oup.com/mbe";
  const finalUrl = "https://watermark02.silverchair.com/msaf023.pdf?token=test";
  for (const path of [
    "article-pdf/42/2/msaf023/61766815/msaf023.pdf",
    `advance-article-pdf/doi/${oupDoi}/61766815/msaf023.pdf`,
  ]) {
    assert.deepEqual(await suggest(`${publisher}/${path}`, {finalUrl}), {
      filename: `2025-Hebert-${oupTitle.replaceAll(" ", "_")}.pdf`, conflictAction: "uniquify",
    });
    assert.equal(decodeURIComponent(requests.at(-1).pathname), `/works/${oupDoi}`);
  }
  assert.equal(await suggest(`${publisher}/article-pdf/42/2/msaf023/61766815/other.pdf`), undefined);
  assert.equal(await suggest(finalUrl), undefined);
});

test("NAR watermark PDF resolves its DOI without sending the download token", async () => {
  const pdf = "https://watermark02.silverchair.com/gkaf1108.pdf?token=test";
  assert.equal((await suggest(pdf))?.filename,
    "2025-Liu-connectomeDB2025_a_rigorously_curated,_multi-species_resource_of_experimentally_supported_ligand–receptor_interactions.pdf");
  assert.equal(decodeURIComponent(requests.at(-1).pathname), `/works/${narDoi}`);
  assert.equal(requests.at(-1).search, "");
  const count = requests.length;
  assert.equal(await suggest("https://example.org/gkaf1108.pdf"), undefined);
  assert.equal(await suggest(pdf.replace(".pdf", "_supplement.pdf")), undefined);
  assert.equal(requests.length, count);
});

test("Bioinformatics watermark PDF is matched by volume, issue and first page", async () => {
  const pdf = "https://watermark02.silverchair.com/bioinformatics_34_17_i857.pdf?token=test";
  assert.equal((await suggest(pdf)).filename,
    "2018-Kulmanov-Ontology-based_validation_and_identification_of_regulatory_phenotypes.pdf");
  assert.equal(requests.at(-1).searchParams.get("query.bibliographic"), "Bioinformatics 34 17 i857");
  assert.equal(requests.at(-1).searchParams.has("token"), false);
  assert.equal(await suggest(pdf, {finalUrl: pdf.replace("i857", "i858")}), undefined);
  const original = bioinformaticsMatches;
  try {
    bioinformaticsMatches = [...original, {...bioinformaticsWork, DOI: "10.1093/bioinformatics/other"}];
    assert.equal(await suggest(pdf), undefined);
  } finally {
    bioinformaticsMatches = original;
  }
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
  assert.equal((await suggest(repository, {finalUrl: "https://cdn.example/opaque.pdf"})).filename, expected);
  assert.equal(await suggest(repository + "?supplement=1"), undefined);
});

test("A changed PDF token is matched only with the registered article referrer", async () => {
  const page = "https://publisher.example/articles/42";
  const pdf = "https://delivery.example/42.pdf?edition=published";
  const registered = await new Promise(resolve => handlers.message({
    kind: "article", pdfUrl: pdf + "&token=old", title, family: "Buphamalai", year: "2021", doi,
  }, {url: page, frameId: 0}, resolve));
  assert.equal(registered, true);
  const renewed = pdf + "&token=new";
  assert.equal((await suggest(renewed, {referrer: page})).filename, expected);
  assert.equal(await suggest(renewed), undefined);
  assert.equal(await suggest(renewed, {referrer: "https://publisher.example/"}), undefined);
  assert.equal(await suggest(renewed.replace("published", "other"), {referrer: page}), undefined);
  assert.equal(await suggest(renewed.replace("42.pdf", "supplement.pdf"), {referrer: page}), undefined);
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
