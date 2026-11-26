# 論文PDFの自動ファイル名変更

Chromeのダウンロード時に、論文PDFを「出版年-筆頭著者の姓-論文タイトル.pdf」で保存します。

## Chromeへの追加

1. Chromeで `chrome://extensions` を開き、「デベロッパー モード」をオンにします。
2. 「パッケージ化されていない拡張機能を読み込む」を選び、このリポジトリの `extension/` フォルダーを指定します。
3. 出版社を問わず論文ページの書誌情報を使うには、拡張機能アイコンを開き、「サイトへのアクセスを許可」を選びます。すでに開いている論文ページは再読み込みします。
4. 論文ページやPDFビューアーから、いつもどおりダウンロードします。

## ファイル名の設定

拡張機能アイコンから命名書式を編集し、プレビューを確認して「保存」を選びます。
出版年 `{year}`、筆頭著者の姓 `{author}`、論文タイトル `{title}`、掲載誌名 `{journal}`、DOI `{doi}`、PMID `{pmid}`を組み合わせられます。

既定の書式は `{year}-{author}-{title}` です。たとえば `PMID-{pmid}-{author}` は `PMID-34753928-Buphamalai.pdf` になります。拡張子は自動で付きます。項目内の空白は「_」「空白のまま」「-」から選べます。「初期値に戻す」で従来の書式に戻ります。

指定した項目が不足する場合は従来の書式を使い、従来の書式に必要な情報も不足する場合はダウンロード元の名前を使います。PMIDを指定した場合は、必要に応じてDOIをEurope PMCに送って照合します。

## 判定のしくみ

- NatureとPMCの対応URLや、DOIを含む一般的な本文PDFのURLは、論文IDから書誌情報を照会します。この方法は手順3を省略しても動作します。
- ウェブサイトへのアクセスを許可した場合は、HTTPSの論文ページで公開されている引用用の書誌タグと本文PDFリンクも使います。書誌情報の対応はブラウザーのセッション内に最長2時間保持します。
- CrossrefまたはEurope PMCへの照会には、DOIまたはPMCIDを送ります。PDF本文、閲覧ページのURL、ログイン情報を照会先へ送信する処理はありません。
- 一般のPDFや補足資料、筆頭著者の姓などを確定できないPDFは元の名前で保存します。同名の場合はChromeが連番を付けます。

## 開発時の確認

`node --test tests/downloads.test.mjs` で、Chromeのダウンロードイベントと書誌APIを模擬したテストを実行できます。実機確認には次のPDFを使います。

- [Natureの掲載ページ](https://www.nature.com/articles/s41467-021-26674-1)
- [PMCのPDF直リンク](https://pmc.ncbi.nlm.nih.gov/articles/PMC8578255/pdf/41467_2021_Article_26674.pdf)

どちらの期待ファイル名も次のとおりです。

```text
2021-Buphamalai-Network_analysis_reveals_rare_disease_signatures_across_multiple_levels_of_biological_organization.pdf
```

## Chromeウェブストアの更新

初版を開発者ダッシュボードから限定公開した後は、`extension/manifest.json`の`version`を上げて`main`に反映すると、GitHub Actionsが`extension/`を検証・梱包し、更新を審査に提出します。公開済みと同じ版を再提出することはありません。審査通過後は既存の公開範囲で自動配信されます。

### 初回の認証設定

GitHub ActionsはWorkload Identity Federationを使い、サービスアカウントの短期アクセストークンを取得します。JSON鍵の発行は不要です。

1. [Chromeウェブストアの公式手順](https://developer.chrome.com/docs/webstore/service-accounts)に沿って、Google CloudでChromeウェブストアAPIを有効にし、作成済みのサービスアカウントのメールアドレスを開発者ダッシュボードのAccount欄に登録します。
2. [Google Cloudの公式手順](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)に沿って、IAM・Security Token Service・Service Account Credentials APIを有効にし、Workload Identity Poolを作成します。そのプールにOpenID Connectプロバイダを追加します。発行元URLは `https://token.actions.githubusercontent.com`、許可するオーディエンスはデフォルトです。
3. プロバイダの属性マッピングを `google.subject=assertion.sub` と `attribute.repository_id=assertion.repository_id` に設定します。属性条件には次を入力します。

   ```text
   assertion.repository_owner_id == '15861316' && assertion.repository_id == '1471035184' && assertion.ref == 'refs/heads/main'
   ```

4. サービスアカウントの権限で、次のプリンシパルに「Workload Identity User（`roles/iam.workloadIdentityUser`）」を付与します。番号はプールを作ったGoogle Cloudプロジェクトの**プロジェクト番号**を使います。

   ```text
   principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.repository_id/1471035184
   ```

GitHubの「Settings → Secrets and variables → Actions → Variables」に次のリポジトリ変数を登録します。

| 名前 | 値 |
|---|---|
| `CWS_PUBLISHER_ID` | 開発者ダッシュボードの公開者ID |
| `CWS_SERVICE_ACCOUNT_EMAIL` | 作成済みのサービスアカウントのメールアドレス |
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | プロバイダの完全名。形式は `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID` |

限定公開した拡張機能のID `dkahfoefnfigjjgoadhfkfiglkncpjoi` はワークフローに設定済みです。

初版の公開前や別の版が審査中の場合は、先行する公開が終わってから、Actionsの「Submit Chrome extension update」で`main`を指定して手動実行できます。


gcloud iam workload-identity-pools providers list \
  --project=project-881094bd-bb6c-4f4b-ba3 \
  --location=global \
  --workload-identity-pool='github-actions' \
  --format='table(displayName,name,state)'
