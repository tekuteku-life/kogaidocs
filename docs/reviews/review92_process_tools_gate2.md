# Gate 2 テスト観点網羅性レビュー記録（開発プロセス v1.8.0 と監査前の機械的チェック）

**実施日**: 2026年11月22日〜23日<br>
**レビュワー**: 独立サブエージェント（Gate 2 テストレビュワー、読取専用。各回とも別個体）<br>
**対象**: 開発用のスクリプトの試験（1回目は `tests/unit/dev-scripts.test.js`（新規）。1回目の是正で、スクリプトごとの `tests/unit/dev-scripts-<スクリプト>.test.js` の9ファイルと共通の補助 `tests/helpers/dev-scripts.js` に分けた）、`tests/system/csp-external-block.test.js`（字句解析を `tests/scripts/lib/js-lexer.js` に寄せた）、実装の下書き `tests/scripts/`（変異の当て込みの対象）、Gate 1 の3回目の是正（[review91](review91_process_tools_gate1.md)。利用者の決定により Gate 2 で確かめる）<br>
**比較元**: ee512ac

## Stage 4 の手順の結果

- 着手前の一掃: 変える既存の試験 `tests/system/csp-external-block.test.js` を `repeat-tests.js --times 10 --coverage --load 2` で実行し、10回とも合格・上限の超過なし（最も長い試験は 26181ms。上限の表にない試験で、比べる上限はない）。
- 実装がない状態での確認: `tests/scripts/` を除いた写しで、`dev-scripts.test.js` と `csp-external-block.test.js` はどちらも `Cannot find module '../scripts/lib/js-lexer'` で失敗した。変えない経路（`csp-external-block.test.js` の字句の照合の結果）は、`tests/scripts/lib/js-lexer.js` が blankStrings を省けば元の関数と同じ動作であることを差分で確かめ、寄せた後も16件が合格した。
- 下書きの写し: Gate 2 に出す時点の `tests/scripts/*.js`・`lib/js-lexer.js` を作業ツリーの外に保存した（Stage 7 の当て直しの `--since` に使う）。

### 変異の当て込み（下書きの全行への `mutate.js --auto`）

試験は、そのスクリプトの試験だけを `--test-name-pattern` で選んだ `tests/unit/dev-scripts.test.js`（`lib/js-lexer.js` は `tests/system/csp-external-block.test.js` の字句の試験も含め、写しを使う遅い試験だけを `--test-skip-pattern` で除いた）。

| スクリプト | 1回目（試験を足す前） | 2回目（試験を足した後） | 確認（生存した行へ `--equivalents` 付きで当て直し） |
| :--- | :--- | :--- | :--- |
| `check-docs.js` | 119件中 問題15件 | 118件中 生存4件（すべて等価） | 14件中 問題0件 |
| `precheck.js` | 55件中 問題13件 | 54件中 生存3件（すべて等価） | 7件中 問題0件 |
| `repeat-tests.js` | 63件中 問題11件 | 62件中 生存1件（等価） | 2件中 問題0件 |
| `verify-twice.js` | 52件中 問題10件 | 51件中 問題0件 | — |
| `finding-scope.js` | 69件中 問題22件 | 68件中 生存1件（等価） | 1件中 問題0件 |
| `impact.js` | 33件中 問題14件 | 32件中 問題0件 | — |
| `lib/js-lexer.js` | 62件中 問題15件（dev-scripts の試験だけ） | 62件中 生存7件（csp の試験を含む。3件に試験を足し、4件は等価） | 22件中 問題0件 |
| `mutate.js` | 92件中 問題16件 | 92件中 生存2件（すべて等価） | 4件中 問題0件 |

- 1回目の問題のうち各1件（`lib/js-lexer.js` を除く）は、先頭の `#!` の行への「否定の除去」が構文を壊した「無効」で、`mutate.js` が `#!` の行をコードとして扱っていた不具合による。`autoMutations` で `#!` の行を対象から外した。
- 1回目の生存には、境界の値（上限ちょうど・分岐網羅 95% ちょうど・差分の前後3行の端・行の1行目）、失敗の経路（git の失敗の理由の文、削除されたファイル、読めない下書き、作業ツリーの変化）、出力の文字（表の「—」・「比べない」・「（トップレベル）」・「（関数の外）」）、引数の既定値を確かめる試験を、スクリプトごとに1つずつ加えた（`dev-scripts.test.js` の末尾の7件）。2回目の js-lexer の生存3件（テンプレートの `{` の前の文字、正規表現が改行で終わること、文字クラスの中の `/`）にも試験を加えた。
- 1回目の実行の途中で記録を作ったため、`precheck.js` の回は「作業ツリーが変わった」で止まり表が失われた。`mutate.js` は、それまでの表を出してから終了コード 2 で止まるようにした（試験を加えた）。
- 時間切れの変異（無限ループ）は「検出（時間切れ）」になり、確認の後も試験のプロセスは残っていない。

等価の一覧（`--equivalents` に与えたもの。名前は2回目の行番号）:

| スクリプト | 変異 | 等価の理由 |
| :--- | :--- | :--- |
| `tests/scripts/check-docs.js` | 87:20 < → <= | 最後の1回は、両方の版の範囲の外を 0 と 0 で比べるだけで、戻り値が変わらない |
| `tests/scripts/check-docs.js` | `264:19 \|\| → &&` | git status と git diff は同じリポジトリで実行するため、status だけが失敗して diff が成功する状況は作れない（どちらかが失敗すれば null を返す） |
| `tests/scripts/check-docs.js` | `288:18 \|\| → &&` | cat-file --batch には、成功した ls-tree が出した blob の SHA だけを渡すので失敗しない（git がなければ ls-tree の段で null を返す） |
| `tests/scripts/check-docs.js` | 348:49 true → false | 消すのは直前に作った一時ディレクトリで必ずあるので、force の有無で動作が変わらない |
| `tests/scripts/finding-scope.js` | 132:20 < → <= | 最後の1回は undefined を files に加えるだけで、使うのは files[0]（指摘のファイル）だけなので結果が変わらない |
| `tests/scripts/lib/js-lexer.js` | 37:13 < → <= | 閉じていない文字列の終わりで1文字先まで進むだけで、slice は文字列の長さで止まるため出力が変わらない |
| `tests/scripts/lib/js-lexer.js` | 47:13 < → <= | 閉じていないテンプレートの終わりで1文字先まで進むだけで、slice は文字列の長さで止まるため出力が変わらない |
| `tests/scripts/lib/js-lexer.js` | 58:13 < → <= | 閉じていない正規表現の終わりで1文字先まで進むだけで、slice は文字列の長さで止まるため出力が変わらない |
| `tests/scripts/lib/js-lexer.js` | 84:13 < → <= | 識別子の終わりで1文字先まで進むだけで、slice は文字列の長さで止まるため出力と直前の字句が変わらない |
| `tests/scripts/mutate.js` | 144:43 === → !== | spawnSync が error を返すとき（時間切れ・node を起動できない）は status が常に null なので、比較の結果によらず null を返す（1回目の是正で試験の実行を spawn に変え、この比較はなくなった） |
| `tests/scripts/mutate.js` | 201:44 true → false | 消すのは直前に作った写しのディレクトリで必ずあるので、force の有無で動作が変わらない |
| `tests/scripts/precheck.js` | 77:15 false → true | 最初の行に括弧がなければ深さは 0 で、opened の初期値によらず最初の行で返る。括弧があれば opened は真になる |
| `tests/scripts/precheck.js` | `157:18 && → \|\|` | 失敗した git diff の出力は空なので、追加の行が0件になり結果が変わらない |
| `tests/scripts/precheck.js` | `161:23 && → \|\|` | 失敗した git ls-files の出力は空なので、未追跡のファイルが0件になり結果が変わらない |
| `tests/scripts/repeat-tests.js` | 77:59 true → false | 消すのは直前に作った一時ディレクトリで必ずあるので、force の有無で動作が変わらない |

