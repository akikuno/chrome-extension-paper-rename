# Chromeウェブストア掲載情報

## 配布設定

公開範囲は「限定公開（Unlisted）」を選びます。掲載言語は日本語、カテゴリは仕事効率化を選びます。

## 紹介文

論文PDFをダウンロードするときに、書誌情報を使ってファイル名を自動で整えます。初期書式は「出版年-筆頭著者の姓-論文タイトル.pdf」です。拡張機能のアイコンから、出版年、筆頭著者の姓、論文タイトル、掲載誌名、DOI、PMIDを組み合わせて書式を変更し、プレビューで確認できます。

書誌情報の照合に必要な論文識別子はCrossrefまたはEurope PMCに送信します。任意のサイトアクセスを許可すると、論文ページに掲載された引用情報も利用できます。

## プライバシーの申告

単一用途は「論文PDFのダウンロード時に書誌情報を使ってファイル名を付ける」です。ダウンロード元やPDFのURLを端末内で照合し、外部の書誌サービスに送るのは必要な論文識別子です。プライバシーポリシー欄には、このフォルダーの `privacy-policy.md` を掲載した、ログインせずに読めるHTTPS URLを入力します。

- `downloads` は対象の判定とChromeが保存するファイル名の指定に使用する。
- `storage` は命名設定の保存と、論文ページ・PDFリンクの一時的な照合に使用する。
- `scripting` と任意のHTTPSサイトへのアクセスは、利用者が許可した場合に、出版社や機関リポジトリの論文ページから引用タグとPDFリンクを読み取るために使用する。
- CrossrefとEurope PMCへのホスト権限は、識別子による書誌情報の照会に使用する。
- 実行するJavaScriptはパッケージに含まれている。外部APIは書誌データの取得に使用する。

## 審査向け確認手順

1. [Nature掲載ページ](https://www.nature.com/articles/s41467-021-26674-1)または[PMCのPDF](https://pmc.ncbi.nlm.nih.gov/articles/PMC8578255/pdf/41467_2021_Article_26674.pdf)から本文PDFをダウンロードする。
2. 初期設定で `2021-Buphamalai-Network_analysis_reveals_rare_disease_signatures_across_multiple_levels_of_biological_organization.pdf` になることを確認する。
3. 拡張機能のポップアップで `PMID-{pmid}-{author}` を設定して保存し、同じPDFをダウンロードする。PMIDを取得できる場合の期待名は `PMID-34753928-Buphamalai.pdf`。
