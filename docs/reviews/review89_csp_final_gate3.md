# Gate 3 最終包括品質・セキュリティ監査記録（R-25 意図しない外部通信の遮断）

**実施日**: 2026年11月21日<br>
**レビュワー**: 独立サブエージェント（Gate 3 最終監査レビュワー、読取専用。各回とも別個体）<br>
**対象**: `index.html`（CSP の meta の内容と位置、referrer・x-dns-prefetch-control の meta、`<body>` の `spellcheck`・`writingsuggestions`）、R-25・E-14・I-14・追跡表第18節（文書版 1.10）、`tests/system/csp-external-block.test.js`・`tests/system/headless-csp-external.test.js`・`tests/system/helpers/headless-runner.js`・`tests/system/headless-save-invariant.test.js`、`docs/development_process.md` v1.7.0、レビュー記録 review87〜90<br>
**基準**: [Gate 1 記録 review87](review87_csp_design_gate1.md)、[Gate 2 記録 review88](review88_csp_tests_gate2.md)、[検証記録 review90](review90_csp_verification.md)

## 1回目 — 要是正（Stage 4 へ。文書の指摘は並行して反映）

- tests/system/csp-external-block.test.js:254: 潜在の試験の不安定（再現済み）: 配信するファイルの範囲を作業ツリーの `fs.readdirSync` で判定しており、手元だけのファイル（`.claude/`・`.vscode/`・`.DS_Store`・エディタの一時ファイル）があると、コードが同じでも失敗する。
- docs/development_process.md:222: 文書: v1.6.0 の 4. の最後の箇条（仕様の書き方）が、挿入した 5. の下に移っている。
- docs/development_process.md:219: 文書: 5. に、Gate 3 の「将来:」の指摘を反映した後の扱い（Stage 7・8 の再実行、PR 本文への列挙と PR レビュー）がない。
- docs/reviews/review88_csp_tests_gate2.md:10: 文書: 実装前の確認の失敗の件数（3件）が今の試験（4件）と合わない。
- docs/internal_design.md:683: 文書: js/handoff.js の `href` の内訳が不正確（現在の URL の読出しは1か所）。
- docs/internal_design.md:659: 文書: 「配信しないもの」を保証する配信の設定がリポジトリになく、直下をそのまま公開する方式では docs/ などが CSP のない HTML として公開されうる。配信側の前提として残余に書くべき。

### 是正

- テスト: Git の作業ツリーでは、追跡対象と無視されていない未追跡のファイル（`git ls-files --cached --others --exclude-standard`）から範囲を判定し、Git のない写しではディレクトリを読む形にした。エディタ・OS・開発支援の手元の設定（`.DS_Store`・`Thumbs.db`・`.vscode`・`.idea`・`.claude`・スワップ・バックアップのファイル）は範囲の外とみなさない。作業ツリーに `.vscode/` と `js/.DS_Store` を置いて合格し、未追跡の `help.html` を置くと失敗することを確かめた。I-14-01 の規則も、追跡対象に対するものと書き直した。
- 文書（並行して反映）: 開発プロセス定義書の箇条の位置を戻し、5. に Gate 3 の後の扱いを加えた。review88 の件数に確認した時点を明記した。I-14-02 の `href` の内訳を直した。E-14-05 と review90 第4節に配信側の前提（未検証）を加えた。
- 試験を変えたため、Gate 2 の差分確認・Stage 7・8 を経て Gate 3 を再受診する。
- 注記: 上の Git による一覧の判定は、Gate 2 の差分4回目で、副作用（外側のリポジトリ・利用者の Git の設定）と環境の差が大きいことが示されたため、ディレクトリを読み、手元のもの（名前が `.`・`#` で始まるもの、`~` で終わるもの、`Thumbs.db`）を数えない形に改めた。I-14-01 も「Git に依存しない」と改めた。経緯は review88 の「Gate 3 の1回目の是正の差分確認」（差分3〜7回目）による。

## 2回目 — 通過（文書だけの指摘。並行して反映）

- docs/internal_design.md:733: 文書: I-14-03 の試料に、試験にない `js/vendor/x.js` の名前が残っている。
- docs/reviews/review90_csp_verification.md:15: 文書: 静的試験の件数は16件（15件ではない）。
- docs/reviews/review89_csp_final_gate3.md:19: 文書: 1回目の是正の記述が Git による一覧のままで、最終の方式（ディレクトリを読む）と食い違う。
- docs/external_design.md:302: 文書: E-14-05 の「次のものは対象外とする。」の下の箇条の入れ子が崩れている。
- docs/specification_traceability.md:426: 文書: 第18節の未検証の行に、配信側の前提がない。
- docs/development_process.md:168: 文書: Stage 9 の本文が、4.1 の 5. の Stage 7・8 の再実行と食い違う。
- docs/internal_design.md:659: 文書: I-14-01 の1つの箇条に多くの規則が続き、配信側の前提の文が重なっている。
- レビュワーは独立に `npm test` を実行し、総数 1081 が一致することを確かめている。挙動・退行・試験の検出力・セキュリティに関わる指摘はなかった。

### 通過とした理由と反映した内容

- 指摘はいずれも文書だけで、開発プロセス定義書 4.1 の 4. により Gate 3 は通過とした。
- 反映: I-14-03 の試料の名前、review90 の件数、本記録の1回目の是正への注記、E-14-05 の箇条の入れ子（配信側の前提を独立させた）、第18節の未検証の行への配信側の前提の追加、開発プロセス定義書の Stage 9 の本文（試験・コードを変えたときの Stage 7・8 の再実行）、I-14-01 の箇条の分割と前提の文の一本化を行った。
- これらは Gate 3 の後に直した文書のため、PR 本文のレビュー結果に列挙し、PR レビューで確かめる。