## 1回目 — 要是正（Stage 4）

指摘は19件（ゲートを止める指摘14件、将来の潜在の経路だけの指摘3件、文書だけの指摘2件）。

ゲートを止める指摘:

- review92:14: 変異は `--auto`（比較・論理演算・否定・真偽値）だけで、Stage 4 が求める「一覧で書く変異」（条件を外す・分岐を削る・件数や定数を変える）の一覧と結果の表がない。レビュワーが写しで一覧の変異32件を当てると、29件が生存した。
- check-docs.js:153: 試験名の照合の `^`・`$`、3行先までの照合の範囲、エスケープの戻しを外す変異が生存する。
- check-docs.js:273: 比較元より後にコミットした文書をさらに未コミットで直したときの変更の日を確かめていない。
- check-docs.js:389: `--fix-anchors` が試験で一度も実行されない。
- check-docs.js:35・326: 比較元の木に写すもの（`js`・`index.html`）と、照合の鍵の文書の名前を外す変異が生存する。
- precheck.js:95: トップレベルの `async function`・ジェネレーターの重複の試験がない。
- precheck.js:164: 未追跡の新規ファイルの末尾の空行を、precheck の試験で確かめていない（`.md` を外す変異も生存）。
- verify-twice.js:197: 環境の誤りで終了コード 2 を返す経路、node で始まらない test のスクリプト、時間のかかる試験の表の件数が試験されていない。
- repeat-tests.js:111: 負荷の子プロセスが親の動いている間は動き続けること、`--coverage` が子に届くこと、`--root` が効くことを確かめていない。
- mutate.js:196: 変異を入れたファイルを元に戻す処理を消しても、同じファイルの次の変異が上書きするので検出されない。
- mutate.js:229: `--max` を検査せず、行の外の `--lines` でも変異0件・終了コード 0 になる。main の引数・既定の上限・`--timeout` の受け渡しの試験がない。
- mutate.js:142: 試験を別のプロセスグループにしたため、Ctrl-C・SIGTERM で mutate.js を止めると試験のプロセスと一時の写しが残る。
- dev-scripts.test.js:46 ほか: スクリプトの git が利用者の設定（`diff.noprefix`・`diff.mnemonicPrefix`）と `GIT_DIR` を読むので、差分の解析と試験の結果が環境で変わる（`diff.noprefix=true` では precheck が追加の行の空白を黙って通す）。
- finding-scope.js:140: 位置引数の指摘のファイル、`--context` の受け渡し、呼出元の後の空行を除く条件が試験されていない。
- review92:10: 着手前の一掃を `csp-external-block.test.js` にしか行っていない（実Chromium・タイマーの試験、`save-delay.json`、変えた試験 `dev-scripts.test.js` の結果がない）。

将来の潜在の経路だけの指摘（4.1 の 5.）: dev-scripts.test.js:345（上限の表の漏れの検査が、先頭にない `timeout`・定数の値・別名の runner を拾わない）、verify-twice.js:116（どの試験も読み込まない js/ のモジュールが Line 100% の検査をすり抜ける）、precheck.js:83（引数を複数行に書いた関数の本文を1行だけとする）。

文書だけの指摘（4.1 の 4.）: development_process.md:299（`--verified` の記述4か所に `--base` がない）、review92:47（`mutate.js` の等価の理由の「ほかの error は試験で起こせない」が不正確）。

### 是正（まとめて直した。4.1 の 8.）

ゲートを止める指摘:

- 一覧で書く変異（review92:14）: スクリプトごとに、`--auto` が作らない種類の変異（条件を外す・分岐を削る・件数・定数・既定値・正規表現・引数の受け渡しを変える）の一覧を書いた（9本で計60件。レビュワーの32件のうち31件を含む。残る1件は、下の verify-twice.js の不要な分岐を消したため当てる先がない）。生存した変異には試験を足した。結果は下の「2回目に出す Stage 4 の結果」。
- check-docs.js:153: 試験名の全体の一致・宣言から3行先まで・エスケープした引用符の試験を加えた（`dev-scripts-check-docs.test.js` の「a test name matches whole, within three lines…」）。
- check-docs.js:273・389・35・326: `--fix-anchors` がファイルを書き換えること、コミットの後に未コミットで直した文書の変更の日がファイルの日付であること、比較元の木に `js`・`index.html` があること（コードの名前を変えると、変えていない文書の行が壊れることを検出する）、照合の鍵にファイルの名前を含むことの試験を加えた（同「--fix-anchors rewrites the file…」）。
- precheck.js:95・164: トップレベルの `async function`・ジェネレーターの重複、未追跡の新規ファイル（`.md` を含む）の末尾の空行の試験を加えた（`dev-scripts-precheck.test.js` の「async and generator duplicates…」）。
- verify-twice.js:197: 環境の誤りで終了コード 2 を返すこと、node で始まらない test のスクリプトをそのまま使うこと、時間のかかる試験の表が10件であることの試験を加えた。node で始まらないスクリプトを先に返す分岐は、`replace(/^node\s/, …)` が node で始まらない文字列を変えないので不要であり、消した（一覧の変異 C2 は当てる先がなくなった）。
- repeat-tests.js:111: 負荷の子プロセスが親の動いている間は動き続けること、`--coverage` が子の試験の実行に届くこと、`--root` が実行の場所と上限の表を移すことの試験を加えた。この試験を `--coverage` 付きの一掃で実行して、`--coverage` でない実行でも子が網羅を集める不具合が分かった（Node は、親の `NODE_V8_COVERAGE` を env から除いても子に渡す）。`--coverage` でないときは空の値を明示して止めるように直し、親が網羅を集めている状態を作ってこれを確かめる試験にした。
- mutate.js:196・229: 2つのファイルに順に変異を入れて、前のファイルが戻ってから次の変異を実行することの試験を加えた。`--max` を正の整数に限り、ファイルの行の外の `--lines` を引数の誤り（終了コード 2）、候補0件の `--lines` を問題（終了コード 1）、`--since` で変わった行に候補が0件のときは合格とし、試験を加えた（`--max` が自動の変異の件数を限ること、既定の上限、`--timeout` の受け渡しを含む）。
- mutate.js:142: 試験の実行を spawn で待つようにし、SIGINT・SIGTERM・SIGHUP を受けたら、実行中の試験のプロセスグループを止め、写しを消してから終わるようにした（`dev-scripts-mutate.test.js` の「an interrupt stops the running test process group…」）。時間切れの処理の中でグループを止める呼出しは、exit の処理が必ずグループを止めるので不要であり、消した。
- 利用者の Git の設定と環境変数（dev-scripts.test.js:46 ほか）: スクリプトの git の呼出しを `tests/scripts/lib/git.js` に寄せた。リポジトリを差し替える `GIT_*` の環境変数を外し、差分の形式（`--no-ext-diff`・`--no-textconv`・`--no-color`・`--src-prefix=a/`・`--dst-prefix=b/`、`core.quotepath=false`）を固定した。`diff.noprefix`・`diff.mnemonicPrefix` と `GIT_DIR` を設定した状態で、スクリプトの結果が変わらないことの試験を加えた（`dev-scripts-git.test.js`）。
- finding-scope.js:140: ファイルから読む指摘、`--context` が表に届くこと、呼出元の後の空行を除くことの試験を加えた。
- 着手前の一掃（review92:10）: 実Chromium の試験（`tests/system/headless-*.test.js`）は3回、タイマーと変えた試験（変えた既存の試験と `dev-scripts-*.test.js`）は10回、`--coverage --load 2` で一掃し、`save-delay.json` も当てる。結果は下の「2回目に出す Stage 4 の結果」。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: 上限の表の漏れの検査は、オブジェクトの中の位置によらず `timeout`・`timeoutMs` を拾い、値を数値に限り、`headless-runner` を使うファイルにはファイルの規則を求める。verify-twice.js は、`js/*.js` のうち網羅にないモジュールを問題にする。precheck.js は、引数を複数行に書いた関数の本文を、本文の `{` が開くまで読む。

