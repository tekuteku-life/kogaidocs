# 単位ごとの実行の仕組みと設計書の古い識別子の検証記録

**実施日**: 2026年11月27日〜28日<br>
**対象**: 作業ツリー（未コミット）、比較元 `a6f6173`<br>
**関連記録**: [Gate 1 review99](review99_unit_runner_gate1.md)、[Gate 2 review100](review100_unit_runner_tests.md)、[Gate 3 review101](review101_unit_runner_gate3.md)、[残件台帳](../review_backlog.md)

## 1. 実施内容の要約

| 区分 | 内容 |
| :--- | :--- |
| 利用者の要求 | 「BL-6,8の対応を進めて」（残件台帳の BL-006: 設計書の逆引用符の中の識別子4件がコードにない、BL-008: 単位ごとの実行と記録の仕組みをリポジトリの `tests/scripts/` に入れる） |
| BL-006 | 文書だけを直した（コードは変えない）。外部仕様: 6.3 の印刷のタイトルの命名パターンを実際の命名に改め（`selectedSummary` を除く）、E-02-06・E-02-07・E-03-08・E-04-03 の動的タイトル連動から 6.3 を参照する。内部仕様: I-10 の `setActiveAppMode(null)` を除き、`saveFn` を保存キーと保存の関数の組（`[key, fn]`）の記述に、`usedPrompt` を実際の `usedCardPass` の条件に改め、10.3 の動的タイトル連動から外部仕様 6.3 を参照する |
| BL-008 | `tests/scripts/run-units.js`（単位の一覧を写しの上で単位ごとに実行し、入力の SHA-256 と結果を記録して、不合格の単位と入力が変わった単位だけをやり直す）と `tests/scripts/trace-reads.js`（単位の実行が読んだファイルを記録する `--require` の読込み）を新しく入れた |
| 開発プロセス定義書 | v1.9.0。4.6 の表に `run-units.js`・`trace-reads.js` の行（`run-units.js` の (1)〜(9) と終了コード）を加え、Stage 4 の「単位ごとの実行と記録」と Stage 7 の当て直しをこの仕組みで行うようにした。Stage 4 に、開発用のスクリプトの試験の Windows の扱いの基準（POSIX を対象とし、Windows ではシンボリックリンク・信号・プロセス群・`/proc`・POSIX のファイル名に依る試験を試験ごと除く。利用者の決定）を加えた |
| 設計書 | 要件・外部仕様・内部仕様は版 1.12（外部仕様・内部仕様は BL-006 の直し、要件は版の改めだけ） |
| 試験 | 新規の2ファイル（`tests/unit/dev-scripts-run-units.test.js` 18件・`tests/unit/dev-scripts-trace-reads.test.js` 7件。Gate 3 の1回目の是正で run-units の試験を1件加え、1回目・2回目の是正で既存の試験に場合を加えた） |
| ゲート | Gate 1 は3回続けて、Gate 2 は4回続けて要是正になった後、利用者の決定でその回の是正をもって通過とした。Gate 2 の4回目の是正は、Stage 7 の当て直しと Gate 3 で確かめる。Gate 3 は1回目が要是正だった（[review101](review101_unit_runner_gate3.md)。今回の変更による欠陥が1件）。Stage 6 で直し、Stage 7・8 をやり直した（2. の「Gate 3 の1回目の是正の後の当て直し」と 3.3）。2回目も要是正だった（試験の検出力の欠落が5件）。Stage 6 で直し、Stage 7・8 をやり直した（2. の「Gate 3 の2回目の是正の後の当て直し」と 3.4）。3回目も要是正だった（欠陥3件）。利用者の決定で設計を簡単にし（リンクのたどり方と glob の基点の計算をやめた）、Stage 7・8 をやり直した（2. の「Gate 3 の3回目の是正の後の当て直し」と 3.5）。4回目も要是正だった（欠陥5件。利用者が続けると決めた3回目から数え直して1回目）。Stage 6 で直し、Stage 7・8 をやり直した（2. の「Gate 3 の4回目の是正の後の当て直し」と 3.6）。5回目も要是正だった（欠陥2件。数え直して2回目）。Stage 6 で直し、Stage 7・8 をやり直した（2. の「Gate 3 の5回目の是正の後の当て直し」と 3.7）。6回目も要是正だった（数え直して3回目）。利用者の決定「直して通過」により、指摘をすべて直して Stage 7・8 をやり直し（2. の「Gate 3 の6回目の是正の後の当て直し」と 3.8）、この回の是正をもって通過とした |

## 2. Stage 7: 機械的構文チェックと変異の当て直し

- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 整理（Stage 6）: 変更の中に消し残し（`console.log`・`debugger`・作業の印）がないことを確かめた。整理で変えたコードはない。
- 変異の当て直し（2026-11-27 01:43〜01:44Z）: Gate 2 の4回目の是正の後の最終のコードに、`run-units.js` で単位ごとに、一覧の変異（`--spec`。`run-units.js` 214件・`trace-reads.js` 83件）と自動の変異を当てた。
	- 自動の変異は `--auto <ファイル> --since <Gate 2 の4回目に出した写し>` とした。Stage 4 の7回目で、比較元（空のファイル）から変わったすべての行に自動の変異を当てて合格しているので、その後に変わった行が対象になる。
	- 一覧の変異の2単位は、入力（写しの全体を含む）が Stage 4 の7回目の合格から変わっていないので、記録を再利用した。入力が変わった2単位を実行した。
	- 結果: 4単位すべて合格。自動の変異は `run-units.js` で5件（等価の1件のほかは検出）、`trace-reads.js` は Gate 2 の4回目の写しから変わった行に変異の候補がない。
	- 等価の1件: `run-units.js` 435:13 `||` → `&&`（`resolveThrough` の空の部分と `.` を飛ばす条件。区切りが続くところ・末尾の区切りの空の部分と `.` は、`path.join` でいまの場所のままになり、その実パスもいまの場所なので、飛ばしても飛ばさなくても結果が同じ）。Stage 4 の等価の一覧（review100 の 5.）の位置は、その後の行のずれのとおり。
	- 単位の記録（出力・入力の SHA-256・一覧・等価の一覧）は、作業用のフォルダの `bl68/units/` の下にある（specs/ に一覧と等価の一覧）。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `f87aaaa25140` | 145 | 合格（再利用。Stage 4 の7回目、2026-11-27 00:58Z） | 214件中 問題 0件（生存・無効・不合格） | — |
| 一覧の変異 trace-reads | `e91876d26706` | 136 | 合格（再利用。Stage 4 の7回目、2026-11-27 01:00Z） | 83件中 問題 0件（生存・無効・不合格） | — |
| 当て直しの自動の変異 tests/scripts/run-units.js | `0b9bf15b6b24` | 141 | 合格 | 5件中 問題 0件（生存・無効・不合格）（等価 1件） | 55秒 |
| 当て直しの自動の変異 tests/scripts/trace-reads.js | `e6d151daea7b` | 137 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |

### Gate 3 の1回目の是正の後の当て直し

- 期間: 2026-11-27 10:07〜10:53Z。
- 対象: Gate 3 の1回目の是正（[review101](review101_unit_runner_gate3.md)）の後のコード。`run-units.js` で単位ごとに当て直した。
- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 一覧の変異: 是正で直した規則を外す変異を加えた（`run-units.js` 8件・`trace-reads.js` 11件）。字面の変わった項目は、今のコードに合わせた。
	- `run-units.js` に加えた規則: 写しの途中の失敗の後始末、途中で木の外へ出るリンク、字面と実パスによる作業ツリーの中の判定。
	- `trace-reads.js` に加えた規則: glob の基点、記号ごとの判定、配列のパターン、根の下のパターン。
- 自動の変異: `--auto <ファイル> --since <Gate 3 の1回目に出した写し>` とした。
- 等価の1件: `run-units.js` 502:44 `true` → `false`（`freeze` の後始末の `force`）。
	- 理由: 消す一時ディレクトリは直前に `mkdtempSync` で作ったもので、消す時点で必ずある。`force` は、ないパスの誤りを無視するだけである。
	- 初めの実行では、この変異が生存として残り、単位が不合格になった。等価の一覧に加えて、この単位だけをやり直した（ほかの3単位は記録を再利用した）。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `a0fb97494987` | 145 | 合格 | 222件中 問題 0件（生存・無効・不合格） | 2357秒 |
| 一覧の変異 trace-reads | `837234fad726` | 136 | 合格 | 94件中 問題 0件（生存・無効・不合格） | 109秒 |
| Gate 3 の1回目の是正の自動の変異 tests/scripts/run-units.js | `6678a631dbbb` | 155 | 合格 | 18件中 問題 0件（生存・無効・不合格）（等価 1件） | 127秒 |
| Gate 3 の1回目の是正の自動の変異 tests/scripts/trace-reads.js | `617fde9263f2` | 136 | 合格 | 6件中 問題 0件（生存・無効・不合格） | 8秒 |

### Gate 3 の2回目の是正の後の当て直し

