# Gate 3 最終包括品質・セキュリティ監査記録（開発プロセス v1.8.0 と監査前の機械的チェック）

**実施日**: 2026年11月23日<br>
**レビュワー**: 独立サブエージェント（Gate 3 最終監査レビュワー、読取専用。各回とも別個体）<br>
**対象**: `tests/scripts/`（check-docs.js・impact.js・repeat-tests.js・mutate.js・precheck.js・verify-twice.js・finding-scope.js・lib/js-lexer.js・lib/git.js・stress/）、`tests/unit/dev-scripts-*.test.js`・`tests/helpers/dev-scripts.js`、`tests/system/csp-external-block.test.js`、`docs/development_process.md` v1.8.0、PR テンプレート、`docs/specification_traceability.md` のアンカー、`docs/review_backlog.md`、Gate 2 の3回目の是正（利用者の決定でこのゲートで確かめる）<br>
**基準**: [Gate 1 記録 review91](review91_process_tools_gate1.md)、[Gate 2 記録 review92](review92_process_tools_gate2.md)、[検証記録 review94](review94_process_tools_verification.md)<br>
**比較元**: ee512ac

## 1回目 — 要是正（Stage 6 へ。セキュリティの指摘を含む）

指摘は17件（ゲートを止める指摘12件、将来の潜在の経路だけの指摘4件、文書だけの指摘1件）。ゲートを止める指摘のうち3件（mutate.js:220、verify-twice.js:141、check-docs.js:297）は、スクリプトが写し・一時ディレクトリの外のファイルを書き換える、またはシェルでコマンドを実行する経路で、セキュリティの問題として扱う（4.1 の 6. の例外。通過としない）。

ゲートを止める指摘:

- lib/git.js:21: DIFF_FORMAT が、利用者の `diff.renames`・`diff.algorithm`・`diff.indentHeuristic` を固定していない。`diff.renames = false` で、改名したファイルの変えていない行の行頭の空白を precheck が報告し、finding-scope の範囲が広がる。`diff.algorithm = histogram` で、`mutate.changedRanges` の範囲がずれる。
- mutate.js:220: 一覧の項目の `file`（`--auto` も同じ）を写しの中に限らず書き込むので、`..` を含む `file` で写しの外（作業ツリーを含む）のファイルを書き換える。実行中に SIGINT を送ると、書き換えたまま残る。
- mutate.js:221: 一覧の項目の必須の `file`・`tests` を検査せず、存在しないファイルを指す項目や `tests` のない項目で、それまでの表も出さずに未処理の例外（終了コード 1）で止まる。
- mutate.js:79・precheck.js:172: git がないと、`--since` と `--verified` が未処理の例外で終了コード 1 になる（4.6 は 2 とする）。
- mutate.js:307: 読めない・JSON でない `--spec`・`--equivalents`、存在しない `--auto` のファイル・`--since` の下書き、値のない `--tests`・`--root` が、未処理の例外で終了コード 1 になる。
- verify-twice.js:148: 値のない `--out`・`--root`・`--report-only` が例外で終了コード 1 になる。値のない `--root` は check-docs.js・precheck.js・finding-scope.js・impact.js・repeat-tests.js でも同じ。存在しない `--verified` と、存在しない指摘のファイル（finding-scope.js）も 1 になる。
- repeat-tests.js:28: 知らない引数を試験ファイルとして扱い、`--max-tests-ms 10` のような綴りの誤りが引数の誤り（2）にならない。
- mutate.js:49: `occurrence` の件数は重ならない一致で数えるのに、位置は重なる一致で探すので、自分自身と重なる `find` で別の位置に変異を入れる。
- finding-scope.js:32: 拡張子のないファイル名（`review92:14:`）、行番号の後の全角の括弧でない注記（`dev-scripts.test.js:46 ほか:`）、ASCII 以外の文字を含むパスの指摘を黙って飛ばし、表に出さず終了コードも 0 のままになる。
- verify-twice.js:141: JUnit の出力先のパスを二重引用符で囲んでシェルのコマンドに入れるので、パスの中の `$(…)`・逆引用符・`$名前` が展開・実行される。
- check-docs.js:297: 比較元の木の項目のパスをそのまま書き出すので、`..` という名前の木を含むコミットを比較元にすると、一時ディレクトリの外にファイルを書く。
- development_process.md:264: Gate 3 の指摘で試験・コードを変えたときの再実行（Stage 7・8）に、変異の当て直しが入っていない（Stage 9 の記述とも揃っていない）。

将来の潜在の経路だけの指摘（4.1 の 5.）: check-docs.js:151（試験名の照合の範囲が、次の試験の宣言を含む）、check-docs.js:206（語彙から除くディレクトリを名前 `scripts` で指定し、`tests/` の下のどの `scripts` も除く）、precheck.js:42（未追跡のファイルの行頭の空白の検査が、タブの前の空白で始まる行を通す）、dev-scripts-repeat-tests.test.js:97（宣言の引数でない `timeout` を許す条件が「前の10行に runMutants・runTests がある」で、直後の変数の options を通す）。

文書だけの指摘（4.1 の 4.）: development_process.md:366（プレースホルダーの形の記述が実装と合わない）。

### 是正（まとめて直した。4.1 の 8.）

ゲートを止める指摘:

- 差分の取り方（lib/git.js）: DIFF_FORMAT に `--find-renames`・`--diff-algorithm=myers`・`--indent-heuristic` を加え、改名の検出・アルゴリズム・字下げの手がかりを git の既定の値に固定した。ファイルの順（`diff.orderFile`）は出力の順だけで結果を変えないので固定しない。git の試験に、改名したファイル（比較元から行頭が空白の行がある）、アルゴリズムで範囲が変わる組、字下げの手がかりで範囲が変わる組と、利用者の `diff.renames = false`・`diff.algorithm = histogram`・`diff.indentHeuristic = false` を加えた。
- 写しの外のファイル（mutate.js、セキュリティ）: 一覧の項目と `--auto` の `file`・`tests`（`--tests`）をリポジトリの中のパス（`..` で外に出ない・絶対パスでない）に限り、実在しないファイルとともに、変異を当てる前に引数の誤り（2）とした。写しの外のファイルが書き換わらないことを試験で確かめる。
- 一覧の項目の検査（mutate.js）: `name`・`file`・`find` と `replace`（または `mutated`）・`tests` を検査し、誤りは「一覧の N 件目」として 2 にする。
- 引数・環境の誤り（mutate.js・precheck.js・verify-twice.js ほか）: mutate.js は、読めない・JSON でない一覧と等価の一覧、ない対象のファイルと下書き、git がない（`--since`）を 2 にする。precheck.js は、ない検証記録と、git がないときの `--verified` を 2 にする。6つのスクリプトの parseArgs は、値を取る引数に値がなければ 2 にする。repeat-tests.js・finding-scope.js・impact.js は、`--` で始まる知らない引数を 2 にする。finding-scope.js は、ない指摘のファイルを 2 にする。
- `occurrence`（mutate.js）: 位置も、件数と同じ重ならない一致で探すようにした。
- 指摘の解析（finding-scope.js）: 参照のファイル名を、空白・`:`・区切り・括弧のほかの文字に広げ（拡張子のない名前、ASCII 以外の文字を含むパス）、行番号の後の括弧のない注記も許した。行頭の箇条で解析できないものは「解決できない（指摘の形式を解析できない）」として表に出し、終了コード 1 にする（字下げした箇条は前の指摘の続きとして飛ばす）。
- シェルへのパス（verify-twice.js、セキュリティ）: JUnit の出力先のパスを、POSIX のシェルでは単引用符で囲み、中の `'` を逃がして渡す（Windows の cmd.exe は二重引用符）。`$(…)`・逆引用符・`$名前`・単引用符を含むパスが展開されずに1つの引数になること、記録の置き場所の名前に `$(…)` を含めても JUnit の出力がその名前のディレクトリに書かれることを試験で確かめる。
- 比較元の木（check-docs.js、セキュリティ）: 木の項目のパスに `..` があり、書き出す先が一時ディレクトリの外になる比較元は使えない（2）とした。`git mktree` で `..` の木を含むコミットを作り、外に書かれないことを試験で確かめる。
- 再実行の記述（development_process.md）: Gate 3 の指摘を反映したときの Stage 7・8 の再実行に、変異の当て直し（変えた行への `--auto --since` と一覧の変異。単位ごと）を含めると書き、Stage 9 の記述も揃えた。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: check-docs.js の試験名の照合の範囲を、次の試験の宣言の行の手前で切った。語彙から除くのを `tests/scripts/` だけにした。precheck.js は、空白で始まる行（タブの前の空白を含む。JSDoc の ` *` と空白だけの行を除く）を行頭の空白として報告する。上限の表の漏れの検査は、宣言の引数でない `timeout` を、`runMutants`・`runTests` の呼出しの括弧の中にあるものだけ許す。

文書だけの指摘は直した（4.1 の 4.）: 4.6 のプレースホルダーの形を、実装のとおりに書いた。あわせて、記録の途中で使った `GATE3_R1_FIX` のような、回の後ろに `_<語>` の付いた形を check-docs.js が数えていなかったので、数えるようにした（試験を加えた）。

4.6 の表・段落と各スクリプトの冒頭の注記に、上の動作（引数の誤りの範囲、一覧の項目の検査、指摘の解析、比較元の木、差分の取り方）を書いた。是正の規則ごとの一覧の変異（31件）を単位の一覧の変異に加え（9本で計161件）、変わった単位を Stage 7 の当て直しとしてやり直す。

### セキュリティの指摘（4.5 の 6.）

3件とも今回の変更で入れたスクリプトの欠陥で、比較元にはない（変更外ではない）。Gate 3 の1回目で実証された問題として、この回の是正で直した。SEC-37・SEC-39 は、2回目で是正の不足（ほかの経路）を指摘され、2回目の是正で直した。SEC-37 は3回目でも是正の不足を指摘され、3回目の是正で直した。4回目の将来の潜在の経路だけの指摘（Windows の短い名前）も、4回目の是正でチェックに加えた（表は4回目の是正の後の内容）。