文書だけの指摘は直した（4.1 の 4.）: 開発プロセス定義書の `--verified` の記述4か所に `--base` を書いた。`mutate.js` の等価の理由（上の等価の一覧の 144:43）を正確な理由に直した。

単位ごとの実行（利用者の提案）: 一掃と変異の当て込みは、全体を1つの実行にすると時間がかかり（約1.5時間）、1つの不合格で全体をやり直すことになる。そのため、単位（一掃は試験ファイル1つ、変異はスクリプト1本とその試験のファイルの組）ごとに、作業ツリーを固めた写しの上で実行し、単位ごとに入力の SHA-256 と結果を記録して、不合格の単位と入力が変わった単位だけをやり直すようにした。開発プロセス定義書の Stage 4・Stage 7 に書き、試験のファイルをスクリプトごとに分けた。実行の仕組み（`run-units.js`）は作業用のフォルダに置いて使い、`tests/scripts/` に入れることは残件台帳の BL-008（残余。利用者の決定）とした。

## 2回目に出す Stage 4 の結果（単位ごと）

一掃は `repeat-tests.js --times <回数> --coverage --load 2 <試験ファイル>`（実Chromium の試験は3回、それ以外は10回）、自動の変異はスクリプトの全行への `mutate.js --auto <スクリプト> --lines 1-<行数> --tests <その試験のファイル> --timeout 120000 --equivalents <等価の一覧>`、一覧の変異は `mutate.js --spec <一覧> --timeout 300000` である。単位ごとに、作業ツリーを固めた写しの上で実行した。入力の SHA-256 は、単位の対象のファイル・試験のファイル・共通の補助・実行に使うスクリプト（`repeat-tests.js`・`mutate.js`）・一覧の内容から求める。

単位に分けて実行した間に見つけて直したもの:

- 1回目の単位の実行（63単位）で、`dev-scripts-repeat-tests.test.js` の一掃が10回とも失敗した。親が網羅を集めているときに、`--coverage` でない子も網羅を集める不具合による（上の是正の repeat-tests.js:111）。
- 一覧の変異の生存（`mutate.js` の `--max` を外す変異）に試験を足した。生存した変異のうち、`verify-twice.js` の node で始まらないスクリプトを先に返す分岐と、`mutate.js` の時間切れの処理の中でグループを止める呼出しは、消しても動作が変わらない不要なコードだったので消した（一覧から2件を除いた）。`impact.js` の一覧の変異1件は、コードを直した後の文と合っていなかったので直した。
- 一覧の変異 A4（変更の日に、未コミットの変更よりコミットの日を優先する）が生存した。1回目の是正で加えた試験は、比較元の後のコミットに入っていない文書を直していたため、コミットの日がなく、変異の有無で結果が変わらなかった。比較元の後のコミットに入った文書をさらに直す形に改めた。
- 自動の変異の生存のうち、`mutate.js` の `--lines` の範囲の検査（`>` → `>=`）は等価ではなかった。末尾に改行のあるファイルでは、`split('\n')` の最後の空の要素を1行と数えていたため、ファイルの後の行を指定しても引数の誤りにならず、誤りの文の行数も1行多かった。末尾の改行の後を行に数えないように直し、最後の行と、その次の行の境界の試験を加えた。
- ほかの自動の変異の生存は、1回目に等価とした変異（上の等価の一覧）で行番号が変わっただけのものと、`mutate.js` の信号の処理の中で写しを消すときの `force`（写しは必ずある）である。単位ごとの等価の一覧（`scratchpad/units/specs/<スクリプト>.equivalents.json`）に書いて当て直した。
- 実行の仕組みが、自動の変異と一覧の変異の記録に同じ名前を使い、自動の変異の出力が上書きされていた。記録の名前に種類を付けて直し、自動の変異をすべてやり直した。