- 期間: 2026-11-27 11:36〜12:21Z。
- 対象: Gate 3 の2回目の是正（[review101](review101_unit_runner_gate3.md)）の後のコード。`run-units.js` で単位ごとに当て直した。
- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 一覧の変異: 2回目に生存した5件と、是正の規則を外す変異を加えた（`run-units.js` 15件・`trace-reads.js` 16件）。字面の変わった項目は、今のコードに合わせた。
	- `run-units.js` に加えた規則: リンクを1つずつ読むたどり方、段の上限、`whole` の読取りと扱い。
	- `trace-reads.js` に加えた規則: `whole` の判定の境の文字ごと、`file:` の URL の作業ディレクトリ。
	- 加えた変異だけを、先に `mutate.js --spec` で当てて、すべて検出されることを確かめた（run-units 19件・trace-reads 33件。字面を合わせた項目を含む）。
- 自動の変異: `--auto <ファイル> --since <Gate 3 の2回目に出した写し>` とした。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `48101776fada` | 145 | 合格 | 237件中 問題 0件（生存・無効・不合格） | 2485秒 |
| 一覧の変異 trace-reads | `b61e0b72489c` | 136 | 合格 | 110件中 問題 0件（生存・無効・不合格） | 130秒 |
| Gate 3 の2回目の是正の自動の変異 tests/scripts/run-units.js | `4ce83ba9c09d` | 140 | 合格 | 6件中 問題 0件（生存・無効・不合格） | 62秒 |
| Gate 3 の2回目の是正の自動の変異 tests/scripts/trace-reads.js | `b3dd2b13e50e` | 136 | 合格 | 10件中 問題 0件（生存・無効・不合格） | 13秒 |

### Gate 3 の3回目の是正の後の当て直し

- 期間: 2026-11-27 13:09〜13:51Z。
- 対象: Gate 3 の3回目の是正（[review101](review101_unit_runner_gate3.md)。利用者の決定で設計を簡単にした）の後のコード。`run-units.js` で単位ごとに当て直した。
- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 一覧の変異: 除いたコード（リンクのたどり方・glob の基点の計算）の項目を外し、新しい規則を外す変異を加えた。字面の変わった項目は、今のコードに合わせた。
	- `run-units.js` に加えた規則: 写す作業ツリーのリンクを向き先によらず挙げること（写さない場所を除く・ディレクトリの下をたどる・名前の順）、写しの根とその祖先・一時ディレクトリとその祖先の一覧を写しの全体とすること。
	- `trace-reads.js` に加えた規則: glob を `whole`（パターンの JSON）として記録すること。
	- 変えた項目だけを、先に `mutate.js --spec` で当てた。生存した1件（写しの根だけの祖先を広げない変異）は、試験の場合を加えて検出されることを確かめた。
- 自動の変異: `--auto <ファイル> --since <Gate 3 の3回目に出した写し>` とした。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `13a21c155a9c` | 145 | 合格 | 227件中 問題 0件（生存・無効・不合格） | 2415秒 |
| 一覧の変異 trace-reads | `31616579527d` | 136 | 合格 | 85件中 問題 0件（生存・無効・不合格） | 97秒 |
| Gate 3 の3回目の是正の自動の変異 tests/scripts/run-units.js | `0eeda8289e9e` | 140 | 合格 | 7件中 問題 0件（生存・無効・不合格） | 64秒 |
| Gate 3 の3回目の是正の自動の変異 tests/scripts/trace-reads.js | `732f1ae0b9d8` | 137 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |

### Gate 3 の4回目の是正の後の当て直し

- 期間: 2026-11-27 15:10〜15:55Z。
- 対象: Gate 3 の4回目の是正（[review101](review101_unit_runner_gate3.md)）の後のコード。`run-units.js` で単位ごとに当て直した。
- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 一覧の変異: 是正の規則を外す変異を加えた。字面の変わった項目は、今のコードに合わせた。
	- `run-units.js` に加えた規則: リンクを写した後の写しで調べること、写しの全体がディレクトリを含むこと、写しの絞込みが入れ子の `node_modules`・`.git` も除くこと。
	- `trace-reads.js` に加えた規則: コールバックの `fs.glob` と `fs.promises.glob` を包むこと。
	- 加えた変異だけを、先に `mutate.js --spec` で当てて、すべて検出されることを確かめた。
	- 初めの当て直し（2026-11-27 14:24〜15:08Z）では、一覧の変異「copyHashes: uncopied names kept」が生存して、一覧の変異 run-units の単位が不合格になった。写しの全体の入力を1つの一覧にしたため、写しのハッシュが `.git`・`node_modules` の名前を除く規則が、それまでの試験で見えなくなっていた。ブラウザーの単位の入力に `node_modules` が入らないことを確かめる文を試験に加え、4単位をやり直した（試験を変えたので、どの単位も入力が変わった）。
