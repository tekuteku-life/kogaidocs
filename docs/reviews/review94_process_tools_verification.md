# 開発プロセス v1.8.0 と監査前の機械的チェックの検証記録

**実施日**: 2026年11月23日<br>
**対象**: 作業ツリー（未コミット）、比較元 `ee512ac`（アプリの本番のコード js/・index.html・css・sw.js は変えていない）<br>
**関連記録**: [Gate 1 review91](review91_process_tools_gate1.md)、[Gate 2 review92](review92_process_tools_gate2.md)、[Gate 3 review93](review93_process_tools_gate3.md)、[残件台帳](../review_backlog.md)

## 1. 実施内容の要約

| 区分 | 内容 |
| :--- | :--- |
| 利用者の要求 | 「イテレーションの回数が多く開発が伸びた原因を確かめて、開発プロセスを改善する」「監査に出す前に機械的に防げたものは tests/scripts のスクリプトにし、開発プロセスに入れる」「今回の変更でない指摘は通過とし、内容は残す」「配信側の事項は残余にしない」「長い検証は単位に分けて、不合格の単位だけやり直す」。 |
| 開発プロセス | 開発プロセス定義書 v1.8.0。監査前の機械的チェック（4.6）、影響範囲の一覧、変異の当て込みと Gate 3 の前の当て直し、試験ごとの所要時間の上限、差分だけの再審査、変更外の指摘の扱いと残件台帳（4.7）、検証の頻度、単位ごとの実行と記録（Stage 4・7）。 |
| スクリプト | `tests/scripts/`: check-docs.js・impact.js・repeat-tests.js・mutate.js・precheck.js・verify-twice.js・finding-scope.js・lib/js-lexer.js・lib/git.js・stress/save-delay.json・stress/test-limits.json。 |
| 試験 | `tests/unit/dev-scripts-<スクリプト>.test.js` の9ファイル（47件）と共通の補助 `tests/helpers/dev-scripts.js`。`tests/system/csp-external-block.test.js` は字句解析を `tests/scripts/lib/js-lexer.js` に寄せた（16件）。 |
| ゲート | Gate 1・Gate 2 は、どちらも3回続けて要是正になった後、利用者の決定でその回の是正をもって通過とした（Gate 2 の3回目の是正は Gate 3 で確かめる）。Gate 3 の1回目は要是正（17件。セキュリティの指摘 SEC-37〜39 を含む）、2回目も要是正（13件。SEC-37・SEC-39 の是正の不足を含む）、3回目も要是正（10件。SEC-37 の是正の不足を含む）、4回目も要是正（8件。ゲートを止める指摘にセキュリティの指摘はない）で、それぞれすべて直した後に、Stage 7・8 をやり直した（この記録は4回目の是正の後のもの）。3回目・4回目の後に利用者に報告し、利用者の決定で、4回目の是正をもって通過とした（5回目の審査は行わず、是正は Stage 7・8 のやり直しで確かめた）。 |

## 2. Stage 7: 機械的構文チェックと変異の当て直し