すべての単位の最後の実行の結果（53単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 結果 | 内容 | 所要時間 |
| :--- | :--- | :--- | :--- | ---: |
| 一掃 tests/system/headless-access-mobile.test.js | `bb49f1549b0b` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 2591ms / 上限 10000ms） | 27秒 |
| 一掃 tests/system/headless-browser-handoff.test.js | `00d282bd6704` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1829ms / 上限 10000ms） | 12秒 |
| 一掃 tests/system/headless-chrome.test.js | `d14aa45a0b5a` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 802ms / 上限 10000ms） | 20秒 |
| 一掃 tests/system/headless-csp-external.test.js | `f659ccf51030` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 863ms / 上限 15000ms） | 8秒 |
| 一掃 tests/system/headless-hata-complete.test.js | `6cdc76e0dc57` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1596ms / 上限 10000ms） | 21秒 |
| 一掃 tests/system/headless-household.test.js | `dba0d4be2209` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1406ms / 上限 10000ms） | 12秒 |
| 一掃 tests/system/headless-import-leakage.test.js | `e5b3072ea798` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1534ms / 上限 15000ms） | 14秒 |
| 一掃 tests/system/headless-lifecycle-security.test.js | `a23a7b0da334` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1697ms / 上限 10000ms） | 24秒 |
| 一掃 tests/system/headless-next-year.test.js | `6f3b1ecf8854` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1709ms / 上限 10000ms） | 12秒 |
| 一掃 tests/system/headless-runner.test.js | `4874bf237bc1` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1433ms / 上限 10000ms） | 12秒 |
| 一掃 tests/system/headless-save-invariant.test.js | `21dee302ae48` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 2789ms / 上限 20000ms） | 70秒 |
| 一掃 tests/system/headless-saved-data-audit.test.js | `3e25e3b0d83d` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1824ms / 上限 10000ms） | 95秒 |
| 一掃 tests/system/headless-security-followup.test.js | `6a2bde5ee42a` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1364ms / 上限 10000ms） | 40秒 |
| 一掃 tests/system/headless-security.test.js | `d234630bdabb` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1518ms / 上限 10000ms） | 58秒 |
| 一掃 tests/system/headless-specification-contracts.test.js | `49587acdbb03` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1030ms / 上限 10000ms） | 13秒 |
| 一掃 tests/system/headless-ui-audit.test.js | `6f1f4cca644c` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1795ms / 上限 10000ms） | 65秒 |
| 一掃 tests/system/headless-workflows.test.js | `1d5e39055d69` | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 2280ms / 上限 10000ms） | 208秒 |
| 一掃 tests/system/csp-external-block.test.js | `2c7b834dd993` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 34784ms） | 368秒 |
| 一掃 tests/unit/access-version.test.js | `67ac04c887ef` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 9ms） | 2秒 |
| 一掃 tests/unit/app.test.js | `ba87640e588c` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 331ms） | 15秒 |
| 一掃 tests/unit/chairman-fiscal-year.test.js | `b1bddcff17fc` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 2843ms） | 115秒 |
| 一掃 tests/unit/import-output-hardening.test.js | `76552c8fc58d` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 4883ms） | 102秒 |
| 一掃 tests/unit/security-core-coverage.test.js | `6e971150722f` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 205ms） | 18秒 |
| 一掃 tests/unit/security-save-invariant.test.js | `366edc269b8f` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 2690ms） | 106秒 |
| 一掃 tests/unit/security-state.test.js | `f245bd0aa151` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 2706ms） | 54秒 |
| 一掃 tests/unit/dev-scripts-check-docs.test.js | `7a61d698c81c` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 503ms） | 11秒 |
| 一掃 tests/unit/dev-scripts-finding-scope.test.js | `2a33bea541b0` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 58ms） | 4秒 |
| 一掃 tests/unit/dev-scripts-git.test.js | `33e8b53d4a02` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 317ms） | 5秒 |
| 一掃 tests/unit/dev-scripts-impact.test.js | `f2073737af7b` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 11ms） | 2秒 |
| 一掃 tests/unit/dev-scripts-js-lexer.test.js | `f71f7118c996` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 2ms） | 2秒 |
| 一掃 tests/unit/dev-scripts-mutate.test.js | `e29b96e9336d` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 8917ms） | 139秒 |
| 一掃 tests/unit/dev-scripts-precheck.test.js | `2306a6a03216` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1607ms） | 21秒 |
| 一掃 tests/unit/dev-scripts-repeat-tests.test.js | `15ad178be260` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 900ms） | 18秒 |
| 一掃 tests/unit/dev-scripts-verify-twice.test.js | `8930b157c9e5` | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 362ms） | 8秒 |
| 保存の遅延（save-delay.json） | `ed145a60626f` | 合格 | 2件中 問題 0件（生存・無効・不合格） | 71秒 |
| 自動の変異 check-docs | `f04d8dc3c641` | 合格 | 118件中 問題 0件（生存・無効・不合格）（等価 4件） | 56秒 |
| 自動の変異 finding-scope | `936485ef3c8a` | 合格 | 68件中 問題 0件（生存・無効・不合格）（等価 1件） | 260秒 |
| 自動の変異 impact | `0e04228f0d3f` | 合格 | 34件中 問題 0件（生存・無効・不合格） | 14秒 |
| 自動の変異 lib/git | `7a317ef7fc0e` | 合格 | 3件中 問題 0件（生存・無効・不合格） | 56秒 |
| 自動の変異 lib/js-lexer | `c906191315f4` | 合格 | 62件中 問題 0件（生存・無効・不合格）（等価 4件） | 2102秒 |
| 自動の変異 mutate | `1a977113a139` | 合格 | 105件中 問題 0件（生存・無効・不合格）（等価 2件） | 2113秒 |
| 自動の変異 precheck | `2daae8a8e202` | 合格 | 53件中 問題 0件（生存・無効・不合格）（等価 2件） | 60秒 |
| 自動の変異 repeat-tests | `0ab080c3b5f0` | 合格 | 62件中 問題 0件（生存・無効・不合格）（等価 1件） | 96秒 |
| 自動の変異 verify-twice | `2629f0eb0811` | 合格 | 52件中 問題 0件（生存・無効・不合格） | 23秒 |
| 一覧の変異 check-docs | `47b63c75265b` | 合格 | 18件中 問題 0件（生存・無効・不合格） | 12秒 |
| 一覧の変異 finding-scope | `74d756ef6fc8` | 合格 | 4件中 問題 0件（生存・無効・不合格） | 302秒 |
| 一覧の変異 impact | `f47cd5071998` | 合格 | 1件中 問題 0件（生存・無効・不合格） | 1秒 |
| 一覧の変異 lib/git | `e38fbd540e85` | 合格 | 4件中 問題 0件（生存・無効・不合格） | 85秒 |
| 一覧の変異 lib/js-lexer | `961a04e42784` | 合格 | 2件中 問題 0件（生存・無効・不合格） | 107秒 |
| 一覧の変異 mutate | `4a7a5f8ea166` | 合格 | 14件中 問題 0件（生存・無効・不合格） | 480秒 |
| 一覧の変異 precheck | `16690db89159` | 合格 | 7件中 問題 0件（生存・無効・不合格） | 11秒 |
| 一覧の変異 repeat-tests | `bb8624490fc2` | 合格 | 6件中 問題 0件（生存・無効・不合格） | 20秒 |
| 一覧の変異 verify-twice | `9c4b0c6730fc` | 合格 | 4件中 問題 0件（生存・無効・不合格） | 3秒 |

単位ごとの出力・記録・一覧は `scratchpad/units/` の下（results/・specs/）にある。Gate 2 の2回目に出す時点の実装の写しは `scratchpad/gate2_draft/` に置き直した（Stage 7 の `--since` に使う）。

## 2回目 — 要是正（2026年11月23日）

指摘は17件（ゲートを止める指摘15件、将来の潜在の経路だけの指摘2件）。1回目に続き2回続けて要是正である（3回続いたら利用者に報告する）。

ゲートを止める指摘:

- dev-scripts-mutate.test.js:207: 無限ループの試料が自ら終わらず、後始末を壊す変異（「mutate: no signal handler」「E4 timeout option ignored」）を当てると、試験のプロセス（CPU 100%）と写しが残り続ける。実装者の単位の実行の後にも、試料のプロセス18個（親の node --test を含む）が動いていた。上の「Stage 4 の手順の結果」の「確認の後も試験のプロセスは残っていない」と合わず、その後の一掃は記録の `--load 2` より重い負荷の下で行われた。
- dev-scripts-repeat-tests.test.js:165: 「`--coverage` が子に届く」の確認が、親の `NODE_V8_COVERAGE` に左右される（親が網羅を集めていると、Node が env から除いた値を子に渡すため、`--coverage` を渡さなくても合格する）。mutate.js・verify-twice.js も除くだけで効かない。
- development_process.md:150: 再利用の判定に使う入力に、結果を左右するファイル（試験が動かす本番のコード、上限の表、`repeat-tests.js`・`mutate.js`、一覧・等価の一覧、試験が読み取り・走査するファイル）が入っていない。
- development_process.md:149: 単位の対象を「本番のファイル・スクリプト」としたが、下書きの写しの保存と Stage 7 の `--auto --since` の対象は「本番のファイル（js・sw.js）」だけで、tests/scripts を実装とする作業では求められない。
- precheck.js:159: 追加の行の末尾空白を `git diff --check` に任せているが、利用者の `core.whitespace` で結果が変わる（`-trailing-space` で「問題なし」になる）。
- dev-scripts-git.test.js:31: 利用者の設定の試料が、固定するとした外部の差分と textconv を確かめていない（`--no-ext-diff`・`--no-textconv` を外す変異が生存した）。
- dev-scripts-check-docs.test.js:220: 比較元の木に写すもののうち `tests`・`sw.js` を外す変異が生存した。
- dev-scripts-precheck.test.js:58: check-docs に `--pending`・`--date` を渡すこと、未追跡の `.json` の検査を試験していない（3つの変異が生存した）。
- dev-scripts-verify-twice.test.js:54: main が記録に modules を入れること、snapshot の `--exclude-standard` を試験していない（2つの変異が生存した）。
- dev-scripts-mutate.test.js:220: 信号の試験が SIGINT だけで、SIGTERM・SIGHUP の後始末と終了コード 143・129 を確かめていない（3つの変異が生存した）。
- dev-scripts-mutate.test.js:185: `--lines` の行数の試料が、末尾に改行のあるファイルだけである（`- 1` にする変異が生存した）。
- dev-scripts-js-lexer.test.js:6: テンプレートの `${…}` の中の `{`・`}` の数え方と、正規表現を許す直前の字句（`?`・`yield` など）を試験していない（3つの変異が生存した）。
- dev-scripts-impact.test.js:55: 引数1つの矢印関数の分岐を試験していない（変異が生存した）。
- verify-twice.js:156: `--out` の判定が `relative.startsWith('..')` で、作業ツリー直下の `..records` を外とみなす。
- verify-twice.js:177: `--out` がないとき、環境の誤りで止まると空の一時ディレクトリが残る（試験のたびに `/tmp/kogai-verify-*` が1つ増えた）。