- 自動の変異: `--auto <ファイル> --since <Gate 3 の4回目に出した写し>` とした。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `20ae404f37f3` | 156 | 合格 | 231件中 問題 0件（生存・無効・不合格） | 2563秒 |
| 一覧の変異 trace-reads | `32e7e90ea8cb` | 152 | 合格 | 87件中 問題 0件（生存・無効・不合格） | 108秒 |
| Gate 3 の4回目の是正の自動の変異 tests/scripts/run-units.js | `58fe692708c1` | 152 | 合格 | 2件中 問題 0件（生存・無効・不合格） | 24秒 |
| Gate 3 の4回目の是正の自動の変異 tests/scripts/trace-reads.js | `c74bc8e34b69` | 152 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |

### Gate 3 の5回目の是正の後の当て直し

- 期間: 2026-11-27 16:28〜17:12Z。
- 対象: Gate 3 の5回目の是正（[review101](review101_unit_runner_gate3.md)）の後のコード。`run-units.js` で単位ごとに当て直した。
- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 一覧の変異: 是正の規則を外す変異を加えた。字面の変わった項目は、今のコードに合わせた。
	- `run-units.js` に加えた規則: 作業ツリーの実パスから写すこと、名前の順に並べること（`linksIn`・`makeContext` のファイルの一覧・`digestOf` のディレクトリ）、単位に渡す `PWD` と作業ツリーを指しうるパスの変数。
	- 加えた変異と字面を合わせた項目だけを、先に `mutate.js --spec` で当てて、すべて検出されることを確かめた。
- 自動の変異: `--auto <ファイル> --since <Gate 3 の5回目に出した写し>` とした。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `c281b269a222` | 156 | 合格 | 236件中 問題 0件（生存・無効・不合格） | 2524秒 |
| 一覧の変異 trace-reads | `2d7a386909c5` | 152 | 合格 | 87件中 問題 0件（生存・無効・不合格） | 97秒 |
| Gate 3 の5回目の是正の自動の変異 tests/scripts/run-units.js | `24d77bbb0b95` | 152 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |
| Gate 3 の5回目の是正の自動の変異 tests/scripts/trace-reads.js | `71a457020dbd` | 152 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |

### Gate 3 の6回目の是正の後の当て直し（最後の当て直し）

- 期間: 2026-11-27 20:08〜20:53Z。
- 対象: Gate 3 の6回目の是正（[review101](review101_unit_runner_gate3.md)。利用者の決定「直して通過」）の後のコード。`run-units.js` で単位ごとに当て直した。6回目の是正は試験と説明だけで、コードの動作は変えていない。
- `node tests/scripts/precheck.js --base a6f6173`: 問題なし。
- 一覧の変異: 6回目に生存した4件を加えた（写しの絞込みの相対パスの起点、審査の記録の名前の境界2件、ブラウザーの単位の入力の `docs/` の境界）。加えた変異と、もとからある BROWSER_FILE の変異を、先に `mutate.js --spec` で当てて、すべて検出されることを確かめた。
- 自動の変異: `--auto <ファイル> --since <Gate 3 の6回目に出した写し>` とした。
- 一時ディレクトリがリンクを通る環境（`TMPDIR` をシンボリックリンクのディレクトリにする）で、run-units の試験18件と trace-reads の試験7件がすべて合格することも確かめた（verify-twice の試験の1件は比較元でも落ちる。残件台帳の BL-012）。

結果（4単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 一覧の変異 run-units | `47516ee73b99` | 156 | 合格 | 240件中 問題 0件（生存・無効・不合格） | 2598秒 |
| 一覧の変異 trace-reads | `0db5b5c8a7f7` | 152 | 合格 | 87件中 問題 0件（生存・無効・不合格） | 104秒 |
| Gate 3 の6回目の是正の自動の変異 tests/scripts/run-units.js | `886d02616b39` | 152 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |
| Gate 3 の6回目の是正の自動の変異 tests/scripts/trace-reads.js | `b3a9b5fcf911` | 152 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |

## 3. Stage 8: 全テスト実行とカバレッジ（`verify-twice.js`）

### 3.1 1回目の実行（止まったため中止）

2026-11-27 01:44Z に `node tests/scripts/verify-twice.js --out <作業ツリーの外>` を始めたが、1回目の `npm test` の `tests/system/headless-access-mobile.test.js` で止まり、約4時間47分進まなかったので中止した（結果は使わない）。

