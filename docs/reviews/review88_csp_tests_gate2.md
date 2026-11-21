# Gate 2 テスト観点網羅性レビュー記録（R-25 意図しない外部通信の遮断）

**実施日**: 2026年11月21日<br>
**レビュワー**: 独立サブエージェント（Gate 2 テスト網羅性レビュワー、読取専用。各回とも別個体）<br>
**対象**: `tests/system/csp-external-block.test.js`（新規、静的）、`tests/system/headless-csp-external.test.js`（新規、実Chromium）、`tests/system/helpers/headless-runner.js`（ネットワークの観測・利用者操作としての評価・実ダウンロード・Node 側の待機の追加）、`tests/system/headless-save-invariant.test.js`（UI SEC-34 の3件を同一オリジンの別ウィンドウで再現する形に変更）<br>
**基準**: [追跡表第18節](../specification_traceability.md)、[Gate 1 記録 review87](review87_csp_design_gate1.md)

## 実装前の確認（試験が先に失敗すること）

Gate 2 の1回目の前（静的試験は14件で、変異を加えた写しの試験はまだない）に、現行の index.html（従来の CSP、`<body>` の属性なし）で確かめた。静的試験は head・URL（従来の CSP の `data:`）・スペルチェックの3件が失敗し、実Chromium はスペルチェックの1件が失敗した。2回目の後の試験（15件）では、変異を加えた写しの試験も、変更しない写しの対照が従来の index.html で失敗するため、4件が失敗する。外部オリジンへの遮断は従来の CSP（`default-src 'self'`）でも成り立つため合格し、CSP の文字列の差は静的試験で固定する。UI SEC-34 の別ウィンドウの3件は従来の CSP でも合格する。

## 1回目 — 要是正（試験の安定性。将来の指摘は反映）

- headless-csp-external.test.js:164: 対照の試験が毎回約20秒かかり、上限 30000ms に対する余裕が少ない。受信されない手段の要求が接続を張らずに保留され、同じホスト・ポートへの同時接続の枠（6本）をふさぐため、`Page.getAppManifest` によるマニフェストの要求が15〜20秒待たされる（計測で確認）。
- helpers/headless-runner.js:300: ダウンロードの待ちが、`Browser.downloadWillBegin` の前に抜ける（番兵の待ちを外すと `downloads` が空のまま抜けることを確認）。負荷が高いと不安定に失敗しうる。
- csp-external-block.test.js:353: 将来: `open` の固定が件数だけで、行の内容になっていない（共有の移動先の書換え・別ファイルへの移動が通過）。
- csp-external-block.test.js:314: 将来: 許可した移動先へ渡す値を作る行（`newUrl`・`lineUrl`・`mailUrl`・`downloadTextFile` の `url`）が固定されていない。
- csp-external-block.test.js:294: 将来: `fetch` の照合が `\bfetch\(` だけで、空白を挟む形・別名での呼出しを見逃す。
- csp-external-block.test.js:21: 将来: 字句解析が後置の `++`・`--` の後の `/` を正規表現とみなし、後のコードを隠す。自己確認の検査が空である。
- csp-external-block.test.js:460: 将来: WebAuthn の3つ目の塊が完全一致で比べられていない。
- csp-external-block.test.js:261: 将来: meta refresh の照合が二重引用符の形だけ。

### 是正

- 試験用の外部サーバーを2つにし、受信で確かめる6つの手段を別のポートへ送るようにした（I-14-03 に理由を追記）。対照の試験は約0.35秒になった（作業コピーで2回）。
- runner のダウンロードの待ちを、期待する件数（`expectDownloads`）の開始と完了まで待つ形にした。
- 将来の指摘（開発プロセス定義書 4.1 の 5.）は反映した: `open`・`newUrl`・`lineUrl`・`mailUrl`・`fetch` の出現を行の内容で、`downloadTextFile`・`buildExternalBrowserUrl` の本体を全行で固定した。`fetch` の照合を `\bfetch\s*\(` にした。字句解析は `++`・`--` を1つの字句とし、正規表現リテラルを同じ長さの `0` と空白に置き換え、取り除いた後のコードが構文として正しいこと（`vm.Script`）を確かめるようにした（`n++ / 2` の試料を追加）。WebAuthn の3つ目の塊を完全一致にした。`http-equiv` の照合を引用符・大文字小文字によらない形にし、試料を加えた。I-14-02・I-14-03・第18節に反映した。
- 試験の安定性の指摘を是正したため、Gate 2 を再受診する。