| ID | 重大度・成立条件・影響 | 再現手順（是正の前） | 根拠の試験 |
| --- | --- | --- | --- |
| SEC-37 | 中。`mutate.js` に渡す一覧の項目（または `--auto`）の `file`・`tests` が `..` を含むか絶対パスのとき、変異の本文を写しの外のファイル（作業ツリーを含む）に書き込む。実行中に止めると、書き換えたまま残る。2回目: `tests` の `-` で始まる項目（`--require=<外>/evil.js`・`--test-reporter-destination=<外>/x`）は node の引数になり、写しの外のコードを実行し、写しの外に書き込む。将来の経路として、リンク・`node_modules` を通るパス（写しでは作業ツリーを指す）も作業ツリーに書き込む。3回目: root の中を指す絶対パスの `tests`（`<root>/tests/t.test.js`）は `..` の検査を通り、写しではなく作業ツリーの試験ファイルを実行する（試験が自分のディレクトリに書けば、作業ツリーに書く）。`.git`・入れ子の `node_modules` の下の `file` は写しにないので、未処理の例外で止まる。将来の経路として、大文字小文字の違う `Node_Modules`（大文字小文字を区別しないファイルシステム）と、glob の記号を含む `tests`（`{..,w}/t.test.js` は写しの外の `../t.test.js` に展開される）も写しの外に届く。4回目: 将来の経路として、Windows の 8.3 形式の短い名前（`NODE_M~1/pkg/index.js`）は `UNCOPIED` にも実パスの比較（JS の `fs.realpathSync` は長い名前に直さない）にもかからず、写しのリンクの `node_modules` を通って作業ツリーに書き込む（実パスを `fs.realpathSync.native` で長い名前に直して比べる）。誤った一覧で、利用者のファイルを書き換え、写しの外のコードを実行しうる。残余: 一覧の `replace`・`mutated` は写しの中で試験として実行されるコードなので、一覧と等価の一覧は、コードと同じく信頼できるものだけを使う。`file`・`tests` の制限は誤りを防ぐもので、悪意のある一覧は防がない（4.6 の mutate.js の行と、mutate.js の冒頭の注記に書いた）。 | 写しの外に `victim.js` を置き、`file` を `../victim.js` にした一覧の項目で `mutate.js --spec` を実行すると、`victim.js` に変異が入る。2回目: `tests` を `["--require=<外>/evil.js", "tests/t.test.js"]` にした項目で実行すると、終了コード 0 のまま evil.js が実行される。3回目: `tests` を `["<root>/tests/t.test.js"]` にした項目で実行すると、基準の実行でも変異の実行でも作業ツリーの試験ファイルが実行され、変異は生存になる。 | `mutate: restoring across files, argument checks, line ranges without candidates and the timeout reaching the run`（写しの外のファイルが変わらず、写しの外のコードが実行されず、リンクの先のファイルも変わらず、絶対パスで与えた試験が作業ツリーで実行されず、終了コード 2）。一覧の変異「mutate: a file outside the repository accepted」「mutate: a test outside the repository accepted」「mutate: tests starting with - accepted」「mutate: a missing test accepted」「mutate: node_modules accepted」「mutate: links accepted」「mutate: only the first part checked for uncopied names」「mutate: .git accepted」「mutate: uncopied names compared with case」「mutate: glob characters in tests accepted」「mutate: a backslash accepted outside Windows」を検出。一覧の変異「mutate: short names compared without the long names」は、短い名前を作れないこの環境（Linux）では等価（review94）。一覧の変異「mutate: absolute paths accepted」は、4回目の是正の正規の形の比較が絶対パスも拒むので等価（行は、絶対パスを拒むことをはっきりさせるために残す。review94）。 |
| SEC-38 | 中。`check-docs.js --base` に、`..` という名前の木を含むコミット（`git mktree` で作れる。`git checkout` は拒むが `ls-tree`・`cat-file` は拒まない）を渡すと、その中のファイルを一時ディレクトリの外の任意の場所に、任意の内容で書き出す。他人の作ったコミットを比較元にすると、利用者のファイルを書き換えうる。 | `git mktree` で `docs/../../escaped` を含むコミットを作り、`check-docs.js --base <そのコミット>` を実行すると、一時ディレクトリの外に `escaped` が書かれる。 | `check-docs: first-line positions, partial headers, the supplement boundary, the printed report and failure paths`（外に書かれず、比較元を使えないとして null）。2回目の是正で、木とコミットを、親の `GIT_` の環境変数と利用者の設定によらず試験のリポジトリに作り、そこにあることを確かめてから渡すようにした。一覧の変異「check-docs: a base tree with .. written」を検出。 |
| SEC-39 | 低。`verify-twice.js --out` の記録の置き場所のパスに `$(…)`・逆引用符・`$名前` があると、JUnit の出力先を二重引用符で囲んでシェルに渡すので、それが展開・実行される。2回目: 1回目の是正（POSIX は単引用符、Windows は二重引用符）でも、Windows の cmd.exe は二重引用符の中の `%名前%` を展開する。パスは利用者が自分で与えるので、成立には利用者がそのようなパスを使う必要がある。是正: パスをコマンドの文字に入れず、環境変数 `KOGAI_VERIFY_JUNIT` で渡す（シェル・cmd.exe は変数の値を展開し直さない）。 | `--out` に `$(echo out)` を含む名前を与えると、シェルが `echo out` を実行し、JUnit の出力先が記録の置き場所とは別のパスに変わる。 | `verify-twice: counts, nested coverage, JUnit files, thresholds, digests and file changes produce the report and its problems`（`$(…)`・逆引用符・`$HOME`・単引用符を含むパスが1つの引数のまま渡る）、`verify-twice: a run in a temporary repository refuses --out inside the tree, writes the record, keeps the parent coverage out and reports problems`（`$(echo out)` を含む置き場所に記録が書かれる）。一覧の変異「verify-twice: the JUnit variable unquoted for the shell」「verify-twice: the JUnit variable unquoted for cmd.exe」「verify-twice: the JUnit variable not set」を検出。 |