- 原因: このマシン（WSL2）で、Chromium 150 の GPU のプロセスが起動の直後に止まり（スレッドが3本のまま待ち続ける）、描画のフレームが出なくなっていた（ページの `requestAnimationFrame` が呼ばれない。`chromium --headless=new --disable-gpu --screenshot` も終わらない）。開閉の後の高さを `requestAnimationFrame` で待つ「Hata normal」の3件が 20 秒の待ち切れで落ちた。
- 全体が止まった経路: `tests/system/helpers/headless-runner.js` の `runInHeadlessChrome` は、後始末でブラウザの本体だけを SIGKILL で止める。止まった GPU のプロセスは本体の後も残り、試験のプロセスの標準エラーのパイプを持ち続けるので、試験のファイルのプロセスが終わらなかった。
- 切り分け: 比較元 `a6f6173` の木でも同じになる（今回の変更によらない）。Chromium（2026-10-03 から）とパッケージは変わっていない。新しいプロファイル・`HOME`・`TMPDIR`、GPU を本体のプロセスの中で動かす（`--in-process-gpu`）、クラッシュの報告を切る、Mesa・Vulkan をソフトウェアに固定する、実時刻を10日・30日戻す、のどれでも同じで、`--use-gl=disabled` を足すと直る（この試験のファイルが7件とも合格）。
- 中止のときは、この実行が起こしたプロセス（実行のプロセス群と、環境変数 `KOGAI_VERIFY_JUNIT` がこの実行の出力先を指すもの、それらの Chromium の子）だけを止めた。
- 止まる経路は、残余（比較元でも同じになる）として残件台帳の BL-011 に記録した。

### 3.2 2回目の実行（利用者の決定による条件。Gate 3 の1回目の審査の基準）

利用者の決定「GL 無効の包みで今すぐ実施」により、`CHROMIUM_PATH` に、`/usr/lib/chromium/chromium --use-gl=disabled "$@"` を実行する包み（作業用のフォルダの `bl68/hang/chromium-nogl.sh`。作業ツリーの外）を指定して実行した。ほかの条件は 3.1 と同じ。Chromium を起動するのは `headless-runner.js` だけで、`verify-twice.js` は環境変数を子に渡す。

結果（2026-11-27 06:56〜07:08Z。記録の置き場所は作業用のフォルダの `bl68/verify2/`）:

- `npm test` は2回とも 1218/1218件成功した（fail 0・cancelled 0・skipped 0・todo 0。346236ms・351016ms。終了コード0）。
- 2回の実行の前後で、計236ファイルに変更がなかった。
- 網羅は、すべてのモジュールで Line 100%・Branch 95% 以上だった。
	- `js/hata.js` の Branch は 95.93% だった。前回の検証の記録（[review98](review98_csp_guest_tabs_verification.md) の第3節）では 96.10% である。
	- `js/rep.js` の Branch は、1回目と2回目で異なった（96.61%・96.76%）。
	- js のコードは比較元から変わっていない。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスは残っていなかった。
- この実行の後に、Gate 3 の1回目の是正でコードと試験を変えたので、3.3 でやり直した（さらに 3.4 でやり直した）。

### 3.3 3回目の実行（Gate 3 の1回目の是正の後）

WSL を再起動した後（2026-11-27 18:58 JST に起動）、`chromium --headless=new --disable-gpu --screenshot` が終わって描画のフレームが出ることを確かめた。そのため、包み（`CHROMIUM_PATH`）を指定せず、通常の条件で実行した。

結果（2026-11-27 10:54〜11:05Z。記録の置き場所は作業用のフォルダの `bl68/verify3/`）:

- `npm test` は2回とも 1219/1219件成功した（fail 0・cancelled 0・skipped 0・todo 0。356239ms・342883ms。終了コード0）。
- 2回の実行の前後で、計238ファイルに変更がなかった。
- 網羅は、すべてのモジュールで Line 100%・Branch 95% 以上だった。
	- `js/hata.js` の Branch は、3.2 と同じく 95.93% だった。js の網羅は Node の上の試験で測るので、3.2 の GL を無効にした Chromium によるものではない。
	- `js/district.js` の Branch は、1回目と2回目で異なった（96.41%・96.22%）。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスは残っていなかった。
- WSL を再起動した後は、比較元 `a6f6173` の木でも `tests/system/headless-access-mobile.test.js` が7件とも合格した（7秒。プロセスは残らない）。
- この実行の後に、Gate 3 の2回目の是正でコードと試験を変えたので、3.4 でやり直した（さらに 3.5〜3.8 でやり直した）。