## 2回目 — 通過（将来のコードの潜在の経路だけの指摘。反映して通過）

- csp-external-block.test.js:544: 将来: WebAuthn の固定が `publicKey: {` の塊と数だけで、選択肢を変数で組み立てて `navigator.credentials.create({ publicKey: options })` と渡す形を見逃す。
- csp-external-block.test.js:136: 将来: プロトコル相対の照合の区切りに `,` がなく、`srcset` の2つ目以降の候補を見逃す。
- csp-external-block.test.js:140: 将来: 禁止する API にブラウザ内蔵の AI の API（`Translator`・`LanguageDetector`・`Summarizer`・`LanguageModel`・`Writer`・`Rewriter`・`Proofreader`）がない。
- csp-external-block.test.js:179: 将来: I-14-03 の違反の試料のうち12件が試験に試料として入っておらず、固定を緩めても気づけない（現行の固定で検出されることはレビュワーが確認）。

### 通過とした理由と反映した内容

- 指摘はいずれも「将来:」で、現行のコードの欠陥・退行・試験の検出力の欠落はない。開発プロセス定義書 4.1 の 5. により Gate 2 は通過とした。1回目の試験の安定性の指摘（対照の試験の時間、ダウンロードの待ち）の是正は、この回で解消を確かめられた。
- 反映: `credentials`・`publicKey` の出現を行の内容で固定した。プロトコル相対の照合の区切りに `,` を加え、`srcset` の試料を加えた。AI の API を禁止する名前に加え、E-14-05 の一覧にも加えた。ファイルの中に置く形の試料（12件と、指摘の WebAuthn・AI の API・`srcset` の形）を、配信するファイルの写しに加えて静的試験を子プロセスで実行し、失敗することを確かめる試験にした（変更しない写しの合格を対照とする。作業コピーで全件を確認）。I-14-02・I-14-03・第18節に反映した。反映した内容は Gate 3 の審査対象に含める。

## Gate 3 の1回目の是正の差分確認

Gate 3 の1回目（review89）で、配信するファイルの範囲の検査が手元だけのファイルで失敗しうることを指摘された。`servedListing` を加え、Git の作業ツリーでは追跡対象と無視されていない未追跡のファイルから範囲を判定し、手元の設定を範囲の外とみなさない形にした。

### 差分3回目 — 要是正（Git の一覧の作り方）

- csp-external-block.test.js:129: `git ls-files` を `-z` なしで呼んでおり、日本語などの名前が引用符付き・エスケープ済みで出力されて捨てられ、範囲の外の `ヘルプ.html` などを見逃す（複製で確認）。
- csp-external-block.test.js:121: 手元の設定の除外を追跡対象にも当てており、コミットした `.vscode/help.html`・`player.swf`（`\.sw[a-p]$` に一致）などを見逃す。
- csp-external-block.test.js:111: 走査の一覧が readdir のままで範囲の判定と食い違い、Emacs の一時ファイル（`#app.js#`・宛先のないシンボリックリンクの `.#app.js`）や無視設定の `js/local.js` で失敗する。
- csp-external-block.test.js:131: git の失敗（未追跡の node_modules/ による出力の上限超過、所有者の不一致）で理由を示さずに readdir へ切り替え、手元のファイルで再び失敗する。
- csp-external-block.test.js:277: Git の経路を自動の試験で確かめていない。

### 是正

