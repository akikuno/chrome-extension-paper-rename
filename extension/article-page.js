(() => {
  const tags = [...document.querySelectorAll("meta[name]")];
  const values = name => tags.filter(tag => tag.name.toLowerCase() === name)
    .map(tag => tag.content.trim()).filter(Boolean);
  const links = [...new Set(values("citation_pdf_url"))];
  const title = values("citation_title")[0];
  const author = values("citation_author")[0];
  const year = (values("citation_publication_date")[0] ?? values("citation_date")[0])?.match(/^([12]\d{3})\b/)?.[1];
  const doi = values("citation_doi")[0];
  if (links.length !== 1 || !title || !author || !year || (!doi && !values("citation_journal_title").length)) return;

  // A comma in a citation author field separates the family name from given names.
  let family = author.includes(",") ? author.split(",")[0].trim() : null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent);
      const nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      const article = nodes.find(node => [node?.["@type"]].flat().includes("ScholarlyArticle")
        && [node.headline, node.name].includes(title));
      const firstAuthor = [article?.author].flat()[0];
      if (firstAuthor?.familyName) {
        family = firstAuthor.familyName;
        break;
      }
    } catch {
      // Ignore malformed structured data.
    }
  }

  try {
    const pdfUrl = new URL(links[0], document.baseURI).href;
    chrome.runtime.sendMessage({kind: "article", pdfUrl, title, family, year, doi}).catch(() => {});
  } catch {
    // Ignore invalid PDF links.
  }
})();
