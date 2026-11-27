const doiPattern = /^10\.\d{4,9}\/[a-z0-9._;()/:-]+$/i;
const supplement = /(?:\/bin\/|\/supplement(?:ary|al)?(?:\/|$)|(?:^|[._/ -])(?:moesm\d*|supp(?:lement(?:al|ary)?)?(?:[-_ ]?(?:info(?:rmation)?|data|material|file|fig(?:ure)?|table))?\d*|reporting[-_ ]summary|source[-_ ]data)(?:[._/ -]|$))/i;

export function parseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function urlKey(value) {
  const url = parseUrl(value);
  if (!url) return null;
  url.hash = "";
  return url.href;
}

export function isSupplement(value) {
  const url = parseUrl(value);
  if (url && [...url.searchParams].some(([key, field]) =>
    /^(?:supplement(?:ary|al)?|supporting[-_]?info)$/i.test(key)
    || supplement.test(`/${field}/`))) return true;
  try {
    return supplement.test(decodeURIComponent(url?.pathname ?? value ?? ""));
  } catch {
    return supplement.test(value || "");
  }
}

export function normalizeDoi(value) {
  const doi = typeof value === "string" ? value.trim().replace(/^https?:\/\/doi\.org\//i, "") : "";
  return doiPattern.test(doi) ? doi.toLowerCase() : null;
}

export function identify(value) {
  const url = parseUrl(value);
  if (!url) return null;
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const pmc = /^\/articles\/(PMC\d+)\/pdf(?:\/[^/]+\.pdf|\/?)$/i.exec(path);
  if (url.hostname === "pmc.ncbi.nlm.nih.gov" && pmc) {
    return {type: "pmcid", id: pmc[1].toUpperCase()};
  }
  const nature = /^\/articles\/((?:s\d{5}-[a-z0-9-]+|nature\d+))\.pdf$/i.exec(path);
  if (["www.nature.com", "nature.com"].includes(url.hostname) && nature) {
    return {type: "doi", id: normalizeDoi(`10.1038/${nature[1]}`)};
  }
  if (["link.springer.com", "link.springernature.com"].includes(url.hostname)) {
    path = path.replace(/^(\/content\/pdf\/10\.\d{4,9}\/.+?)(?:_reference)?\.pdf$/i, "$1");
  }
  if (url.hostname === "academic.oup.com") {
    const issuePdf = /^\/mbe\/article-pdf\/\d+\/\d+\/([a-z]{4}\d{3})\/\d+\/\1\.pdf$/i.exec(path);
    const advancePdf = /^\/[a-z0-9-]+\/advance-article-pdf\/doi\/(10\.1093\/[a-z0-9-]+\/([a-z0-9-]+))\/\d+\/\2\.pdf$/i.exec(path);
    const doi = normalizeDoi(issuePdf ? `10.1093/molbev/${issuePdf[1]}` : advancePdf?.[1]);
    if (doi) return {type: "doi", id: doi};
  }
  const silverchair = /^watermark\d+\.silverchair\.com$/.test(url.hostname);
  if (silverchair) {
    const nar = /^\/(gk[a-z]{2}\d+)\.pdf$/i.exec(path);
    if (nar) return {type: "doi", id: normalizeDoi(`10.1093/nar/${nar[1]}`)};
  }
  const bioinformatics = silverchair
    ? /^\/bioinformatics_(\d+)_(\d+)_([a-z]?\d+)\.pdf$/i.exec(path)
    : url.hostname === "academic.oup.com"
      ? /^\/bioinformatics\/article-pdf\/(\d+)\/(\d+)\/([a-z]?\d+)\/\d+\/bioinformatics_\1_\2_\3\.pdf$/i.exec(path)
      : null;
  if (bioinformatics) {
    const [, volume, issue, page] = bioinformatics;
    return {type: "bioinformatics", volume, issue, page: page.toLowerCase()};
  }
  const doiPath = /(?:^|\/)(?:pdf|epdf|pdfdirect)\/(10\.\d{4,9}\/.+)$/i.exec(path);
  const doi = normalizeDoi(doiPath?.[1] ??
    (/\/(?:pdf|file)\/?$/i.test(path) ? url.searchParams.get("id") ?? url.searchParams.get("doi") : null));
  return doi ? {type: "doi", id: doi} : null;
}

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/<\/?[a-z][^>]*>/gi, "").replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " "};
      if (entity[1] !== "#") return named[entity.toLowerCase()];
      const hex = entity[2].toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : "";
    })
    : "";
}

function filenamePart(value) {
  return cleanText(value).normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, " ")
    .trim().replace(/^[._]+|[._]+$/g, "").replace(/\s+/gu, "_");
}

export function paperFilename(record) {
  const year = String(record?.year ?? "");
  const family = filenamePart(record?.family);
  const title = filenamePart(record?.title);
  if (!/^[12]\d{3}$/.test(year) || !family || !title) return null;
  const prefix = `${year}-${family}-`;
  const encoder = new TextEncoder();
  let available = 230 - encoder.encode(prefix).length - 4;
  let shortened = "";
  for (const character of title) {
    available -= encoder.encode(character).length;
    if (available < 0) break;
    shortened += character;
  }
  shortened = shortened.replace(/[._]+$/g, "");
  return shortened ? `${prefix}${shortened}.pdf` : null;
}

