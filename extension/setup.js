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
