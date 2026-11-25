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
    const dates = [message["published-online"], message.published, message["published-print"]];
    const year = dates.map(date => date?.["date-parts"]?.[0]?.[0]).find(value => /^[12]\d{3}$/.test(value));
    return {year, family: message.author?.[0]?.family, title: message.title?.[0], doi: id};
  }

  const query = new URLSearchParams({query: `PMCID:${id}`, format: "json", resultType: "core"});
  const response = await fetcher(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${query}`, {signal, credentials: "omit"});
  if (!response.ok) return null;
  const data = await response.json();
  const results = data.resultList?.result?.filter(record => record.pmcid === id);
  if (results?.length !== 1) return null;
  const [record] = results;
  return {
    year: record.firstPublicationDate?.slice(0, 4) || record.pubYear,
    family: record.authorList?.author?.[0]?.lastName,
    title: record.title,
    doi: normalizeDoi(record.doi),
  };
}