- `node tests/scripts/precheck.js --base ee512ac`: 問題なし（比較元にもある変更外 5件。残件台帳の BL-006・BL-007 で扱う）。
- 変異の当て直し: Gate 3 の4回目の是正の後の最終のコードに、単位ごとに、一覧の変異（`--spec`。9本で計203件。4回目の是正の規則ごとの7件を加え、是正で一致しなくなった4件を今のコードに合わせた）と、全行への自動の変異（`--auto --lines 1-<行数>`。Stage 7 の `--since <下書きの写し>` の範囲を含む）を当て、一掃（実Chromium の試験は3回、それ以外は10回。`--coverage --load 2`）を行った。変異の単位は3つの流れで並べて実行し、終わってから一掃だけを実行した。各段の後に、試料のプロセスと mutate.js の写しが残っていないことを確かめた。Node.js は v24.19.0。
	- 2回目の是正の後の1回目（53単位。変異 04:27〜05:25Z、一掃 05:25〜05:45Z）: 6単位（自動の変異の mutate・precheck・finding-scope・lib/git、一覧の変異の check-docs・lib/git）が不合格だった。是正で行がずれて等価の指定と一致しなくなった6件（mutate.js の4件、precheck.js の2件）は、行番号を直した。新しく生き残った変異は、次のとおり扱った。
		- precheck.js・finding-scope.js の `let header = false` → `true`（最初の `diff --git` の前の行を見出しとして読む）: 試験に、最初の `diff --git` の前の `+++ ` の行と hunk を加え、読まないことを確かめる。
		- precheck.js・finding-scope.js の `error.code || error.message` → `&&`（読めない検証記録・指摘のファイルの誤りの文言）: 試験で、ディレクトリを与えたときの文言（`EISDIR`）を確かめる。
		- precheck.js の試験に、ASCII 以外の文字の名前のファイルの `git diff --check` の報告を加えた（名前を元のまま出す）。
		- lib/git.js:71（今は72）の `>` → `>=`・2つ目の `&&` → `||`（`diffTarget` の引用の判定）: 等価とした（理由は下）。
		- 一覧の変異「H19 placeholder prefix group in the first alternative removed」（check-docs.js のプレースホルダーの1つ目の形の接頭辞を外す）: Gate 3 の2回目の是正で2つ目の形の接頭辞を1つ以上にしたので、接頭辞のある語は、2つ目の形が同じ範囲で拾う。余分になった1つ目の形の接頭辞を外し（数える語は変わらない）、この変異を一覧から除いた。
		- 一覧の変異「git: paths are quoted」（lib/git.js の `core.quotepath=false` を外す）: 等価とした（理由は下）。あわせて lib/git.js の冒頭の注記を、この設定でも `"`・`\`・制御文字を含むパスは引用されることに直した。
	- 2回目の是正の後の2回目（53単位。変異 05:53〜06:51Z、一掃 06:51〜07:11Z）: lib/git.js はどの単位の入力にも入るので、53単位のすべてをやり直し、すべて合格した（その後の Stage 8 も合格した。07:11〜07:21Z）。
	- 3回目の是正の後（53単位。変異 07:58〜08:56Z、一掃 08:56〜09:16Z）: lib/git.js（どの単位の入力にも入る）・mutate.js・finding-scope.js と試験を変えたので、53単位のすべてをやり直し、すべて合格した（前の記録を再利用した単位はない。その後の Stage 8 も合格した。09:17〜09:27Z）。等価の指定は、是正で行がずれた6件（mutate.js の4件、lib/git.js の2件）の行番号を直した。
	- 4回目の是正の後（53単位。変異 12:36〜13:35Z、一掃 13:35〜13:55Z）: lib/git.js（どの単位の入力にも入る）・mutate.js・finding-scope.js と試験を変えたので、53単位のすべてをやり直した（前の記録を再利用した単位はない）。等価の指定は、是正で行がずれた6件（mutate.js の4件、lib/git.js の2件）の行番号を直した。一覧の変異「mutate: short names compared without the long names」は、この環境では等価とした（理由は下）。1単位（一覧の変異の mutate）が不合格だった。一覧の変異「mutate: absolute paths accepted」（`insideRoot` の `path.isAbsolute(file)` の行を除く）が、4回目の是正で加えた正規の形の比較で、ほかの行が絶対パスを拒むようになって生き残った。等価とし（理由は下。行は、絶対パスを拒むことをはっきりさせるために残す）、この単位だけをやり直して合格した（13:56〜14:09Z。ほかの52単位の記録は入力が変わらないので再利用した）。

結果（53単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一掃 tests/system/headless-access-mobile.test.js | `1b324de43390` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1407ms / 上限 10000ms） | 20秒 |
| 一掃 tests/system/headless-browser-handoff.test.js | `ec16de6d8a4a` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1232ms / 上限 10000ms） | 8秒 |
| 一掃 tests/system/headless-chrome.test.js | `e70eff77ca22` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 565ms / 上限 10000ms） | 14秒 |
| 一掃 tests/system/headless-csp-external.test.js | `488c94492e7b` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 608ms / 上限 15000ms） | 6秒 |
| 一掃 tests/system/headless-hata-complete.test.js | `cfba18081d14` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1088ms / 上限 10000ms） | 14秒 |
| 一掃 tests/system/headless-household.test.js | `d7c10f2c34ba` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 984ms / 上限 10000ms） | 8秒 |
| 一掃 tests/system/headless-import-leakage.test.js | `7965e262d623` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1062ms / 上限 15000ms） | 9秒 |
| 一掃 tests/system/headless-lifecycle-security.test.js | `a389f71b25b3` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1181ms / 上限 10000ms） | 16秒 |
| 一掃 tests/system/headless-next-year.test.js | `0c260a963db8` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1204ms / 上限 10000ms） | 8秒 |
| 一掃 tests/system/headless-runner.test.js | `c885144afe81` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1529ms・上限と比べない試験） | 10秒 |
| 一掃 tests/system/headless-save-invariant.test.js | `1e400ab34911` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1847ms / 上限 20000ms） | 48秒 |
| 一掃 tests/system/headless-saved-data-audit.test.js | `d79ea34759c5` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1275ms / 上限 10000ms） | 63秒 |
| 一掃 tests/system/headless-security-followup.test.js | `369ecaf64ca7` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 846ms / 上限 10000ms） | 26秒 |
| 一掃 tests/system/headless-security.test.js | `04e15417b41f` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 970ms / 上限 10000ms） | 38秒 |
| 一掃 tests/system/headless-specification-contracts.test.js | `fd79e16298a7` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 647ms / 上限 10000ms） | 9秒 |
| 一掃 tests/system/headless-ui-audit.test.js | `63af61ad87a6` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1265ms / 上限 10000ms） | 43秒 |
| 一掃 tests/system/headless-workflows.test.js | `c353b3f40d4f` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1669ms / 上限 10000ms） | 135秒 |
| 一掃 tests/system/csp-external-block.test.js | `f47735bccfb6` | 38（ブラウザー） | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 23395ms） | 247秒 |
| 一掃 tests/unit/access-version.test.js | `f5bf3cfec268` | 14 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 8ms） | 1秒 |
| 一掃 tests/unit/app.test.js | `12f3f57ede35` | 19 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 230ms） | 11秒 |
| 一掃 tests/unit/chairman-fiscal-year.test.js | `b2c07d74f669` | 21 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1940ms） | 79秒 |
| 一掃 tests/unit/import-output-hardening.test.js | `fead3a5a92b7` | 20 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 3393ms） | 71秒 |
| 一掃 tests/unit/security-core-coverage.test.js | `52d30595fc9b` | 22 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 149ms） | 13秒 |
| 一掃 tests/unit/security-save-invariant.test.js | `c6391ab5f1ac` | 21 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1789ms） | 71秒 |
| 一掃 tests/unit/security-state.test.js | `00c77ece4e46` | 22 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1826ms） | 38秒 |
| 一掃 tests/unit/dev-scripts-check-docs.test.js | `100593ca20b2` | 10 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 162ms） | 4秒 |
| 一掃 tests/unit/dev-scripts-finding-scope.test.js | `8b268dab1bce` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 36ms） | 2秒 |
| 一掃 tests/unit/dev-scripts-git.test.js | `58a6f3b891ce` | 15 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 451ms） | 6秒 |
| 一掃 tests/unit/dev-scripts-impact.test.js | `7fae0c05dd89` | 10 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 7ms） | 1秒 |
| 一掃 tests/unit/dev-scripts-js-lexer.test.js | `440e61687e09` | 8 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 5ms） | 1秒 |
| 一掃 tests/unit/dev-scripts-mutate.test.js | `3c244f2e6860` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 7881ms） | 145秒 |
| 一掃 tests/unit/dev-scripts-precheck.test.js | `ff801ceabcb0` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 2091ms） | 25秒 |
| 一掃 tests/unit/dev-scripts-repeat-tests.test.js | `ce01c1d14264` | 117（ブラウザー） | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 795ms） | 14秒 |
| 一掃 tests/unit/dev-scripts-verify-twice.test.js | `cde90cec7d1d` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 344ms） | 7秒 |
| 保存の遅延（save-delay.json） | `d04d916c1328` | 25 | 合格 | 2件中 問題 0件（生存・無効・不合格） | 57秒 |
| 自動の変異 check-docs | `f45a19619282` | 10 | 合格 | 123件中 問題 0件（生存・無効・不合格）（等価 4件） | 57秒 |
| 自動の変異 finding-scope | `ab769adc0fa9` | 13 | 合格 | 95件中 問題 0件（生存・無効・不合格） | 383秒 |
| 自動の変異 impact | `df07b65421fb` | 12 | 合格 | 39件中 問題 0件（生存・無効・不合格） | 12秒 |
| 自動の変異 lib/git | `42e7c595671d` | 22 | 合格 | 10件中 問題 0件（生存・無効・不合格）（等価 2件） | 172秒 |
| 自動の変異 lib/js-lexer | `fa13a866ea47` | 49（ブラウザー） | 合格 | 62件中 問題 0件（生存・無効・不合格）（等価 4件） | 1879秒 |
| 自動の変異 mutate | `1981f44d953c` | 13 | 合格 | 160件中 問題 0件（生存・無効・不合格）（等価 4件） | 3542秒 |
| 自動の変異 precheck | `44eb60da6c59` | 12 | 合格 | 58件中 問題 0件（生存・無効・不合格）（等価 2件） | 84秒 |
| 自動の変異 repeat-tests | `fa174f689060` | 119（ブラウザー） | 合格 | 67件中 問題 0件（生存・無効・不合格）（等価 1件） | 89秒 |
| 自動の変異 verify-twice | `ef3f8d043b5a` | 11 | 合格 | 54件中 問題 0件（生存・無効・不合格） | 21秒 |
| 一覧の変異 check-docs | `5b68846f8351` | 15 | 合格 | 31件中 問題 0件（生存・無効・不合格） | 14秒 |
| 一覧の変異 finding-scope | `526906a8eab6` | 12 | 合格 | 22件中 問題 0件（生存・無効・不合格） | 306秒 |
| 一覧の変異 impact | `229c14e3c6f6` | 13 | 合格 | 8件中 問題 0件（生存・無効・不合格） | 3秒 |
| 一覧の変異 lib/git | `0c4c0fabf0e0` | 22 | 合格 | 27件中 問題 0件（生存・無効・不合格）（等価 1件） | 250秒 |
| 一覧の変異 lib/js-lexer | `b8d1da7d3d85` | 49（ブラウザー） | 合格 | 12件中 問題 0件（生存・無効・不合格） | 124秒 |
| 一覧の変異 mutate | `71ce22aed757` | 11 | 合格 | 57件中 問題 0件（生存・無効・不合格）（等価 2件） | 756秒 |
| 一覧の変異 precheck | `ab4f81c3484a` | 12 | 合格 | 18件中 問題 0件（生存・無効・不合格） | 36秒 |
| 一覧の変異 repeat-tests | `31dd6bd28cbc` | 120（ブラウザー） | 合格 | 13件中 問題 0件（生存・無効・不合格） | 28秒 |
| 一覧の変異 verify-twice | `81ec56fffa33` | 12 | 合格 | 15件中 問題 0件（生存・無効・不合格） | 8秒 |

2回目の是正の後の当て直しで等価とした変異（lib/git.js の冒頭の注記に、3回目の是正で1行、4回目の是正で2行を加えたので、行は 71 から 74 になった。74:46 の理由は、3回目の文書の指摘で場合を足した）と、4回目の是正の後の当て直しで等価とした変異:

- lib/git.js:74:18 `>` → `>=`: 違うのは名前が " の1文字のときだけで、元に戻した空の名前も戻さない " も b/ で始まらないので、どちらも null を返す。
- lib/git.js:74:46 `&&` → `||`: 変異の後の条件は「2文字以上で " で始まる、または " で終わる」で、違うのは、" で終わり " で始まらない名前と、" で始まり " で終わらない2文字以上の名前のときだけである。git は " を含む名前を必ず引用し、引用した名前は " で始まり " で終わるので、git の出力の「+++ 」の行には、どちらの名前も現れない（名前が " の1文字のときは、上と同じく元に戻しても戻さなくても null）。
- 一覧の変異「git: paths are quoted」: core.quotepath が変えるのは、差分の見出し（diff --git・---・+++ の行）の ASCII 以外の文字の名前の引用だけで、+++ の行は diffTarget が引用を元に戻すので結果は変わらない。ほかに読む git の出力（-z の一覧、git diff --check の行）は、この設定によらず名前を引用しない（git 2.53.0 で確かめた）。見出しの名前を読みやすくするために残す。
- 一覧の変異「mutate: short names compared without the long names」（mutate.js の `fs.realpathSync.native` を `fs.realpathSync` にする）: Linux（この検証の環境）では fs.realpathSync と fs.realpathSync.native は同じパスを返す。違うのは、Windows の 8.3 形式の短い名前を長い名前に直すかどうかで、この環境では短い名前を作れない（Gate 3 の4回目の将来の潜在の経路だけの指摘への対応で、4.1 の 5. によりチェックに加えた）。
- 一覧の変異「mutate: absolute paths accepted」（mutate.js の `insideRoot` の `if (path.isAbsolute(file)) return false;` の行を除く）: 4回目の是正で加えた正規の形の比較（与えたパスと、検査に使う正規化した相対パスが同じ形のときだけ通す）が、絶対パスもすべて拒む。path.relative が返す相対パスは区切りやドライブ名で始まらないので、絶対パスと同じ形にならない。Windows の別のドライブ・UNC のパスでは path.relative が絶対パスを返して形が同じになるが、そのときは最後の !path.isAbsolute(relative) で拒む（この行は、絶対パスを拒むことをはっきりさせるために残す）。Windows の形（`C:\repo\lib.js`・`D:\x.js`・UNC・`\lib.js`・`C:lib.js`・`\\?\C:\…` など）を含む21通りで、`path.win32`・`path.posix` の `insideRoot` が、この行のあるなしで同じ結果を返すことを確かめた。

単位ごとの出力・記録・一覧は作業用のフォルダの `units/` の下（results/・specs/）にある（残件台帳 BL-008）。

## 3. Stage 8: 全テスト実行とカバレッジ（`verify-twice.js`）

`node tests/scripts/verify-twice.js --out <作業ツリーの外>` の出力をそのまま貼る（2026-11-23 14:09〜14:19Z。4回目の是正の後の Stage 7 の後に、並べずに実行した）。

| 検査 | 結果 |
| :--- | :--- |
| `npm test`（1回目） | 1128/1128件成功、fail 0・cancelled 0・skipped 0・todo 0、293230ms、終了コード0 |
| `npm test`（2回目、同一コード） | 1128/1128件成功、fail 0・cancelled 0・skipped 0・todo 0、295252ms、終了コード0 |
| SHA-256 照合 | 追跡対象と未追跡の新規ファイルの計219ファイルについて、2回の実行の前後で変更がないことを確認した |
| 検証したコードの SHA-256 | df08cba8b6319bb92fa17d31edeac2a6d26d7c9fd3ee44761ee0e3326888112f（docs/ を除く。コミットの前に `precheck.js --verified` で今のコードと照合する） |

| モジュール | Line % | Branch %（1回目） | Branch %（2回目） |
| :--- | ---: | ---: | ---: |
| `js/app.js` | 100.00 | 95.45 | 95.62 |
| `js/crypto.js` | 100.00 | 96.07 | 96.07 |
| `js/district.js` | 100.00 | 96.41 | 96.41 |
| `js/events.js` | 100.00 | 98.65 | 98.65 |
| `js/handoff.js` | 100.00 | 99.14 | 99.14 |
| `js/hata.js` | 100.00 | 95.75 | 95.75 |
| `js/neighbor.js` | 100.00 | 96.83 | 96.83 |
| `js/print.js` | 100.00 | 99.43 | 99.43 |
| `js/rep.js` | 100.00 | 96.76 | 96.76 |
| `js/seat.js` | 100.00 | 97.44 | 97.44 |
| `js/state.js` | 100.00 | 98.37 | 98.37 |
| `js/transfer.js` | 100.00 | 97.50 | 97.50 |
| `js/utils.js` | 100.00 | 98.98 | 98.98 |

| 試験ファイル | 件数 |
| :--- | ---: |
| `tests/integration/district-rep-sync.test.js` | 1 |
| `tests/integration/hata-polp-integration.test.js` | 1 |
| `tests/integration/neighbor-merge.test.js` | 5 |
| `tests/integration/print-pipeline.test.js` | 1 |
| `tests/integration/storage-flow.test.js` | 1 |
| `tests/integration/transfer-integration.test.js` | 3 |
| `tests/system/browser-runtime-evaluation.test.js` | 1 |
| `tests/system/csp-external-block.test.js` | 16 |
| `tests/system/headless-access-mobile.test.js` | 7 |
| `tests/system/headless-browser-handoff.test.js` | 3 |
| `tests/system/headless-chrome.test.js` | 9 |
| `tests/system/headless-csp-external.test.js` | 4 |
| `tests/system/headless-hata-complete.test.js` | 7 |
| `tests/system/headless-household.test.js` | 3 |
| `tests/system/headless-import-leakage.test.js` | 3 |
| `tests/system/headless-lifecycle-security.test.js` | 6 |
| `tests/system/headless-next-year.test.js` | 3 |
| `tests/system/headless-runner.test.js` | 3 |
| `tests/system/headless-save-invariant.test.js` | 16 |
| `tests/system/headless-saved-data-audit.test.js` | 25 |
| `tests/system/headless-security-followup.test.js` | 14 |
| `tests/system/headless-security.test.js` | 19 |
| `tests/system/headless-specification-contracts.test.js` | 5 |
| `tests/system/headless-ui-audit.test.js` | 18 |
| `tests/system/headless-workflows.test.js` | 66 |
| `tests/system/static-analysis.test.js` | 3 |
| `tests/system/sw-security.test.js` | 32 |
| `tests/system/system-matrix.test.js` | 21 |
| `tests/unit/access-version.test.js` | 2 |
| `tests/unit/app.test.js` | 28 |
| `tests/unit/branch-coverage.test.js` | 23 |
| `tests/unit/browser-handoff.test.js` | 14 |
| `tests/unit/chairman-fiscal-year.test.js` | 73 |
| `tests/unit/crypto.test.js` | 11 |
| `tests/unit/dev-scripts-check-docs.test.js` | 13 |
| `tests/unit/dev-scripts-finding-scope.test.js` | 5 |
| `tests/unit/dev-scripts-git.test.js` | 2 |
| `tests/unit/dev-scripts-impact.test.js` | 2 |
| `tests/unit/dev-scripts-js-lexer.test.js` | 1 |
| `tests/unit/dev-scripts-mutate.test.js` | 8 |
| `tests/unit/dev-scripts-precheck.test.js` | 4 |
| `tests/unit/dev-scripts-repeat-tests.test.js` | 8 |
| `tests/unit/dev-scripts-verify-twice.test.js` | 4 |
| `tests/unit/district.test.js` | 28 |
| `tests/unit/events-security.test.js` | 12 |
| `tests/unit/handoff-guest-preserve.test.js` | 10 |
| `tests/unit/hata-complete.test.js` | 12 |
| `tests/unit/hata-input-drafts.test.js` | 4 |
| `tests/unit/hata-text-recovery.test.js` | 5 |
| `tests/unit/hata.test.js` | 22 |
| `tests/unit/household-transfer.test.js` | 4 |
| `tests/unit/import-output-hardening.test.js` | 19 |
| `tests/unit/neighbor.test.js` | 10 |
| `tests/unit/next-year-import.test.js` | 10 |
| `tests/unit/print.test.js` | 14 |
| `tests/unit/pwa-install.test.js` | 4 |
| `tests/unit/rep.test.js` | 37 |
| `tests/unit/save-invariant-coverage.test.js` | 13 |
| `tests/unit/seat.test.js` | 4 |
| `tests/unit/security-core-coverage.test.js` | 16 |
| `tests/unit/security-crypto.test.js` | 74 |
| `tests/unit/security-date-boundary.test.js` | 53 |
| `tests/unit/security-hata-output.test.js` | 6 |
| `tests/unit/security-import-commit.test.js` | 7 |
| `tests/unit/security-import-lifecycle.test.js` | 58 |
| `tests/unit/security-kdf.test.js` | 29 |
| `tests/unit/security-output-lifecycle.test.js` | 23 |
| `tests/unit/security-render-coverage.test.js` | 9 |
| `tests/unit/security-save-invariant.test.js` | 37 |
| `tests/unit/security-state.test.js` | 34 |
| `tests/unit/specification-contracts.test.js` | 16 |
| `tests/unit/state.test.js` | 7 |
| `tests/unit/transfer.test.js` | 15 |
| `tests/unit/ui-regressions.test.js` | 19 |
| `tests/unit/utils.test.js` | 19 |
| `tests/unit/version-consistency.test.js` | 1 |

| 時間のかかる試験（1回目） | ファイル | 所要時間 |
| :--- | :--- | ---: |
| R-25 / I-14-03: the static checks fail on copies that carry each documented violation sample | `tests/system/csp-external-block.test.js` | 22728ms |
| handoff SEC-25 (boundary & abnormal): unencrypted guest restore allows unedited default variants, wipes officer drafts/passwords/#hata-line-text, and rejects all officer boundary variants before confirm() | `tests/unit/browser-handoff.test.js` | 7842ms |
| mutate: a baseline run comes first, and results separate detected, surviving, equivalent, invalid and expected-pass mutants | `tests/unit/dev-scripts-mutate.test.js` | 7815ms |
| mutate: restoring across files, argument checks, line ranges without candidates and the timeout reaching the run | `tests/unit/dev-scripts-mutate.test.js` | 4531ms |
| QA-03: imported pupils with a grade outside 1-6 are rejected by name while blank placeholder rows are dropped | `tests/unit/import-output-hardening.test.js` | 3311ms |
| Mechanical syntax check: node -c across all production and test JavaScript files | `tests/system/static-analysis.test.js` | 2942ms |
| branch-booster: district.js and rep.js 95%+ branch coverage enhancements | `tests/unit/branch-coverage.test.js` | 2467ms |
| SPEC-Q2: after an import, a seat follows only the same person (name, role, phone and address) and is released for another or duplicated chairman | `tests/unit/chairman-fiscal-year.test.js` | 1890ms |
| precheck: a temporary repository reports base-relative whitespace, syntax, new duplicates, docs with --pending and --date, and the verified digest | `tests/unit/dev-scripts-precheck.test.js` | 1876ms |
| UI SEC-34: a guest tab shows the reason in the guest notice after another context updates the database | `tests/system/headless-save-invariant.test.js` | 1853ms |

`js/app.js` の分岐の網羅率が、2回の実行で異なる（95.45% と 95.62%）。前の記録の Stage 8 では、この作業の間は2回とも 95.62% だったが、比較元の記録（review90）でも同じ差（95.45% と 95.62%）が出ている。`js/hata.js` は2回とも 95.75% だった（Gate 3 の1回目・2回目の是正の後は 95.93% と 95.75% で回によって異なり、Gate 3 の1回目の前は2回とも 95.93% だった）。どの回も 95% 以上で基準を満たす。どちらのファイルも今回の変更で変えていない。