## 2回目 — 要是正（Stage 6 へ。セキュリティの指摘を含む。要是正の2回目）

1回目の是正と、それが持ち込んだ問題を重点として審査した（4.1 の 7.）。指摘は13件（ゲートを止める指摘9件、将来の潜在の経路だけの指摘4件）。ゲートを止める指摘のうち3件（mutate.js:316、review93:58、verify-twice.js:143）は、SEC-37・SEC-39 の是正が足りない、または残余を書いていないもので、セキュリティの指摘である。

ゲートを止める指摘:

- mutate.js:316: `tests` の検査（`insideRoot`）はパスの文字だけを見るので、`-` で始まる項目（`--require=<外>/evil.js`・`--test-reporter-destination=<外>/written.txt`）も「リポジトリの中」と判定する。`runTests` はそれを node の引数として渡すので、写しの外のファイルを実行し、写しの外に書き込む（終了コードは 0 のまま）。`--auto` の `--tests` も同じ。
- review93:58: SEC-37 の影響の記述は、是正で他人の一覧の経路を防いだと読める。しかし一覧の `replace`・`mutated` は写しの中で試験として実行されるコードで、是正の後も、他人の一覧は利用者の権限で任意の処理を実行できる。この残余（一覧と等価の一覧は、コードと同じく信頼できる入力に限る）を、SEC-37 の表と 4.6 の mutate.js の行に書く。
- finding-scope.js:34: 括弧のない注記の形が、後ろにある参照のファイル名を飲み込み、その参照を黙って落とす（`- a.js:10 と b.js:20: …` で b.js:20 が表に出ず、終了コード 0）。
- finding-scope.js:41: 参照を `・`・`、`・`,` で分ける処理が、参照の後の全角の括弧の注記の中でも分けるので、`- a.js:10（文書、軽微）・b.js:2: …` で TypeError になり、表を出さず終了コード 1 で止まる。
- dev-scripts-check-docs.test.js:200: SEC-38 の根拠の試験は、親の環境（`GIT_DIR` などと利用者の設定）のまま git を実行し、終了コードも確かめない。Git のフックの中のように `GIT_DIR` があると、`..` を含む木をそのリポジトリに書き込む。また `extractTree` がそのコミットを見つけられずに null を返すので、`..` の検査を外した変異でも合格する。
- lib/git.js:22: 改名の検出の上限 `diff.renameLimit` と、改行の変換 `core.autocrlf` を固定していない。`diff.renameLimit = 1` で、改名したファイルの変えていない行の行頭の空白を precheck が報告し、finding-scope の範囲が広がる。`core.autocrlf = true`・`input` で、`git diff --check` の末尾空白が消える。
- verify-twice.js:143: Windows の cmd.exe は、二重引用符の中の `%名前%` を展開するので、`--out` に `%USERNAME%` などを含むパスで JUnit の出力先が変わる（SEC-39 と同じ経路が Windows で残る）。
- precheck.js:210: `--verified` にディレクトリや読めないファイルを与えると、読込みの誤りを捕まえずに終了コード 1 になる（4.6 の共通の記述は 2）。finding-scope.js の指摘のファイルも同じ。
- repeat-tests.js:146: ない試験ファイル（「失敗 1回」として 1）、ない `--root`（1）、mutate.js のない `tests`（基準の実行の失敗として 1）、impact.js のない `--root`（「出現なし」として 0）が、終了コード 2 にならない。

将来の潜在の経路だけの指摘（4.1 の 5.）: mutate.js:302（`insideRoot` がシンボリックリンクをたどらず、写しの `node_modules` は作業ツリーへのリンクなので、`node_modules/…` やリンクを通る `file` で作業ツリーに書き込む。今のリポジトリには `node_modules` もリンクもない）、check-docs.js:30（プレースホルダーの2つ目の形が接頭辞を1つしか許さず、`SPEC_Q_GATE1_TBD` を数えない）、precheck.js:41（未追跡の新規ファイルの末尾空白・末尾の空行の検査が CR を空白として扱わない）、precheck.js:62（`+++ b/<パス>` の解析が、空白を含むパスの末尾のタブをパスに含め、引用されたパスに一致しない。finding-scope.js も同じ）。

### 是正（まとめて直した。4.1 の 8.）

ゲートを止める指摘:

- `tests` の `-` で始まる項目（mutate.js、セキュリティ。SEC-37）: 一覧の項目と `--tests` の `-` で始まる項目を引数の誤り（2）とし、各項目が root の中の、リンクと `node_modules` を通らない実在するファイルであることを確かめる（`repositoryFile`）。単位の実行で `tests` に入れていた試験の選び方（`--test-skip-pattern`）は、項目の `skipPattern` の欄（`--auto` では `--skip-pattern`）にし、mutate.js が `--test-skip-pattern=<形>` として node に渡す（基準の実行は、試験と `skipPattern` の組ごと）。写しの外のコードが実行されず、写しの外に書かれないことを試験で確かめる。
- SEC-37 の残余（review93、セキュリティ）: 一覧の `replace`・`mutated` は写しの中で試験として実行されるコードなので、一覧と等価の一覧は、コードと同じく信頼できるものだけを使う（`file`・`tests` の制限は誤りを防ぐもので、悪意のある一覧は防がない）ことを、SEC-37 の表、4.6 の mutate.js の行、mutate.js の冒頭の注記に書いた。
- 語でつないだ参照（finding-scope.js）: 括弧のない注記の後の内容が `<数字>[-<数字>]:` で始まるとき（注記が別の参照のファイル名で終わるとき）は、解析できない行として表に出す（終了コード 1）。注記がないときの `20:30 …` のような内容は、そのまま内容とする。
- 注記の中の区切り（finding-scope.js）: 参照を区切りで分けるのをやめ、`REF` を順に照合して取り出す（全角の括弧の注記の中の `、`・`,` で分けない）。
- SEC-38 の根拠の試験（dev-scripts-check-docs.test.js）: `..` の木とコミットを、試験の補助の git（親の `GIT_` の環境変数を除き、利用者の設定を読まず、終了コードを確かめる。標準入力を与える `gitInput` を加えた）で作る。`ls-tree` でそのコミットが試験のリポジトリにあり、パスが `docs/` の外へ上ることを確かめてから `extractTree` に渡す。`GIT_DIR` を別の空のリポジトリにして実行しても合格し、そのリポジトリに何も書かれないこと、`..` の検査を外した写しでは `GIT_DIR` があってもこの試験が失敗することを確かめた。
- 改名の上限と改行の変換（lib/git.js）: DIFF_FORMAT に `-l0`（改名の検出の上限なし）を、CONFIG に `core.autocrlf=false` を加えた。git の試験の試料に、2つ目の改名と CRLF に変えた追跡対象のファイル、利用者の設定 `diff.renameLimit = 1`・`core.autocrlf = true` を加え、結果が変わらないことを確かめる（どちらの固定を外した写しでも、この試験が失敗することを確かめた）。
- Windows の `%名前%`（verify-twice.js、セキュリティ。SEC-39）: JUnit の出力先のパスをコマンドの文字に入れず、環境変数 `KOGAI_VERIFY_JUNIT` で渡す（POSIX のシェルは `"$KOGAI_VERIFY_JUNIT"`、cmd.exe は `"%KOGAI_VERIFY_JUNIT%"`。どちらも変数の値の中の `$(…)`・`%名前%` を展開し直さず、Windows のパスは `"` を含められないので引用も閉じない）。`shellQuote` は除いた。npm test と同じくシェルで実行するので、試験ファイルの glob の展開は変わらない。
- 読めないファイル（precheck.js・finding-scope.js）: 検証記録と指摘のファイルの読込みの誤り（ディレクトリを含む）を捕まえて、終了コード 2 にする。
- ない試験ファイル・`--root`（repeat-tests.js・mutate.js・impact.js）: repeat-tests.js は、ない試験ファイル（ディレクトリと、ない `--root` の下のファイルを含む）を、試験を実行する前に 2 にする。mutate.js は、ない `tests` を項目の誤り（2）にする（上の検査）。impact.js は、ない `--root` を 2 にする。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: mutate.js は、`file`・`tests` がリンクや `node_modules` を通るパス（写しでは作業ツリーを指す）を拒む（実パスが root の中の同じパスであること）。check-docs.js のプレースホルダーの2つ目の形の接頭辞を1つ以上にした（`SPEC_Q_GATE1_TBD`）。precheck.js は、CR を末尾空白として扱い（`git diff --check` と同じ）、CRLF の空行もファイルの末尾の余分な空行とする。`+++ ` の行のパスは、lib/git.js の `diffTarget` で、空白を含む名前の後のタブを除き、引用された名前（`"`・`\`・制御文字・8進数のバイト）を元に戻して読む（precheck.js・finding-scope.js）。あわせて、`+++ ` の行はファイルの見出し（`diff --git` の後、最初の hunk の前）の中だけで読むようにした（追加の行の内容が `++` で始まっても見出しとしない）。

4.6 の表・段落と各スクリプトの冒頭の注記に、上の動作を書いた。是正の規則ごとの一覧の変異（27件）を単位の一覧の変異に加え、是正で一致しなくなった9件を今のコードに合わせ、lib/js-lexer の2件の `tests` の `--test-skip-pattern` を `skipPattern` に移した（9本で計188件）。変わった単位を Stage 7 の当て直しとしてやり直し、Stage 8 をやり直す。Stage 7 の当て直しで生き残った変異に合わせて、試験を加え、余分になった check-docs.js のプレースホルダーの1つ目の形の接頭辞を外し（それを外す変異を除いて計187件）、lib/git.js の冒頭の注記を直した（review94 の 2.）。

## 3回目 — 要是正（Stage 6 へ。セキュリティの指摘を含む。要是正の3回目）

2回目の是正と、それが持ち込んだ問題を重点として審査した（4.1 の 7.）。指摘は10件（ゲートを止める指摘4件、将来の潜在の経路だけの指摘2件、文書だけの指摘4件）。ゲートを止める指摘のうち1件（mutate.js:308）は、SEC-37 の是正が足りないもので、セキュリティの指摘である。

ゲートを止める指摘:

- mutate.js:308: `insideRoot` は `path.relative(root, path.resolve(root, file))` を調べるので、root の中を指す絶対パスは相対パスになって通る（冒頭の注記と1回目の是正の「絶対パスでない」と合わない）。`repositoryFile` も通し、写し（`copyRepository`）が写さない `.git` の下と、先頭でない `node_modules` の下（`sub/node_modules/x.js`）も通る。`tests` を `["<root>/tests/t.test.js"]` にした項目は、基準の実行でも変異の実行でも作業ツリーの試験ファイル（写しの外）を実行する（SEC-37 の「写しの外のコードを実行しない」の是正の不足）。`file` を root の中の絶対パス・`.git/HEAD`・`sub/node_modules/x.js` にした項目は、写しの中で ENOENT の未処理の例外になり、終了コード 1 で止まる（4.6 は項目の誤りを、変異を当てる前に 2 とする）。
- finding-scope.js:44: 語でつないだ参照の検出は、括弧のない注記が2つ目の参照のファイル名でちょうど終わる形だけで、2つ目の参照の後にも括弧のない注記がある行（`- a.js:10 と b.js:20 ほか: …`、`a.js:10 および b.js:20 の2か所: …`、`a.js:10 と b.js:20（文書） ほか: …`）は、2つ目の参照を黙って落とし、終了コード 0 になる（2回目の指摘 finding-scope.js:34 の是正の不足）。
- check-docs.js:279: 変更の日を求める `git log -1 --format=%as` は、利用者の設定 `log.showSignature = true` で、署名したコミットの検証の行も標準出力に出す。lib/git.js の CONFIG はこの設定を固定していないので、設計書の版と改訂日を上げた署名したコミットで、「変更があるのに改訂日（2026-11-23）が変更の日（Good "git" signature for … 2026-11-23）より前」が出て終了コード 1 になる（`GIT_CONFIG_GLOBAL=/dev/null` なら 0。precheck.js も同じ）。
- finding-scope.js:185: `--snapshot` の書込みの誤り（親ディレクトリがない、保存先がディレクトリ）を捕まえず、未処理の例外で終了コード 1（「解決できない参照あり」の意味）になる（4.6 の共通の 2 と合わない）。

将来の潜在の経路だけの指摘（4.1 の 5.）: mutate.js:318（`node_modules` の除外が先頭の要素だけを大文字小文字を区別して比べるので、大文字小文字を区別しないファイルシステムで `Node_Modules/x.js` が通り、写しではリンクの `node_modules` を通って作業ツリーに書き込む。今のリポジトリには `node_modules` はない）、mutate.js:340（`node --test` は位置引数を glob として展開するので、glob の記号を含む名前のディレクトリ（`{..,w}`）があると、`{..,w}/t.test.js` が検査を通り、写しの外の `../t.test.js` を実行する）。

文書だけの指摘（4.1 の 4.）: review94:91（lib/git.js:71:46 の等価の理由が、`"` で始まり `"` で終わらない名前の場合を書いていない）、review93:11（1回目の件数が一覧と合わない。review94:15 も）、dev-scripts-precheck.test.js:66（`git diff --check` の行は `core.quotepath` によらず引用しないので、注記の「（core.quotepath=false）」が等価の理由と矛盾する）、dev-scripts-verify-twice.test.js:156（`testCommand` の2つ目の引数は platform なのに、パスを渡している）。

利用者に報告し（Gate 3 で3回続けて要是正）、利用者の決定で、すべて直して Stage 7・8 をやり直した後に4回目の審査を行い、その結果を見て決める。

### 是正（まとめて直した。4.1 の 8.）

ゲートを止める指摘:

- 絶対パス・`.git`・入れ子の `node_modules`（mutate.js、セキュリティ。SEC-37）: `insideRoot` は与えた文字列が絶対パスなら拒む（root の中を指す絶対パスも）。`repositoryFile` は、写しに入らない `.git`・`node_modules` を、どの深さの要素でも、大文字小文字を区別せずに拒む（`UNCOPIED`）。root の中の絶対パスの `tests` を与えても作業ツリーの試験を実行せず（実行されたら印を書く試料で確かめる）、`.git/HEAD`・`sub/node_modules/x.js`・root の中の絶対パスの `file`（`--auto` を含む）が、変異を当てる前に終了コード 2 になることを試験で確かめる。SEC-37 の表、4.6 の mutate.js の行、mutate.js の冒頭の注記を直した。
- 2つ目の参照の後の注記（finding-scope.js）: 括弧のない注記があり、内容が数字で始まる行は、後ろに来る文字によらず解析できない行とする（数字で始まる内容は、注記を括弧に入れて書く）。`- a.js:10 と b.js:20 ほか: …`・`- a.js:10 および b.js:20-22（文書） の2か所: …` の試験を加えた。冒頭の注記と 4.6 に書いた。
- 署名の検証の行（lib/git.js）: CONFIG に `log.showSignature=false` を加えた。git の試験に、比較元の後の署名したコミット（`.git` の中に置いた偽の署名のプログラムで署名する。Windows では署名しない）と、利用者の設定 `log.showSignature = true`・`gpg.program` を加え、`changedDocs` の結果（コミット済みの文書の変更の日を含む）を丸ごと比べる。冒頭の注記と 4.6 に書いた。
- `--snapshot` の書込みの誤り（finding-scope.js）: 書込みを捕まえて終了コード 2 にする。ない親ディレクトリとディレクトリの保存先の試験を加えた。冒頭の注記と 4.6 の終了コードに書いた。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: mutate.js は、`.git`・`node_modules` の判定で大文字小文字を区別しない（上の `UNCOPIED`）。`tests` の glob の記号（`*`・`?`・`[`・`]`・`{`・`}`・`(`・`)`・`!`、Windows 以外では逃がしの `\` も）を含む項目を拒む（`GLOB`）。`{..,w}/t.test.js` が写しの外の `../t.test.js` に展開されること、`\` を含む名前は node が見つけない（写しの外には出ない）ことを確かめた。`Node_Modules/x.js`・`tests/{a,b}.test.js`・`tests/a\b.test.js`（Windows 以外）の試験を加えた。

文書だけの指摘は、あわせて直した（4.1 の 4.）: review94 の lib/git.js:72:46（是正で1行ずれた）の等価の理由に、`"` で始まり `"` で終わらない名前の場合を加えた。1回目の件数を一覧に合わせて17件（ゲートを止める指摘12件）にした（review94 の表も）。dev-scripts-precheck.test.js の注記を「core.quotepath によらず」にした。dev-scripts-verify-twice.test.js の `testCommand` の2つ目の引数を `'linux'` にした。

是正の規則ごとの一覧の変異（9件）を単位の一覧の変異に加え、是正で一致しなくなった2件（mutate.js の `-` で始まる tests と node_modules）を今のコードに合わせた（9本で計196件）。53単位の Stage 7 の当て直しと Stage 8 をやり直した（review94）。

## 4回目 — 要是正（Stage 6 へ。要是正の4回目）

3回目の是正と、それが持ち込んだ問題を重点として審査した（4.1 の 7.）。指摘は8件（ゲートを止める指摘5件、将来の潜在の経路だけの指摘1件、文書だけの指摘2件）。ゲートを止める指摘に、セキュリティの指摘はない（将来の潜在の経路だけの1件は、SEC-37 と同じく写しの外に書き込む経路で、Windows の短い名前のときだけ起こる）。

ゲートを止める指摘:

- mutate.js:326: `insideRoot`（:310）と `repositoryFile` は `path.resolve` で正規化したパスを調べるが、写しへの書込み（:230 の `path.join(dir, mutant.file)`）と node に渡す `tests`（:168）は与えた文字列のまま使う。このため、末尾に `/` を付けたパスが検査を通る。`file` を `js/x.js/` にした項目は、基準の実行の後に :231 の readFileSync の ENOTDIR の未処理の例外で終了コード 1 になる。`tests` を `["tests/t.test.js/"]` にした項目（`--auto` の `--tests tests/t.test.js/` も）は、node がファイルを見つけず「変異なしの基準の実行が合格しない」で終了コード 1 になる（冒頭の注記と 4.6 は、ない対象のファイル・試験ファイルを、変異を当てる前に 2 とする。3回目の指摘 mutate.js:308 と同じ種類）。
- lib/git.js:37: CONFIG が `core.bigFileThreshold` を固定していない。git はこの大きさを超えるファイルをバイナリとして扱い、`git diff -U0` に hunk を出さない（`git diff --check` は報告する）。利用者の設定 `core.bigFileThreshold = 1k` で、1.5KB の js に行を加えると、precheck は行頭の空白を出さずに終了コード 0、finding-scope は変更したファイルを「差分の外」とし、`mutate.js --auto --since` は「下書きから変わった行に変異の候補がない」で終了コード 0 になる（Stage 7 の当て直しが黙って飛ぶ）。実装者も、2.1KB の js で、この設定のときだけ差分が `Binary files a/a.js and b/a.js differ` になることを確かめた。
- finding-scope.js:46: 括弧のない注記に半角の `:` があると、注記はそこで終わり、内容が2つ目の参照から始まるので、「内容が数字で始まる」の規則に当たらない。`- js/a.js:10 ほか（同じ形: js/b.js:20）: x`・`- a.js:10 ほか 変更外: b.js:20: x` は、参照が a.js:10 だけになり、b.js:20 を黙って落として終了コード 0 になる（3回目の指摘 finding-scope.js:44 と同じ種類。実装者も再現した）。
- finding-scope.js:181: `--from-snapshot` の内容の形を確かめない。JSON だが差分の保存でないファイル（`[]` など）は、`classify` の `Object.entries(diff.ranges)`（:91）の TypeError の未処理の例外で終了コード 1（「解決できない参照あり」の意味）になる（冒頭の注記と 4.6 の 2 と合わない）。
- dev-scripts-git.test.js:46: 署名したコミットは、一時ディレクトリの `.git` に置いた sh の偽の署名のプログラムを、git に直接実行させて作る。一時ディレクトリが noexec でマウントされた環境では `git commit -S` が失敗して試験が落ちる（除くのは Windows だけ。試験は環境に依存しない方式を先に使う）。`gpgsig` のヘッダーを持つコミットを `git hash-object -t commit -w --stdin` で作れば、作るときに署名のプログラムは要らない。

将来の潜在の経路だけの指摘（4.1 の 5.）: mutate.js:330（`repositoryFile` は `fs.realpathSync` で比べるので、Windows の 8.3 形式の短い名前（`NODE_M~1/pkg/index.js`・`GIT~1/HEAD`）は `UNCOPIED` にも実パスの比較にもかからない。短い名前を作る設定の Windows で、root に `node_modules` があると、写しのリンクの `node_modules` を通って作業ツリーに書き込む。今のリポジトリには `node_modules` はない）。

文書だけの指摘（4.1 の 4.）: review93:54（SEC-37 の表の前の文が「表は2回目の是正の後の内容」のままで、3回目に SEC-37 の是正の不足を指摘され、3回目の是正で直したことを書いていない）、review94:44（一掃 headless-runner の「最も長い試験 989ms / 上限 10000ms」は、比べた試験のうち最も長いものの値で、最も長い試験は上限と比べない試験の 1527ms。表を作る補助が、出力の比べない試験を拾っていない）。

利用者に報告し（Gate 3 で4回続けて要是正）、利用者の決定で、すべて直して Stage 7・8 をやり直し、この回の是正をもって通過とした（5回目の審査は行わない）。

### 是正（まとめて直した。4.1 の 8.）

ゲートを止める指摘:

- 正規の形でないパス（mutate.js）: 3回目までの、危ない形を1つずつ拒む直し方をやめ、`insideRoot` で、検査に使う正規化した相対パスと与えたパスが同じ形のときだけ通す（写しへの書込みと node の引数は与えたパスのまま使うため）。末尾の区切り・`.` と `..` の要素・重なった区切りを含む `file`・`tests`（`--auto` を含む）は、変異を当てる前に終了コード 2 になる。`lib.js/`・`./lib.js`・`tests//both.test.js`・`tests/../lib.js`・`tests/both.test.js/`・`./tests/both.test.js` と、`--auto` の末尾の区切りの試験を加えた。冒頭の注記と 4.6 に書いた。
- `core.bigFileThreshold`（lib/git.js）: CONFIG に `core.bigFileThreshold=512m`（git の既定の値）を加えた。git の試験の利用者の設定に `bigFileThreshold = 10`（試料のファイルより小さい）を加え、結果が変わらないことを確かめる。あわせて、スクリプトの git の呼出しの `diff -U0`・`diff --name-only`・`show` で、利用者の設定 `diff.renames = copies`・`diff.copies`・textconv・`diff.suppressBlankEmpty`・`diff.relative`・`diff.orderFile` が出力を変えないことを実測した（変えたのは `core.bigFileThreshold` だけだった）。冒頭の注記と 4.6 に書いた。
- 括弧のない注記の後の参照（finding-scope.js）: 括弧のない注記のある行は、内容が数字で始まるときに加えて、内容に参照の形（`ファイル:行`）があれば解析できない行とする（注記は最初の `:` で終わるので、後ろの参照は、注記がファイル名で切れれば内容が行番号で始まり、前の `:` で切れれば内容に入る。どちらの形も落とさない）。`- js/a.js:10 ほか（同じ形: js/b.js:20）: …`・`- a.js:10 ほか 変更外: b.js:20: …`・`- a.js:10 ほか（注: 下）と b.js:20: …` の試験を加えた。冒頭の注記と 4.6 に書いた。
- `--from-snapshot` の形（finding-scope.js）: 内容が差分の保存の形（`ranges` がファイルごとの `[開始, 終了]` の組の配列のオブジェクト、`untracked`・`files` が文字列の配列）でなければ終了コード 2 にする。`[]`・`null`・`{}` を含む12通りの形の試験を加えた。冒頭の注記と 4.6 の終了コードに書いた。
- 署名したコミットの作り方（dev-scripts-git.test.js）: 署名のプログラムを実行せず、`gpgsig` のヘッダーを持つコミットを `git hash-object -t commit -w --stdin` で作る（一時ディレクトリが noexec でもよい。Windows を除く分岐もなくした）。偽のプログラムは、利用者の設定 `log.showSignature` の検証の側だけに使う。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: mutate.js の `repositoryFile` は、実パスを `fs.realpathSync.native` で比べる（Windows では短い名前を長い名前に直すので、`NODE_M~1/…` は `node_modules` の下を指すことになり、比べた実パスが一致せず拒まれる）。短い名前はこの環境（Linux）で作れないので、一覧の変異「mutate: short names compared without the long names」は、理由を付けて等価とした（review94）。冒頭の注記・4.6・SEC-37 の表に書いた。

文書だけの指摘は、あわせて直した（4.1 の 4.）: SEC-37 の表の前の文に、3回目・4回目の是正を書き、「表は4回目の是正の後の内容」にした。review94 の表を作る補助が、上限と比べない最も長い試験も拾うようにした（headless-runner は「最も長い試験 1527ms・上限と比べない試験」）。

是正の規則ごとの一覧の変異（7件。うち1件は等価）を単位の一覧の変異に加え、是正で一致しなくなった4件を今のコードに合わせた（9本で計203件）。53単位の Stage 7 の当て直しと Stage 8 をやり直した（review94）。当て直しで、一覧の変異「mutate: absolute paths accepted」（`insideRoot` の絶対パスを拒む行を除く）が、正規の形の比較がほかの行で絶対パスも拒むようになって生き残ったので、理由を付けて等価とし、その単位だけをやり直した（review94）。
