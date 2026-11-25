import {customFilename, defaultNaming, namingSettings} from "./papers.js";

const sitePermission = {origins: ["https://*/*"]};
const button = document.querySelector("#enable");
const status = document.querySelector("#status");

async function refresh() {
  const granted = await chrome.permissions.contains(sitePermission);
  button.hidden = granted;
  status.textContent = granted
    ? "書誌情報を読み取れます。開いている論文ページは再読み込みしてください。"
    : "許可すると、論文ページの書誌情報からもPDFを判定できます。";
}

button.addEventListener("click", async () => {
  try {
    if (await chrome.permissions.request(sitePermission)) {
      if (!await chrome.runtime.sendMessage({kind: "setup"})) throw new Error("Registration failed");
    }
    await refresh();
  } catch {
    status.textContent = "設定を更新できませんでした。拡張機能を再読み込みしてください。";
  }
});

refresh().catch(() => { status.textContent = "設定を確認できませんでした。"; });

const form = document.querySelector("#naming");
const template = document.querySelector("#template");
const space = document.querySelector("#space");
const preview = document.querySelector("#preview");
const save = document.querySelector("#save");
const reset = document.querySelector("#reset");
const namingStatus = document.querySelector("#naming-status");
const sample = {
  year: 2021, family: "Buphamalai", journal: "Nature Communications",
  title: "Network analysis reveals rare disease signatures across multiple levels of biological organization",
  doi: "10.1038/s41467-021-26674-1", pmid: "34753928",
};
let busy = true;

function refreshPreview() {
  const naming = namingSettings(template.value, space.value);
  const filename = naming && customFilename(sample, naming);
  preview.textContent = filename || "項目を1つ以上挿入し、括弧やファイル名に使えない文字を確認してください。";
  save.disabled = busy || !filename;
  reset.disabled = busy;
  return filename ? naming : null;
}

function fillNaming(naming) {
  template.value = naming.template;
  space.value = naming.space;
}

async function saveNaming(naming) {
  if (busy || !naming) return;
  busy = true;
  refreshPreview();
  try {
    await chrome.storage.local.set({naming});
    fillNaming(naming);
    namingStatus.textContent = "保存しました。";
  } catch {
    namingStatus.textContent = "命名書式を保存できませんでした。";
  } finally {
    busy = false;
    refreshPreview();
  }
}

const fields = {
  year: "出版年", author: "筆頭著者の姓", title: "タイトル",
  journal: "掲載誌名", doi: "DOI", pmid: "PMID",
};
for (const [field, label] of Object.entries(fields)) {
  const insert = document.createElement("button");
  insert.type = "button";
  insert.textContent = label;
  insert.addEventListener("click", () => {
    const token = `{${field}}`;
    if (template.value.length + token.length - (template.selectionEnd - template.selectionStart) > template.maxLength) return;
    template.setRangeText(token, template.selectionStart, template.selectionEnd, "end");
    template.focus();
    refreshPreview();
  });
  document.querySelector("#fields").append(insert);
}

form.addEventListener("input", () => {
  namingStatus.textContent = "";
  refreshPreview();
});
form.addEventListener("submit", event => {
  event.preventDefault();
  saveNaming(refreshPreview());
});
reset.addEventListener("click", () => saveNaming(defaultNaming));

fillNaming(defaultNaming);
refreshPreview();
chrome.storage.local.get("naming").then(({naming}) => {
  fillNaming(namingSettings(naming?.template, naming?.space) ?? defaultNaming);
}).catch(() => {
  namingStatus.textContent = "命名書式を読み込めませんでした。";
}).finally(() => {
  busy = false;
  refreshPreview();
});