- `servedPaths` を、`git ls-files -z` で追跡対象（削除したものを除く）と、無視されていない未追跡のもの（`--directory --no-empty-directory`、出力の上限 64MiB）を別々に取得する形にした。手元の設定・一時ファイルの除外は未追跡のものだけに当て、名前に Emacs の一時ファイルを加え、vim のスワップはドットで始まるものに狭めた。git がない環境（ENOENT）と Git のない写しだけディレクトリを読み、それ以外の git の失敗では試験を失敗させる。
- 走査するファイルの一覧（jsFiles など）を、範囲の判定と同じ一覧から作るようにした。
- 一時ディレクトリに Git のリポジトリを作り、未追跡の手元の設定・一時ファイル・無視したファイルが報告・走査されないこと、未追跡の `help.html`・`ヘルプ.html`・`js/vendor/a.js` が報告されること、コミットした `.vscode/` が報告されることを確かめる試験を加えた（git がない環境では skip）。I-14-01 を合わせて直した。

### 差分4回目 — 要是正（Git に依存する一覧の副作用）

- csp-external-block.test.js:319: 一時の写しを `fs.cpSync` でディレクトリごと作っており、手元の未追跡・無視したファイルまで写る。Git の経路の試験の対照と、変異の試料の試験の対照が失敗する（複製で確認）。
- csp-external-block.test.js:313: 試験用リポジトリと `servedPaths` の git が親の `GIT_DIR`・`GIT_INDEX_FILE` を引き継ぎ、外側のリポジトリにコミットしうる（複製で確認）。
- csp-external-block.test.js:345: 試験用リポジトリの git が利用者の全体設定（無視の設定・フック）を読み、`git add`・`git commit` が失敗しうる。
- csp-external-block.test.js:129: `--directory` が未追跡のディレクトリを1件にまとめるため、手元のファイルだけを含むディレクトリ（`icons/old/.DS_Store`）が範囲の外と報告される。
- csp-external-block.test.js:308: 作業ツリーで削除した追跡対象と、空の未追跡のディレクトリの場面が試験にない。
- csp-external-block.test.js:331: `fs.symlinkSync` が、シンボリックリンクを作れない環境で失敗する。
- 将来: csp-external-block.test.js:337: 「Untracked local files are not scanned」が js の名前の形を前提にしている。
- 文書: internal_design.md:659: I-14-01 に、削除した追跡対象の除外と未追跡のディレクトリのまとめ方が書かれていない。

### 是正

- Git に依存する一覧は、範囲の判定に比べて副作用（外側のリポジトリ・利用者の設定）と環境の差が大きいため、ディレクトリを読む形に改めた。名前が `.` か `#` で始まるもの、`~` で終わるもの、`Thumbs.db` を手元のものとし、それだけを含む（または空の）ディレクトリとともに範囲に数えず走査もしない。配信側がこれらを公開しないことを前提として、I-14-01 と E-14-05 に書いた（Jekyll は `.`・`#` で始まるもの、`~` で終わるものを既定で外すが、`Thumbs.db` は外さないため配信側の除外の設定に含める）。
- 試験の写し（範囲の試験と変異の試料の試験）は、配信するファイルの一覧にあるものだけを写す `copyServedFiles` に改めた。
- 範囲の試験を、写しに手元のファイル（`.vscode/`・`.claude/`・`.DS_Store`・`Thumbs.db`・`js/#app.js#`・`js/.#app.js`・`js/.app.js.swp`・`js/app.js~`・`icons/old/.DS_Store`）と空の `css/new/` を置いても報告・走査されないこと、新しい `help.html`・`ヘルプ.html`・`js/vendor/`・`icons/old/legacy.html` は報告されることを確かめる形にした。走査の一覧は、対照の一覧と一致することで確かめる（名前の形を前提にしない）。シンボリックリンクは使わない。
- 作業ツリーに手元のファイルを置いて静的試験が全件合格することを確かめ、置いたファイルは消した。

### 差分5回目 — 要是正（入れ子のディレクトリの試料）