将来の潜在の経路だけの指摘（4.1 の 5.）: dev-scripts-repeat-tests.test.js:74（上限の表の漏れの検査が dev-scripts の試験を除いている）、check-docs.js:204（共通の補助 `tests/helpers/dev-scripts.js` が語彙と impact.js の除外に入っていない）。

レビュワーは、指摘に挙げたもののほかに、信号の後始末を解除しない変異（X17）と、check-docs の `--untracked-files=all` を外す変異（X4）の生存も一覧の結果に残していた。

### 是正（まとめて直した。4.1 の 8.）

ゲートを止める指摘:

- 無限ループの試料: 共通の補助に `hangCode`（60秒の期限で自ら終わるループ。プロセス番号と作業ディレクトリを書き残す）と `cleanupHung`（書き残したプロセスを、作業ディレクトリが記録と同じときだけ止め、残った写しを消す）を加え、3つの試料をこれに替えた。期限の前に写しの消失や親の変化で終わるようにはしなかった（mutate.js が止め損ねたことを、試験が見分けられなくなるため）。各試験の `finally` で片付ける。残っていた試料のプロセス18個（作業ディレクトリが `/tmp/kogai-mutate-*` で `tests/hang.test.js` を実行していたもの）を止め、使われていない写し48個と、空の `/tmp/kogai-verify-*` を消した。上の「確認の後も試験のプロセスは残っていない」は、mutate.js 自身の変異の単位を実行する前の記述で、その後の単位の実行では成り立たなかった。
- 親の網羅の設定: repeat-tests.js・mutate.js・verify-twice.js は、子の env の `NODE_V8_COVERAGE` を undefined にする（env に自分のキーがあると Node は親の値を渡さず、undefined の値は子の環境に入らない）。試験は、親が網羅を集めている状態（`process.env.NODE_V8_COVERAGE` を一時のディレクトリにする）を作って、`--coverage` の有無で結果が分かれること（repeat-tests）、試験の実行に届かないこと（mutate）、親の置き場所に何も書かれないこと（verify-twice）を確かめる。
- 単位の入力（development_process.md:150）: 入力を「その単位の実行が読むすべてのファイル」と定め、実行の間に読んだファイルを記録して求めること、記録できないもの（ブラウザーが `file://` で読むアプリのファイル）はその種類をすべて含めること、分からない単位は写しの全体とすること、入力の SHA-256 は実行した写しから求めることを書いた。実行の仕組み（`run-units.js`）は、Node のプロセスに読取りの記録（`trace-reads.js`。`--require` で読み込ませ、fs の読取り・一覧とモジュールの読込みを記録する）を付け、決まった入力（実行に使うスクリプト・上限の表・一覧・等価の一覧・対象と試験のファイル・package.json・package-lock.json）と合わせて、ファイルごとの SHA-256 を記録するようにした。ブラウザーを使う単位には、tests/・docs/ の外のすべてのファイルを入力に含める。
- 単位の対象（development_process.md:149）: 変異の対象のファイルを「その作業で実装として変えたファイル（本番のファイル js・sw.js。開発用のスクリプトを作る作業では `tests/scripts/` の .js も）」と定め、下書きの写しの保存と Stage 7 の `--auto --since` の対象もこれにそろえた。
- git の利用者の設定（precheck.js:159、dev-scripts-git.test.js:31）: lib/git.js のすべての呼出しに、`core.whitespace` の既定の値を付け、利用者の属性ファイル（`core.attributesFile`。`*.js -diff` で差分をバイナリにする）と除外ファイル（`core.excludesFile`）を読まないようにした（同じ種類の依存として加えた）。試料の利用者の設定に、失敗する外部の差分、行の先頭に文字を足す textconv、`core.whitespace = -trailing-space,-blank-at-eof`、属性ファイル、除外ファイルを加え、追加の行の末尾空白・ファイル末尾の空行・未追跡のファイルの検査が変わらないことを確かめる。
- check-docs.js の比較元の木: 試験のコードと sw.js にだけある名前を設計書に書き、改名すると「報告」になることを加えた。新しい未追跡のディレクトリの中の文書が変更として挙がることも加えた（X4）。
- precheck.js: `--pending` がプレースホルダーを許すこと、`--date` で改訂日の問題が出ること（ファイルの日付では出ない状態で確かめる）、未追跡の `.json` の末尾空白が報告されることを加えた。
- verify-twice.js: どの試験も読み込まない `js/b.js` を置いた実際の実行が終了コード 1 になること、無視されるファイルが集約値に入らないことを加えた。`--out` の判定を `relative === '..'`・`..` と区切り文字で始まる・絶対パス（別のドライブ）に直し、`..records` が中になることを加えた。一時ディレクトリは最初の snapshot の後に作るようにし、環境の誤りで残らないことを加えた。
- mutate.js: 信号の試験を SIGINT・SIGTERM・SIGHUP の3つにし、それぞれの終了コード（130・143・129）、試験のプロセスの停止、写しの消去を確かめる。main の後に信号の処理が外れることを加えた（X17）。改行で終わらないファイルの最後の行と、その次の行の境界を加えた。
- lib/js-lexer.js: `${f({ a: 1 })}` の後でテンプレートが閉じること、正規表現を許す直前の字句のすべてと、許さない字句（識別子・`)`・`]`・数・後置の `++`）の後では割り算になることを加えた。
- impact.js: 引数1つの矢印関数（`const single = x => inner(x);`）が関数名になり、呼出元をたどれることを加えた。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: 上限の表の漏れの検査は、dev-scripts の試験も対象にし、node:test の `timeout` は試験の宣言の引数にあるものだけを照合する（`runMutants` の引数などは除く。dev-scripts-mutate.test.js の2件を照合したことを確かめる）。runner を使うかは `require` の文で判定する。check-docs.js の語彙と impact.js の一覧から、共通の補助 `tests/helpers/dev-scripts.js` も除いた。開発プロセス定義書の 4.6 の表と Stage 4 の記述を直した。

レビュワーの一覧の変異（g2r2/specs の31件と leak.spec.json の2件）は、単位の一覧の変異に加え、今回の是正の規則ごとの変異（git の3つの設定、3つのスクリプトの親の網羅の設定、`--out` の判定、記録の置き場所の作成の順、補助の除外2件）も加えた（9本で計94件）。

## 3回目に出す Stage 4 の結果（単位ごと）

