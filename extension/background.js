import {identify, isSupplement, lookup, normalizeDoi, paperFilename, urlKey} from "./papers.js";

const sitePermission = {origins: ["https://*/*"]};
const script = {
  id: "article-metadata",
  matches: sitePermission.origins,
  js: ["article-page.js"],
  runAt: "document_idle",
};
const recordLifetime = 2 * 60 * 60 * 1000;
let registration = Promise.resolve();
let pendingWrite = Promise.resolve();

function syncSiteAccess() {
  registration = registration.catch(() => {}).then(async () => {
    const granted = await chrome.permissions.contains(sitePermission);
    const registered = (await chrome.scripting.getRegisteredContentScripts({ids: [script.id]})).length > 0;
    if (granted && !registered) await chrome.scripting.registerContentScripts([script]);
    if (!granted) {
      if (registered) await chrome.scripting.unregisterContentScripts({ids: [script.id]});
      await pendingWrite;
      await chrome.storage.session.remove("articles");
    }
  });
  return registration;
}

chrome.permissions.onAdded.addListener(() => { syncSiteAccess().catch(console.error); });
chrome.permissions.onRemoved.addListener(() => { syncSiteAccess().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { syncSiteAccess().catch(console.error); });
chrome.runtime.onInstalled.addListener(() => { syncSiteAccess().catch(console.error); });

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.kind === "setup" && sender.url === chrome.runtime.getURL("setup.html")) {
    syncSiteAccess().then(() => reply(true), () => reply(false));
    return true;
  }
  const page = urlKey(sender.url);
  const pdfUrl = urlKey(message?.pdfUrl);
  if (message?.kind !== "article" || sender.frameId !== 0 || !page || !pdfUrl || page === pdfUrl || isSupplement(pdfUrl)) return;
  const {title, year, family} = message;
  if (typeof title !== "string" || title.length > 4096 || pdfUrl.length > 8192 ||
      !/^[12]\d{3}$/.test(year) || (family != null && (typeof family !== "string" || family.length > 256))) return;
  const doi = normalizeDoi(message.doi);
  pendingWrite = pendingWrite.catch(() => {}).then(async () => {
    if (!await chrome.permissions.contains(sitePermission)) return;
    const {articles = []} = await chrome.storage.session.get("articles");
    const now = Date.now();
    const retained = articles.filter(article => now - article.time < recordLifetime
      && !(article.page === page && article.pdfUrl === pdfUrl));
    await chrome.storage.session.set({
      articles: [...retained.slice(-255), {page, pdfUrl, title, year, family, doi, time: now}],
    });
  });
  pendingWrite.then(() => reply(true), () => reply(false));
  return true;
});

async function determine(item, signal) {
  const urls = [item.url, item.finalUrl];
  const keys = new Set(urls.map(urlKey).filter(Boolean));
  const ids = urls.map(identify).filter(Boolean);
  const {articles = []} = await chrome.storage.session.get("articles");
  const records = articles.filter(record => keys.has(record.pdfUrl) && Date.now() - record.time < recordLifetime);
  const dois = new Set([...ids.filter(id => id.type === "doi").map(id => id.id), ...records.map(record => record.doi)].filter(Boolean));
  const pmcids = new Set(ids.filter(id => id.type === "pmcid").map(id => id.id));
  if (dois.size > 1 || pmcids.size > 1) return null;
  const names = new Set(records.map(paperFilename).filter(Boolean));
  if (names.size > 1) return null;

  const [doi] = dois;
  const [pmcid] = pmcids;
  if (pmcid) {
    const record = await lookup({type: "pmcid", id: pmcid}, signal);
    if (!record || (doi && record.doi && doi !== record.doi)) return null;
    const name = paperFilename(record);
    return names.size && !names.has(name) ? null : name;
  }
  if (ids.length || (doi && !names.size)) {
    const name = paperFilename(await lookup({type: "doi", id: doi}, signal));
    return names.size && !names.has(name) ? null : name;
  }
  return [...names][0];
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const mime = item.mime?.split(";")[0].trim().toLowerCase();
  const pdf = mime === "application/pdf"
    || ((!mime || mime === "application/octet-stream") && /\.pdf$/i.test(item.filename));
  if (!pdf || ![item.url, item.finalUrl].some(urlKey)
      || [item.url, item.finalUrl, item.filename?.split(/[\\/]/).at(-1)].some(isSupplement)) {
    suggest();
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const deadline = new Promise(resolve => controller.signal.addEventListener("abort", () => resolve(null), {once: true}));
  Promise.race([determine(item, controller.signal), deadline]).catch(() => null).then(filename => {
    clearTimeout(timeout);
    if (filename) suggest({filename, conflictAction: "uniquify"});
    else suggest();
  });
  return true;
});