- csp-external-block.test.js:309: 入れ子のディレクトリの試料がなく、`onlyLocalInside` の再帰の分岐を壊す変異（ディレクトリを手元のものとみなす、再帰を削る）が全件合格する（作業コピーで確認）。前者では範囲の外の `vendor/lib/help.html` などを見逃す。
- 将来: csp-external-block.test.js:313: 走査の一覧が範囲の判定と同じ一覧から作られることを確かめていない（`listFiles` を readdir の直読みに戻す変異が合格する）。
- 文書: internal_design.md:659: 「Jekyll なども既定で公開から外す」は `Thumbs.db`・`.htaccess` について正しくない。
- 文書: specification_traceability.md:418: 第18節の配信の範囲の行に、手元のものの扱い・一覧の作り方・試料が書かれていない。

### 是正

- 手元の試料に入れ子の `icons/a/b/.DS_Store`（報告されない）を、新しいものの試料に入れ子の `vendor/lib/help.html`（`vendor` を報告）と `css/theme/dark/x.css`（`css/theme` を報告）を加えた。
- 将来の指摘は反映した: `runStaticChecksOn` に追加のファイルを渡せるようにし、違反の字句を含む手元のファイル（`js/.x.js`・`js/app.js~`・`.vscode/help.html`）を置いた写しでも静的試験が合格することを確かめる対照を加えた。
- 文書: I-14-01・review88・試験のコメントの Jekyll の記述を正確にし（`Thumbs.db` は配信側の除外の設定に含める）、第18節の行に手元のものの扱い・一覧の作り方・試料を加えた。

### 差分6回目 — 要是正（境界の試料）

- csp-external-block.test.js:158: `outsideServedScope` の `!entry.file` と `servedListing` の `file: entry.isFile()` について結果が変わる試料がなく、前者を削る変異・後者を常に真にする変異が全件合格する。名前が配信する拡張子で終わるディレクトリ（`icons/set.png/help.html`・`js/lib.js/a.js`）を見逃す。
- csp-external-block.test.js:117: `LOCAL_ENTRY` の境界（アンカーと文字の集合）を確かめる試料がなく、`~`・`#` を名前のどこでも手元とみなす変異、`_` で始まるものも手元とみなす変異が全件合格する。

### 是正

- 新しいものの試料に `icons/set.png/help.html`・`js/lib.js/a.js`（`icons/set.png`・`js/lib.js` を報告）と、境界の名前 `help~old.html`・`a#b.html`・`_help.html`（報告）・`js/_x.js`（走査される）を加えた。合成の試料の名前を `vendor.js` にした。第18節を合わせて直した。
- 作業コピーで、指摘の5つの変異がいずれも範囲の試験で失敗することを確かめた。

### 差分7回目 — 通過（将来・文書の指摘だけ。反映して通過）

- 将来: csp-external-block.test.js:158: 拡張子の検査だけで結果が変わる試料がなく、拡張子の検査を削る・`endsWith` を `includes` にする・拡張子をまとめる変異が合格する（今の実装は正しく報告することをレビュワーが確認）。
- 文書: specification_traceability.md:418: 第18節に、試験にない `js/vendor/x.js` の名前が残っている。
- レビュワーは、差分6回目の指摘の解消（5つの変異がすべて失敗）、ほかの13の変異の結果、範囲の試験がカバレッジ付きで3回続けて合格し一時ディレクトリが片付くことを確かめている。

### 通過とした理由と反映した内容

- 指摘は「将来:」と「文書:」だけで、今の実装・試験の誤りはない。開発プロセス定義書 4.1 の 4.・5. により Gate 2 は通過とした。
- 反映: 新しいものの試料に、配信するディレクトリの直下の拡張子の違う通常のファイル（`js/app.js.map`・`js/help.html`・`css/font.woff2`・`icons/photo.jpg`・`icons/x.js`）を加えた。第18節の試料の名前を直し、これらを加えた。反映した内容は Gate 3 の審査対象に含める。