### 3.4 4回目の実行（Gate 3 の2回目の是正の後）

3.3 と同じく、包み（`CHROMIUM_PATH`）を指定せず、通常の条件で実行した。

結果（2026-11-27 12:21〜12:33Z。記録の置き場所は作業用のフォルダの `bl68/verify4/`）:

- `npm test` は2回とも 1219/1219件成功した（fail 0・cancelled 0・skipped 0・todo 0。356525ms・352194ms。終了コード0）。
- 2回の実行の前後で、計238ファイルに変更がなかった。
- 網羅は、すべてのモジュールで Line 100%・Branch 95% 以上だった。`js/hata.js` の Branch は、1回目が 96.10%、2回目が 95.93% だった（同じコードの2回の実行でも変わる）。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスは残っていなかった。
- この実行の後に、Gate 3 の3回目の是正でコードと試験を変えたので、3.5 でやり直した（さらに 3.6〜3.8 でやり直した）。

### 3.5 5回目の実行（Gate 3 の3回目の是正の後）

3.3・3.4 と同じく、包み（`CHROMIUM_PATH`）を指定せず、通常の条件で実行した。

結果（2026-11-27 13:52〜14:04Z。記録の置き場所は作業用のフォルダの `bl68/verify5/`）:

- `npm test` は2回とも 1219/1219件成功した（fail 0・cancelled 0・skipped 0・todo 0。354516ms・343631ms。終了コード0）。
- 2回の実行の前後で、計238ファイルに変更がなかった。
- 網羅は、すべてのモジュールで Line 100%・Branch 95% 以上だった。`js/hata.js` の Branch は、1回目が 95.93%、2回目が 95.75% だった（同じコードの実行ごとに変わる）。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスは残っていなかった。
- この実行の後に、Gate 3 の4回目の是正でコードと試験を変えたので、3.6 でやり直した。

### 3.6 6回目の実行（Gate 3 の4回目の是正の後）

3.3〜3.5 と同じく、包み（`CHROMIUM_PATH`）を指定せず、通常の条件で実行した。

結果（2026-11-27 15:56〜16:08Z。記録の置き場所は作業用のフォルダの `bl68/verify6/`）:

- `npm test` は2回とも 1219/1219件成功した（fail 0・cancelled 0・skipped 0・todo 0。397866ms・339433ms。終了コード0）。
- 2回の実行の前後で、計238ファイルに変更がなかった。
- 網羅は、すべてのモジュールで Line 100%・Branch 95% 以上だった（`js/app.js` と `js/district.js` の Branch は、1回目と2回目で異なった）。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスは残っていなかった。
- この実行の後に、Gate 3 の5回目の是正でコードと試験を変えたので、3.7 でやり直した。

### 3.7 7回目の実行（Gate 3 の5回目の是正の後）

3.3〜3.6 と同じく、包み（`CHROMIUM_PATH`）を指定せず、通常の条件で実行した。

結果（2026-11-27 17:12〜17:24Z。記録の置き場所は作業用のフォルダの `bl68/verify7/`）:

- `npm test` は2回とも 1219/1219件成功した（fail 0・cancelled 0・skipped 0・todo 0。340447ms・350079ms。終了コード0）。
- 2回の実行の前後で、計238ファイルに変更がなかった。
- 網羅は、すべてのモジュールで Line 100%・Branch 95% 以上だった（`js/hata.js` と `js/rep.js` の Branch は、1回目と2回目で異なった）。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスは残っていなかった。
- この実行の後に、Gate 3 の6回目の是正で試験と説明を変えたので、3.8 でやり直した。

### 3.8 8回目の実行（Gate 3 の6回目の是正の後。最後の実行）

3.3〜3.7 と同じく、包み（`CHROMIUM_PATH`）を指定せず、通常の条件で実行した。

`node tests/scripts/verify-twice.js --out <作業ツリーの外>` の出力をそのまま貼る（2026-11-27 20:53〜21:06Z。Stage 7 の後に、ほかの試験と並べずに実行した。記録の置き場所は作業用のフォルダの `bl68/verify8/`）。

| 検査 | 結果 |
| :--- | :--- |
| `npm test`（1回目） | 1219/1219件成功、fail 0・cancelled 0・skipped 0・todo 0、393189ms、終了コード0 |
| `npm test`（2回目、同一コード） | 1219/1219件成功、fail 0・cancelled 0・skipped 0・todo 0、342932ms、終了コード0 |
| SHA-256 照合 | 追跡対象と未追跡の新規ファイルの計238ファイルについて、2回の実行の前後で変更がないことを確認した |
| 検証したコードの SHA-256 | a1498bac04693a6a50a8646fe72ddff5dffd195badd0ef6632031ecc8c4592c2（docs/ を除く。コミットの前に `precheck.js --verified` で今のコードと照合する） |