export const defaultNaming = {template: "{year}-{author}-{title}", space: "_"};

const fields = /\{(year|author|title|journal|doi|pmid)\}/g;
const unsafe = /[<>:"/\\|?*\p{Cc}\p{Cf}]/u;
const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;

export function namingSettings(template, space) {
  if (typeof template !== "string" || !["_", " ", "-"].includes(space)) return null;
  const stem = template.trim().replace(/\.pdf$/i, "").trim();
  const literals = stem.replace(fields, "");
  if (stem.length > 512 || stem === literals || unsafe.test(literals) || /[{}]/.test(literals)) return null;
  return {template: stem, space};
}

export function normalizePmid(value) {
  return /^[1-9]\d*$/.test(value ?? "") ? String(value) : null;
}

export function customFilename(record, {template, space}) {
  if (template === defaultNaming.template && space === defaultNaming.space) return paperFilename(record);
  const part = value => cleanText(value).normalize("NFC")
    .replace(new RegExp(unsafe, "gu"), "_").trim().replace(/^[._]+|[._]+$/g, "")
    .replace(/\s+/gu, space);
  const values = {
    year: /^[12]\d{3}$/.test(record.year) ? String(record.year) : "",
    author: part(record.family),
    title: part(record.title),
    journal: part(record.journal),
    doi: normalizeDoi(record.doi)?.replace(new RegExp(unsafe, "gu"), "_"),
    pmid: normalizePmid(record.pmid),
  };
  const used = new Set([...template.matchAll(fields)].map(match => match[1]));
  if ([...used].some(field => !values[field])) return null;
  const render = () => template.replace(fields, (_, field) => values[field]).replace(/[. ]+$/u, "");
  const encoder = new TextEncoder();
  let stem = render();
  for (const field of ["title", "journal", "author"]) {
    if (!used.has(field)) continue;
    const characters = [...values[field]];
    while (encoder.encode(stem).length > 226 && characters.length > 1) {
      characters.pop();
      values[field] = characters.join("").replace(/[. _-]+$/u, "") || characters[0];
      stem = render();
    }
  }
  return stem && !reserved.test(stem) && encoder.encode(stem).length <= 226 ? `${stem}.pdf` : null;
}

async function searchEuropePmc(query, resultType, signal, fetcher) {
  const params = new URLSearchParams({query, format: "json", resultType});
  const response = await fetcher(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`, {signal, credentials: "omit"});
  return response.ok ? response.json() : null;
}

export async function lookupPmid(doi, signal, fetcher = fetch) {
  const data = await searchEuropePmc(`DOI:"${doi}" AND SRC:MED`, "lite", signal, fetcher);
  const results = data?.resultList?.result ?? [];
  if (data?.hitCount !== results.length) return null;
  const ids = new Set(results.filter(row => row.source === "MED" && normalizeDoi(row.doi) === doi)
    .map(row => normalizePmid(row.pmid ?? row.id)).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : null;
}

function crossrefRecord(message) {
  const dates = [message["published-online"], message.published, message["published-print"]];
  const year = dates.map(date => date?.["date-parts"]?.[0]?.[0]).find(value => /^[12]\d{3}$/.test(value));
  return {year, family: message.author?.[0]?.family, title: message.title?.[0], doi: normalizeDoi(message.DOI),
    journal: message.type === "journal-article" ? message["container-title"]?.[0] : null};
}

export async function lookup(identifier, signal, fetcher = fetch) {
  const {type, id} = identifier;
  if (type === "doi") {
    const response = await fetcher(`https://api.crossref.org/works/${encodeURIComponent(id)}`, {signal, credentials: "omit"});
    if (!response.ok) return null;
    const {message} = await response.json();
    if (normalizeDoi(message?.DOI) !== id) return null;
    const article = ["journal-article", "proceedings-article"].includes(message.type)
      || (message.type === "posted-content" && message.subtype === "preprint");
    if (!article) return null;
    return crossrefRecord(message);
  }
  if (type === "bioinformatics") {
    const {volume, issue, page} = identifier;
    const params = new URLSearchParams({
      "query.bibliographic": `Bioinformatics ${volume} ${issue} ${page}`,
      filter: "issn:1367-4811,type:journal-article",
      rows: "10",
    });
    const response = await fetcher(`https://api.crossref.org/works?${params}`, {signal, credentials: "omit"});
    if (!response.ok) return null;
    const {message} = await response.json();
    const matches = message?.items?.filter(work => work.type === "journal-article"
      && normalizeDoi(work.DOI)?.startsWith("10.1093/bioinformatics/")
      && work.volume === volume && work.issue === issue
      && work.page?.match(/^[a-z]?\d+/i)?.[0].toLowerCase() === page);
    return matches?.length === 1 ? crossrefRecord(matches[0]) : null;
  }

  const data = await searchEuropePmc(`PMCID:${id}`, "core", signal, fetcher);
  const results = data?.resultList?.result?.filter(record => record.pmcid === id);
  if (results?.length !== 1) return null;
  const [record] = results;
  return {
    year: record.firstPublicationDate?.slice(0, 4) || record.pubYear,
    family: record.authorList?.author?.[0]?.lastName,
    title: record.title,
    doi: normalizeDoi(record.doi),
    journal: record.journalInfo?.journal?.title,
    pmid: normalizePmid(record.pmid ?? (record.source === "MED" ? record.id : null)),
  };
}