実行のしかたは2回目と同じ（一掃は `--coverage --load 2`、変異は全行への `--auto` と一覧の `--spec`）。入力は、2回目の是正の定義（実行が読んだファイル・決まった入力・ブラウザーを使う単位のアプリのファイル）で求め、単位の記録（`scratchpad/units/results/*.json`）にファイルごとの SHA-256 を残した。一掃の負荷を記録のとおり `--load 2` だけにするため、各回の実行は、変異の単位（3つの流れで並べて実行）がすべて終わってから一掃だけを実行する2段にした（このマシンのほかのプロジェクトのプロセスは除く）。各段の後に、試料のプロセスと mutate.js の写しが残っていないことを確かめた。下の表の一掃の記録は、入力が変わらなかった単位の記録を再利用しているため、次の3回の実行のものである（時刻は UTC）: 実Chromium の17単位とアプリの単体の試験の7単位は、新しい入力の定義での最初の実行の一掃（2026-11-22 17:30〜17:42Z）。csp-external-block と dev-scripts の7単位は、2回目の実行の一掃（18:30〜18:37Z）。dev-scripts-mutate・dev-scripts-repeat-tests の2単位は、最後の実行の一掃（19:45〜19:47Z。その回の変異の単位は 19:09〜19:45Z）。どの回も、一掃は同じ回の変異の単位がすべて終わった後に実行した。

単位に分けて実行した間に見つけて直したもの:

- 新しい入力の定義での最初の実行で、試料のプロセスは残らなかったが、mutate.js 自身への変異（写しを消す処理を壊すもの）が、試験の試料の写し11個を残した。mutate.js は写しの名前にプロセス番号を入れ（`kogai-mutate-<プロセス番号>-…`）、mutate.js の試験は、毎回の後に、そのプロセスが作った写しが残っていないことを確かめて消す（信号の試験は、子の mutate.js のプロセス番号の写し）。ほかの mutate.js の実行中の写しには触れない。
- 写しの名前を変えた後の実行でも、写しが7個残った。6個は信号の試験の子の mutate.js の写しで、信号の処理を壊す変異では終了コードの確認で試験が止まり、ループの中の片付けまで進まなかった（子のプロセス番号を集めて `finally` で片付けるようにした）。1個は、`applyMutation` の条件を変える変異（`find` が空のまま無限ループになる）で時間切れになり、mutate.js に止められた試験のプロセスの写しで、試験の中では片付けられない。
- これに対して、mutate.js が試験の実行を止めた後に「作ったプロセスがもう動いていない写し」を一時ディレクトリから消すようにしたところ、mutate.js 自身への変異（その条件を変えるもの）が、並べて実行していたほかの単位の動いている写しまで消し、3つの単位が ENOENT で止まった。一時ディレクトリの全体を掃除する処理は、変異が入ると影響が広すぎるのでやめた。代わりに、mutate.js は写しごとの一時ディレクトリ（`<写し>-tmp`）を作って試験の実行に `TMPDIR`・`TMP`・`TEMP` で渡し、試験の実行のたびに空にし、写しと一緒に消す。試験が作る写し・一時ファイル（時間切れで止めたプロセスのものを含む）はその中に入り、変異を入れたコードが触れるのもその中だけになる。この実行のほかの単位は、写しを消されて誤って「検出」になった可能性があるので、変異の単位をすべてやり直した。
- mutate.js 自身への変異（`--root` を無視させるものなど）が写しの全体を読むため、その単位の入力に審査の記録も入り、記録に結果を書くたびに入力が変わった。試験は審査の記録を読まないので、単位の写しから `docs/reviews/`・`docs/review_backlog.md` を除いた（開発プロセス定義書 Stage 4 に書いた）。
- 一覧の変異 X4（check-docs の `--untracked-files=all` を外す）は等価だった。git status にファイルを指定して渡すと、未追跡のディレクトリの中のファイルも1つずつ出るためである。不要な引数として消し、一覧から除いた（新しい未追跡のディレクトリの中の文書が変更として挙がる試験は残した）。
- 一覧の変異 X21（テンプレートの中の `{` を数えない）は、加えた試験では出力の文字が変わらず生存した。テンプレートの文字を空白にする `blankStrings` で、式が自分の `}` で閉じることを確かめる形に直した。
- 自動の変異の等価の一覧は、直した後のコードの行番号に合わせた（check-docs.js の 263・287・347 行、mutate.js の 178・241 行。理由は変わらない）。

すべての単位の最後の実行の結果（53単位。すべて合格。最後の実行の後に、試料のプロセスと mutate.js の写しは残っていない）:

入力の件数には、試験の試料の一時ディレクトリの中のパス（`kogai-dev-scripts-*`・`kogai-check-docs-*` など。名前は毎回変わる）が「なし」として入っている。この実行の対応づけが、写しごとの一時ディレクトリの中まで写しとみなしたためである。ほとんどは存在しないパス（「なし」）で、一部は試料の写しの中のディレクトリ（`js`・`tests` など）が写しの同じ名前のディレクトリの一覧に対応づけられた。どちらも再利用の判定では比べるものが増えるだけ（厳しくなる側）なので、記録は書き換えずに残した。実行の仕組みは、単位の最上位の mutate.js が作った写し（`kogai-mutate-<そのプロセス番号>-<6文字>`）の中だけを対応づけるように直した（次の実行から）。

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一掃 tests/system/headless-access-mobile.test.js | `91ee229ef12b` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1419ms / 上限 10000ms） | 20秒 |
| 一掃 tests/system/headless-browser-handoff.test.js | `0bd057362158` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1249ms / 上限 10000ms） | 8秒 |
| 一掃 tests/system/headless-chrome.test.js | `95c519100c77` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 579ms / 上限 10000ms） | 14秒 |
| 一掃 tests/system/headless-csp-external.test.js | `9243ac5bf0b7` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 589ms / 上限 15000ms） | 6秒 |
| 一掃 tests/system/headless-hata-complete.test.js | `8712896293e9` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1127ms / 上限 10000ms） | 14秒 |
| 一掃 tests/system/headless-household.test.js | `9187dca20d2e` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 994ms / 上限 10000ms） | 8秒 |
| 一掃 tests/system/headless-import-leakage.test.js | `355774305bb5` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1043ms / 上限 15000ms） | 9秒 |
| 一掃 tests/system/headless-lifecycle-security.test.js | `0e7f0284a3f8` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1159ms / 上限 10000ms） | 16秒 |
| 一掃 tests/system/headless-next-year.test.js | `2ee379a57a82` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1193ms / 上限 10000ms） | 8秒 |
| 一掃 tests/system/headless-runner.test.js | `d5095d7d1ae2` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1133ms / 上限 10000ms） | 10秒 |
| 一掃 tests/system/headless-save-invariant.test.js | `81cc5be12be7` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1854ms / 上限 20000ms） | 48秒 |
| 一掃 tests/system/headless-saved-data-audit.test.js | `26246ed8e338` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1193ms / 上限 10000ms） | 63秒 |
| 一掃 tests/system/headless-security-followup.test.js | `9b3e197acf50` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 853ms / 上限 10000ms） | 26秒 |
| 一掃 tests/system/headless-security.test.js | `2591908597d8` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 994ms / 上限 10000ms） | 38秒 |
| 一掃 tests/system/headless-specification-contracts.test.js | `ee04c9a755e0` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 651ms / 上限 10000ms） | 9秒 |
| 一掃 tests/system/headless-ui-audit.test.js | `a28a4c8c911b` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1256ms / 上限 10000ms） | 44秒 |
| 一掃 tests/system/headless-workflows.test.js | `0addc7824980` | 33（ブラウザー） | 合格 | 3回中 失敗0回、上限の超過 —（最も長い試験 1559ms / 上限 10000ms） | 137秒 |
| 一掃 tests/system/csp-external-block.test.js | `70f6d77f264f` | 38（ブラウザー） | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 23741ms） | 248秒 |
| 一掃 tests/unit/access-version.test.js | `3ef7ca51b3f8` | 14 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 6ms） | 1秒 |
| 一掃 tests/unit/app.test.js | `7062ef1528a3` | 19 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 236ms） | 11秒 |
| 一掃 tests/unit/chairman-fiscal-year.test.js | `3cae8a82c87e` | 21 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1935ms） | 79秒 |
| 一掃 tests/unit/import-output-hardening.test.js | `71dcca7cceb2` | 20 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 3406ms） | 71秒 |
| 一掃 tests/unit/security-core-coverage.test.js | `bfa62c6096e8` | 22 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 146ms） | 13秒 |
| 一掃 tests/unit/security-save-invariant.test.js | `0d94c0f8deda` | 21 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1827ms） | 71秒 |
| 一掃 tests/unit/security-state.test.js | `9b7852bf4d20` | 22 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1850ms） | 38秒 |
| 一掃 tests/unit/dev-scripts-check-docs.test.js | `6ca9cd4e9982` | 10 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 112ms） | 3秒 |
| 一掃 tests/unit/dev-scripts-finding-scope.test.js | `ef2134c874ed` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 39ms） | 2秒 |
| 一掃 tests/unit/dev-scripts-git.test.js | `ffb2ec6b13c4` | 14 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 198ms） | 3秒 |
| 一掃 tests/unit/dev-scripts-impact.test.js | `5b4585556c28` | 10 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 10ms） | 1秒 |
| 一掃 tests/unit/dev-scripts-js-lexer.test.js | `093e96b2d377` | 8 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 5ms） | 1秒 |
| 一掃 tests/unit/dev-scripts-mutate.test.js | `dab3c7585582` | 29 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 7818ms） | 137秒 |
| 一掃 tests/unit/dev-scripts-precheck.test.js | `44aa746c1328` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 1517ms） | 19秒 |
| 一掃 tests/unit/dev-scripts-repeat-tests.test.js | `7e7043228c52` | 117（ブラウザー） | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 860ms） | 14秒 |
| 一掃 tests/unit/dev-scripts-verify-twice.test.js | `0bcdd1d8f7b8` | 12 | 合格 | 10回中 失敗0回、上限の超過 —（最も長い試験 384ms） | 7秒 |
| 保存の遅延（save-delay.json） | `814dde6d78cd` | 25 | 合格 | 2件中 問題 0件（生存・無効・不合格） | 53秒 |
| 自動の変異 check-docs | `3e659da15d43` | 11745 | 合格 | 118件中 問題 0件（生存・無効・不合格）（等価 4件） | 31秒 |
| 自動の変異 finding-scope | `32ec81771798` | 1157 | 合格 | 68件中 問題 0件（生存・無効・不合格）（等価 1件） | 254秒 |
| 自動の変異 impact | `821b297eca58` | 1322 | 合格 | 34件中 問題 0件（生存・無効・不合格） | 10秒 |
| 自動の変異 lib/git | `2917b87a3b5b` | 1551 | 合格 | 3件中 問題 0件（生存・無効・不合格） | 51秒 |
| 自動の変異 lib/js-lexer | `a36e84dd2454` | 34797（ブラウザー） | 合格 | 62件中 問題 0件（生存・無効・不合格）（等価 4件） | 1917秒 |
| 自動の変異 mutate | `d2f5cfb353a9` | 10406（ブラウザー） | 合格 | 109件中 問題 0件（生存・無効・不合格）（等価 4件） | 2171秒 |
| 自動の変異 precheck | `3ec19b5d671d` | 8230 | 合格 | 53件中 問題 0件（生存・無効・不合格）（等価 2件） | 60秒 |
| 自動の変異 repeat-tests | `de88c57849ea` | 1180（ブラウザー） | 合格 | 62件中 問題 0件（生存・無効・不合格）（等価 1件） | 81秒 |
| 自動の変異 verify-twice | `262c6ce1ee07` | 766 | 合格 | 51件中 問題 0件（生存・無効・不合格） | 18秒 |
| 一覧の変異 check-docs | `4f7a1b97b760` | 3043 | 合格 | 22件中 問題 0件（生存・無効・不合格） | 7秒 |
| 一覧の変異 finding-scope | `5f3adfef7653` | 115 | 合格 | 4件中 問題 0件（生存・無効・不合格） | 301秒 |
| 一覧の変異 impact | `c72045d409b6` | 179 | 合格 | 3件中 問題 0件（生存・無効・不合格） | 1秒 |
| 一覧の変異 lib/git | `2151c9f0a4b3` | 2854 | 合格 | 9件中 問題 0件（生存・無効・不合格） | 78秒 |
| 一覧の変異 lib/js-lexer | `aff3398ccb5d` | 5682（ブラウザー） | 合格 | 6件中 問題 0件（生存・無効・不合格） | 126秒 |
| 一覧の変異 mutate | `f508f9c738cf` | 3056 | 合格 | 26件中 問題 0件（生存・無効・不合格） | 397秒 |
| 一覧の変異 precheck | `725d46c748d2` | 2228 | 合格 | 11件中 問題 0件（生存・無効・不合格） | 19秒 |
| 一覧の変異 repeat-tests | `b3126adaf847` | 282（ブラウザー） | 合格 | 8件中 問題 0件（生存・無効・不合格） | 21秒 |
| 一覧の変異 verify-twice | `d6b0b69a843c` | 205 | 合格 | 9件中 問題 0件（生存・無効・不合格） | 5秒 |

単位ごとの出力・記録・一覧は `scratchpad/units/` の下（results/・specs/）にある（2回目に出した結果は results-gate2r2/）。Gate 2 の3回目に出す時点の実装の写しは `scratchpad/gate2_draft/` に置き直した（Stage 7 の `--since` に使う）。

## 3回目 — 要是正（要是正の3回目。利用者に報告した）

指摘は13件（ゲートを止める指摘11件、将来の潜在の経路だけの指摘1件、文書だけの指摘1件）。

ゲートを止める指摘:

- check-docs.js:261: `--untracked-files=all` を消したことによる退行。消した後の `git status` は利用者の `status.showUntrackedFiles=no` に従うので、未追跡の新しい設計書を変更として挙げない（その設定で「A document in a new, untracked directory is a change」が失敗した）。上の X4 を等価とした理由は、既定の設定のときにしか成り立たない。
- lib/git.js:26: 固定していない設定で、まだ結果が変わる。`diff.interHunkContext = 10` で `-U0` の hunk がまとまり、finding-scope の範囲が広がり、precheck の行番号がずれる。クローンの `.git/info/attributes` の `*.js -diff` と `.git/info/exclude` で、precheck の検査と verify-twice の集約値からファイルが外れる。試料は `GIT_DIR`・`GIT_WORK_TREE` しか設定しておらず、REDIRECTING から `GIT_INDEX_FILE` を外す変異が生存した。
- dev-scripts-verify-twice.test.js:49: 既定の実行の回数（2回）を確かめていない（`runs: 1` にする変異が生存した）。
- dev-scripts-repeat-tests.test.js:57: 存在しない `--limits` を main に与えたときの終了コード 2 を確かめていない（`options.limits ||` を外す変異が生存した）。
- dev-scripts-finding-scope.test.js:126: CLI の既定の前後の行数（3）の境界と、`--callers` の深さが changedCallers に届くことを確かめていない（2つの変異が生存した）。
- dev-scripts-mutate.test.js:103: 基準の実行を試験の組ごとに行うことを確かめていない（最初の組だけ基準を実行する変異が生存した）。
- dev-scripts-mutate.test.js:49: `--since` で先頭の行を消した下書きの試験がない（`Math.max(1, start)` を `start` にする変異が生存した）。
- dev-scripts-check-docs.test.js:90: 識別子の照合が `.`・`-` の後の名前を除くことを確かめていない（`.` を外す変異が生存した）。この除外は 4.6 の表にも書いていない。
- dev-scripts-js-lexer.test.js:7: 文字列が行末で終わる処理、テンプレートの文字の中のエスケープ、文字列の後の `/` を割り算とする処理の試験がない（3つの変異が生存した）。
- dev-scripts-impact.test.js:50: `--ignore-case` が照合に届くことを確かめていない（変異が生存した）。
- development_process.md:154: 再利用を判定する鍵が入力のファイルだけで、単位の実行のしかた（回数・`--load`・`--coverage`・`--timeout`・試験の一覧・Node の版）と、今の単位の定義の入力が入っていない。

将来の潜在の経路だけの指摘（4.1 の 5.）: dev-scripts-repeat-tests.test.js:91（上限の表の漏れの検査が、`describe`・`suite` の options、宣言の外の変数で渡す `timeout`、`scripts` という名前のディレクトリ全般を拾わない）。

文書だけの指摘（4.1 の 4.）: review92 の「3回目に出す Stage 4 の結果」の、一掃を変異の単位の後に単独で実行したという記述と、入力の注記の「すべて存在しないパス」が、記録と合わない。

- 利用者への報告（2026年11月23日）: Gate 2 が3回続けて要是正になったことと、指摘の内訳（是正による退行1件、Git の設定への依存の残り1件、生存した変異への試験の不足7件、再利用の鍵1件、将来1件・文書1件。回を追うごとに周辺の分岐や環境の差に移っていること）を報告した。
- 利用者の決定（2026年11月23日）: 13件をすべて直し、Gate 2 はこの回で通過とする。直した後に、変わった単位を Stage 7 の当て直しとしてやり直し、この回の是正は Gate 3 で確かめる。

### 是正（まとめて直した。4.1 の 8.。利用者の決定によりこの回で通過とし、是正は Stage 7 の当て直しと Gate 3 で確かめる）

ゲートを止める指摘:

- check-docs.js の未追跡の文書: `git status` をやめ、未コミットの変更を「追跡しているファイルの HEAD からの変更（`git diff --name-only HEAD`）」と「未追跡のファイル（`ls-files --others --exclude-per-directory=.gitignore`）」で求める。`status.showUntrackedFiles` とクローンの `.git/info/exclude` に左右されない。上で X4 を等価としたのは、既定の設定のときにしか成り立たない誤りだった（この方法で `--untracked-files=all` は要らなくなった）。
- lib/git.js の設定: DIFF_FORMAT に `--inter-hunk-context=0` を加えた。未追跡のファイルの一覧を `UNTRACKED`（`.gitignore` だけで除く）に揃え、precheck.js・verify-twice.js・finding-scope.js・check-docs.js で使う（`--exclude-standard` をやめた。これで `core.excludesFile` の固定は不要になったので外した）。クローンの `.git/info/attributes` は git に読まない設定がないので固定できず、開発プロセス定義書 4.6 に依存として書いた。git の試験の試料に、`diff.interHunkContext = 10`・`status.showUntrackedFiles = no`・クローンの `.git/info/exclude`・`GIT_INDEX_FILE`・`GIT_OBJECT_DIRECTORY`・`GIT_COMMON_DIR` を加え、9行離れた2か所の変更の範囲と、check-docs の変更の一覧も比べる。
- verify-twice.js: 既定の実行の回数が 2 であることを加えた。
- repeat-tests.js: 存在しない `--limits` を main に与えると終了コード 2 になることを加えた。
- finding-scope.js: 既定の前後の行数（変更の3行前は中、4行前は外）と、深さ2の変わった呼出元が既定では表に出て `--callers 1` では出ないことを加えた。
- mutate.js: 2つ目の試験の組だけが基準の実行で落ちるとき、変異を1つも実行しないことと、下書きの先頭の行を消したときの範囲（`[[1, 1]]`）と、その範囲の自動の変異を加えた。
- check-docs.js の識別子: `navigator.sendBeacon`・`data-someName`・`someName-x`・`$someName` を照合しないことを加え、この規則を 4.6 の表に書いた。
- lib/js-lexer.js: 閉じていない文字列が行末で終わること、テンプレートの中の `` \` `` と `\${` がテンプレートの文字であること、文字列の後の `/` が割り算であることを加えた。
- impact.js: `--ignore-case` を付けた main で、大文字・小文字の違う出現が挙がることを加えた。
- 再利用の鍵（development_process.md:154）: 記録した結果を使う条件を、合格・実行のしかた（コマンドと引数、Node.js の版）が同じ・記録した入力がすべて同じ・今の単位の定義の決まった入力がすべて記録に含まれる、とした。記録に実行のしかたを残す。`run-units.js` も同じにした。

レビュワーの一覧の変異（`g2r3/specs-r1.json`・`specs-r2-lexer.json` の31件）を是正の前のコードの写しに当てると、指摘に挙げなかったものも含めて10件が生存した。指摘のもののほか、次を直した: check-docs.js の changedDocs の `files.includes` の確認は、git の呼出しに files を指定して渡すので不要であり、消した（R-cd2）。比較元の木の submodule の項目を写さないこと（R-cd3）、時間のかかる試験を5件まで残すこと（R-rt2）、網羅の基準を `js/` の直下のモジュールだけに当てること（R-vt2）、索引の submodule のディレクトリを集約値に入れないこと（R-vt3）、呼出元の循環をたどり直さないこと（R-im2）、写しに `.git` がなく `node_modules` がリンクであること（R-mu3・R-mu4）、`--tests` の空の名前を除くこと（R-mu6）、ブロックコメントの終わりの位置（R-lx1）の試験を加えた。レビュワーの一覧（R-cd2 を除く30件）と、この回の是正の規則ごとの変異（git の hunk の文脈・未追跡の一覧・3つの環境変数、check-docs の未コミットの2種類）を単位の一覧の変異に加えた（9本で計130件）。

将来の潜在の経路だけの指摘は、チェックに加えた（4.1 の 5.）: 上限の表の漏れの検査は、`describe`・`suite` の宣言の引数も照合し、宣言の引数でない `timeout` は `runMutants`・`runTests` の引数だけを許し、除くディレクトリを `tests/scripts` だけにした。開発プロセス定義書の Stage 4 の記述を直した。

文書だけの指摘は直した（4.1 の 4.）: 「3回目に出す Stage 4 の結果」の一掃の記録の時刻と条件、入力の注記を、記録に合わせて書き直した。

この回で Gate 2 を通過とした（利用者の決定）。変わった単位は Stage 7 の当て直しとしてやり直し、結果を Gate 3 の依頼文に付ける。