| モジュール | Line % | Branch %（1回目） | Branch %（2回目） |
| :--- | ---: | ---: | ---: |
| `js/app.js` | 100.00 | 95.97 | 95.97 |
| `js/crypto.js` | 100.00 | 96.60 | 96.60 |
| `js/district.js` | 100.00 | 96.41 | 96.22 |
| `js/events.js` | 100.00 | 98.65 | 98.65 |
| `js/handoff.js` | 100.00 | 99.14 | 99.14 |
| `js/hata.js` | 100.00 | 95.75 | 95.93 |
| `js/neighbor.js` | 100.00 | 96.83 | 96.83 |
| `js/print.js` | 100.00 | 99.44 | 99.44 |
| `js/rep.js` | 100.00 | 96.76 | 96.76 |
| `js/seat.js` | 100.00 | 97.44 | 97.44 |
| `js/state.js` | 100.00 | 98.39 | 98.39 |
| `js/transfer.js` | 100.00 | 97.46 | 97.46 |
| `js/utils.js` | 100.00 | 98.91 | 98.91 |

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
| `tests/system/headless-guest-cross-tab.test.js` | 5 |
| `tests/system/headless-hata-complete.test.js` | 7 |
| `tests/system/headless-household.test.js` | 3 |
| `tests/system/headless-import-leakage.test.js` | 3 |
| `tests/system/headless-lifecycle-security.test.js` | 6 |
| `tests/system/headless-next-year.test.js` | 3 |
| `tests/system/headless-render-hardening.test.js` | 8 |
| `tests/system/headless-runner.test.js` | 3 |
| `tests/system/headless-save-invariant.test.js` | 16 |
| `tests/system/headless-saved-data-audit.test.js` | 25 |
| `tests/system/headless-security-followup.test.js` | 14 |
| `tests/system/headless-security.test.js` | 19 |
| `tests/system/headless-specification-contracts.test.js` | 5 |
| `tests/system/headless-ui-audit.test.js` | 18 |
| `tests/system/headless-workflows.test.js` | 66 |
| `tests/system/static-analysis.test.js` | 3 |
| `tests/system/style-trusted-types-static.test.js` | 5 |
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
| `tests/unit/dev-scripts-run-units.test.js` | 18 |
| `tests/unit/dev-scripts-trace-reads.test.js` | 7 |
| `tests/unit/dev-scripts-verify-twice.test.js` | 4 |
| `tests/unit/district.test.js` | 28 |
| `tests/unit/events-security.test.js` | 12 |
| `tests/unit/guest-cross-tab.test.js` | 29 |
| `tests/unit/handoff-guest-preserve.test.js` | 10 |
| `tests/unit/hata-complete.test.js` | 12 |
| `tests/unit/hata-input-drafts.test.js` | 4 |
| `tests/unit/hata-text-recovery.test.js` | 5 |
| `tests/unit/hata.test.js` | 23 |
| `tests/unit/household-transfer.test.js` | 4 |
| `tests/unit/import-output-hardening.test.js` | 19 |
| `tests/unit/neighbor.test.js` | 11 |
| `tests/unit/next-year-import.test.js` | 10 |
| `tests/unit/print.test.js` | 15 |
| `tests/unit/pwa-install.test.js` | 4 |
| `tests/unit/render-html.test.js` | 9 |
| `tests/unit/rep.test.js` | 38 |
| `tests/unit/save-invariant-coverage.test.js` | 15 |
| `tests/unit/seat.test.js` | 4 |
| `tests/unit/security-core-coverage.test.js` | 16 |
| `tests/unit/security-crypto.test.js` | 74 |
| `tests/unit/security-date-boundary.test.js` | 53 |
| `tests/unit/security-hata-output.test.js` | 6 |
| `tests/unit/security-import-commit.test.js` | 7 |
| `tests/unit/security-import-lifecycle.test.js` | 58 |
| `tests/unit/security-kdf.test.js` | 29 |
| `tests/unit/security-output-lifecycle.test.js` | 23 |
| `tests/unit/security-render-coverage.test.js` | 11 |
| `tests/unit/security-save-invariant.test.js` | 37 |
| `tests/unit/security-state.test.js` | 34 |
| `tests/unit/specification-contracts.test.js` | 16 |
| `tests/unit/startup-failure-matrix.test.js` | 1 |
| `tests/unit/state.test.js` | 7 |
| `tests/unit/transfer.test.js` | 16 |
| `tests/unit/ui-regressions.test.js` | 19 |
| `tests/unit/utils.test.js` | 19 |
| `tests/unit/version-consistency.test.js` | 1 |

| 時間のかかる試験（1回目） | ファイル | 所要時間 |
| :--- | :--- | ---: |
| trace-reads: fs reads, existence checks, listings, copies, globs and module loads are recorded by kind once, with absolute paths, without changing the results | `tests/unit/dev-scripts-trace-reads.test.js` | 38554ms |
| R-25 / I-14-03: the static checks fail on copies that carry each documented violation sample | `tests/system/csp-external-block.test.js` | 25456ms |
| UI R-26: every migrated class has the effect of its declarations as an element style in every state | `tests/system/headless-render-hardening.test.js` | 19683ms |
| handoff SEC-25 (boundary & abnormal): unencrypted guest restore allows unedited default variants, wipes officer drafts/passwords/#hata-line-text, and rejects all officer boundary variants before confirm() | `tests/unit/browser-handoff.test.js` | 8060ms |
| mutate: a baseline run comes first, and results separate detected, surviving, equivalent, invalid and expected-pass mutants | `tests/unit/dev-scripts-mutate.test.js` | 7852ms |
| mutate: restoring across files, argument checks, line ranges without candidates and the timeout reaching the run | `tests/unit/dev-scripts-mutate.test.js` | 4552ms |
| run-units: the lock holds the process number and a random part, only its own lock is removed, and a finished lock is taken over by exactly one runner | `tests/unit/dev-scripts-run-units.test.js` | 3504ms |
| QA-03: imported pupils with a grade outside 1-6 are rejected by name while blank placeholder rows are dropped | `tests/unit/import-output-hardening.test.js` | 3478ms |
| Mechanical syntax check: node -c across all production and test JavaScript files | `tests/system/static-analysis.test.js` | 3299ms |
| UI R-27: clearing all data in another window empties this tab and its print area, and old values never come back | `tests/system/headless-guest-cross-tab.test.js` | 2984ms |

- 網羅: すべてのモジュールで Line 100%・Branch 95% 以上だった（Stage 8 の基準）。`js/district.js`（96.41%・96.22%）と `js/hata.js`（95.75%・95.93%）の Branch は、1回目と2回目で異なった（同じコードの実行ごとに変わる。js のコードは比較元から変わっていない）。
- 新しい試験の件数: `tests/unit/dev-scripts-run-units.test.js` 18件・`tests/unit/dev-scripts-trace-reads.test.js` 7件（前回の 1194件に25件を加えた 1219件）。
- 実行の後に、Chromium の GPU のプロセスと試験のプロセスが残っていないことを確かめた。

## 4. 残余

- BL-009（着手前の一掃で1回落ちた試験。再現しなかった）と BL-010（`mutate.js` が基準の実行の失敗の文言を残さない）は、未対応の残余として残件台帳にある。
- BL-011（Chromium の GPU のプロセスが止まると試験の全体が止まる）は、今回の検証で見つけた残余（比較元でも同じになる）として残件台帳に記録した。GPU のプロセスの止まりは WSL を再起動した後は起きず、3.3〜3.8 の Stage 8 は通常の条件で行った。後始末がブラウザの本体だけを止めるため、子のプロセスが残ると試験の全体が止まる経路は残る。
- `run-units.js` は、写しのシンボリックリンクを向き先によらず拒み（写した後の写しで調べる）、glob を使った単位は写しの全体を入力とする（Gate 3 の3回目の後の利用者の決定）。いまのリポジトリには、どちらもない。リンクや glob を使う単位が要るようになったら、この扱いを見直す。最上位の `node_modules` の下（リンクを通した読取り・モジュールの相対の読取り・書込み）が作業ツリーに届くことと、作業ツリーの中のパスを持つ環境変数を通した読取りが入力にならないことも、制限として 4.6 に書いた（このリポジトリには `node_modules` がなく、そのような環境変数も使わない）。
- 一時ディレクトリがリンクを通る環境で verify-twice の試験の1件が落ちることは、比較元でも同じなので、変更外として残件台帳の BL-012 に記録した。
- 開発用のスクリプトの試験は POSIX を対象とし、Windows ではシンボリックリンク・信号・プロセス群・`/proc`・POSIX のファイル名に依る試験を試験ごと除く（開発プロセス定義書 Stage 4。利用者の決定）。Windows での実行は確かめていない。
