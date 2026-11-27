# Gate 2 テスト観点網羅性レビュー記録（単位ごとの実行の仕組み）

**実施日**: 2026年11月26日<br>
**レビュワー**: 独立サブエージェント（Gate 2 テスト観点レビュワー、読取専用。各回とも別個体）<br>
**対象**: 開発用のスクリプトの試験（新規: `tests/unit/dev-scripts-run-units.test.js`・`tests/unit/dev-scripts-trace-reads.test.js`）、実装の下書き `tests/scripts/run-units.js`・`tests/scripts/trace-reads.js`（新規。変異の当て込みの対象）、Gate 1 の3回目の是正（[review99](review99_unit_runner_gate1.md)。利用者の決定により Gate 2・3 で確かめる）<br>
**比較元**: `a6f6173`<br>
**設計**: [Gate 1 の記録](review99_unit_runner_gate1.md)（3回目の是正をもって通過）。仕様は開発プロセス定義書 v1.9.0 の 4.6 の `run-units.js`・`trace-reads.js` の行と、Stage 4 の「単位ごとの実行と記録」

## Stage 4 の記録

### 1. 着手前の不安定な試験の一掃

- 既存の試験の一掃は、Gate 1 と並行して先に行った（[review99](review99_unit_runner_gate1.md) の Stage 1 の判断の末尾）。実Chromium の試験を3回、ほかのすべての試験ファイルを10回、負荷 2 で実行し、保存の遅延の変異を当てた。`headless-save-invariant.test.js` の SPEC-Q1 の1件が3回中1回落ちたほかは合格した（再現せず、残件台帳の BL-009）。
	- この一掃は、`run-units.js` をリポジトリに入れる前の作業用の版（`bl68/sweep/run-units.js`。単位の一覧を中に書いたもの）で実行した。結果の表は `bl68/sweep/summary.md`（84行。終了コード 1）で、PC が止まった後の再開の実行（2026-11-25 22:41〜22:53Z）のものである。この再開は、`--only` で SPEC-Q1 の単位を除いて実行した（その単位は別に繰り返して調べていたため）。そのため表にその単位の行はなく、その単位の結果は `bl68/sweep/results/_tests_system_headless-save-invariant.test.js.md`（3回中1回不合格）にある。
	- 表の84行のうち83行が合格（使い回しを含む）で、不合格の1行は `tests/unit/dev-scripts-run-units.test.js`（新しい試験。作業用の版の記録の仕組みが入れ子で記録を汚したため。[review99](review99_unit_runner_gate1.md) の Stage 1 の判断の末尾）だった。新しい試験は下の 5. で、今回の `run-units.js` で繰り返した。
- 新しい試験の2ファイルは、変異の当て込みと同じ単位の一覧で、`repeat-tests.js --times 10 --coverage --load 2` を `run-units.js` で実行した（下の 5. の表の「一掃」の行）。

### 2. 試験の実装

試験は、対象のスクリプトごとにファイルを分けた（単位ごとに実行するため）。Linux では全件を実行する。環境による除き方は次のとおり（Gate 2 の1回目の是正で、試験の skip と合わせた）。
	- Windows（win32）: 開発用のスクリプトの試験は POSIX で実行するものとし、シンボリックリンク・シグナル・プロセスグループ・`/proc`・Windows のファイル名に使えない文字に依る試験を、試験ごと除く（Gate 2 の3回目の後の利用者の決定。Stage 4 に書いた）。`dev-scripts-run-units.test.js` では17件のうち15件を除く: 試料のリポジトリで `main` を動かす試験8件（写しに試料の `node_modules` をリンクで置く。信号・例外で止める試験を含む）、単位の一覧の検査・記録の識別子と記録の読み方・記録の使い回しの判定・印の試験（リンクを作る）、結果の表の行（`"` を含むファイル名）、止めるプロセスの選び方（`/proc`。Linux だけで実行）、契約の試験（信号とプロセスグループ）。`dev-scripts-trace-reads.test.js` では7件のうち fs の試験と子のプロセスの試験の2件を除く（リンクを作る）。
	- 止めるプロセスの選び方の試験は Linux だけで実行する。`/proc` のない環境では、別のプロセスグループへ出た孫の単位と、`mutate.js` の試験・入れ子の単位を信号で止める確かめを除く（4.6 の (3) のとおり、プロセスグループだけを止めるため）。
	- git のない環境では、契約の試験の `mutate.js --since` の単位を除く。

- `tests/unit/dev-scripts-trace-reads.test.js`（7件）:
	- `KOGAI_TRACE_DIR` がなければ何も包まず、何も書かないこと。
	- fs の読取り・存在の確認・状態・アクセス権・実パス（`.native` を含む）・リンクの読取り・写しの元のファイル（`copyFile`）・コールバックと Promise の関数・ストリーム・`util.promisify` の `exists`・一覧（`opendir` を含む）・`cp`・glob（作業ディレクトリと `cwd`）・モジュールの読込みが、種類ごとに1回、絶対パスで記録されること。包む名前ごとに別のファイルを読む（同期・コールバック・Promise の関数。Gate 2 の1回目の是正で加えた）。相対パス・Buffer・`file:` の URL・ファイル記述子の扱い、元の関数の戻り値・例外・`this`・名前・付随するプロパティを変えないこと、写し先・リンクの先・記録そのものを記録しないこと。
	- 子のプロセス: Node 以外のプログラム（`sh`。`spawn`・`execFile` でも。名前が node で始まるだけのプログラムも）、シェル（`execSync` の既定、`shell: true`、`execSync`・`spawnSync`・`exec`（コールバック）に与えたシェル）、`spawn`・`execFile` で起こした受け継がない Node、`process.execPath` でない Node（リンク・名前だけの `node`・fork の `execPath`）、記録の設定を受け継がない Node（環境変数なし・ほかの `NODE_OPTIONS`・ほかの記録の置き場所・fork（`execPath` と `shell` の有無）・`process.env` の記録の置き場所を変えた後・`process.env` から設定を消した後）と、受け継ぐもの（`NODE_OPTIONS` を足したもの・ほかの変数を変えたもの）を見分けること。受け継ぐ子がそれぞれ自分の記録を書くこと。
	- どのプロセスも同じく記録すること、2つ目に読み込まれた写しが二重に記録しないこと、ESM の import と recursive の一覧。
	- Worker のスレッドがプロセスの記録に書くこと、環境変数を与えた Worker（受け継がないもの）・`SHARE_ENV`・options のない Worker（`process.env` の記録の置き場所を変えた後）の untraced の判定、記録の置き場所が消えた後も元の処理を変えないこと、記録の置き場所が後からできたときはそこから書くこと（書けなかった行の後も記録を続ける）。
	- 包んだ関数に `this` が届くこと（包む名前の関数を先に置き換える補助で確かめる）、`util.promisify(execFile)` が記録され `{ stdout, stderr }` を返すこと、相対パスの Buffer を絶対パスにすること（Gate 2 の2回目の是正で加えた）。記録が例外になる引数（ホストのある `file:` の URL）でも、元の関数の戻り値・例外の形を変えないこと（3回目の是正で加えた）。
	- `module.registerHooks` のない Node（読込みの前に消す補助で再現する）で、`require` がモジュールの読込みの包みで記録されること。`appendFileSync` が `fs.openSync` を通るとき（同じ補助で再現する）に、記録を書く処理を記録せず、記録の置き場所が消えた後もモジュールの読込みが失敗しないこと。
- `tests/unit/dev-scripts-run-units.test.js`（17件）。試料のリポジトリ（`scripts/unit.js` が最上位、`scripts/child.js` が子のプロセス）で、実物の `run-units.js` を `main` で動かす:
	- 引数（既定値（`--root` はリポジトリの根）・値の検査・記録の置き場所が作業ツリーの外であること、実パスでの比較）。コマンドとして起こしたときの終了コード（合格 0・不合格 1・引数の誤り 2）。ない `--root`・ディレクトリでない `--root` は何も作らずに終了コード 2。起動できない単位（作業ディレクトリがない）は例外でなく結果の誤りで返すこと。終わった単位を実行中の一覧から除くこと、出力が標準出力と標準エラーであること。
	- 単位の一覧の検査（キー・名前の重複と空白・先頭の .js のスクリプト（.js の名前のディレクトリを含む）・引数のパスとコンマで区切った各部分・`inputs`・`wholeCopy`）と、記録の置き場所の用意（目印・権限・ほかのものがある場所の拒否・親のない場所を親ごと作ること）。
	- 記録の名前・SHA-256・決まった入力・記録の読み方（種類ごとの振り分け、写しを写した最上位のプロセスの読取りの除外、`mutate.js` の写しの中のパスの対応（一時ディレクトリがリンクのときの実パスと、置き場所の正規表現の記号を含む））・入力の広げ方・実行の環境の SHA-256・起こしたプログラムの照合の値。
	- 記録の使い回しの判定（合格・形式（入力・起こしたプログラムがないかオブジェクトでない記録）・コマンド・Node.js の版・実行の仕組み・実行の環境・起こしたプログラム・必要な入力が記録に含まれること・入力の SHA-256）。理由に挙げる入力の数（5件ちょうどと、それを超えるとき）。作業ツリーの中のシンボリックリンクも写しのファイルの一覧に入り、その SHA-256 が向き先で変わること。
	- 結果の表の行、`NODE_OPTIONS` の引用、実行の仕組みの SHA-256。
	- 実行の全体: 読んだファイルの記録、合格した単位の使い回し、不合格の単位と入力が変わった単位のやり直し、入力の内容で変わる集約値（記録と表）、実行の環境（TZ）の違い、記録と出力の権限。
	- 単位ごとの固めた写し（審査の記録・網羅の設定・親の一時ファイルを含めない。作業ツリーの中のリンクはそのまま写す。`TMP`・`TEMP` も単位の一時ディレクトリ）、単位が写しの中に作ったリンクも写しの変更とすること、写しを変えた単位と外の入力が変わった単位の不合格、`trace-reads.js` の写し、別のプロセスグループに出た孫の後始末、自分の一時ディレクトリを消した単位の後始末と記録。
	- ブラウザー（`docs/` の外を入力にする）・ほかのプログラムと受け継がない Node（写しの全体）・ほかのパスの Node（起こしたプログラムとして記録し、入力を広げない）・写しの根を写す最上位（読取りを入力にせず、起こしたプログラムを照合する）・ESM・`mutate.js` の写しの対応。
	- `--jobs` の並行と `--list`（実行も記録もしない）、実行の初めに古い結果の表を消すこと。
	- 作業ツリーの中の、木の外を指すシンボリックリンク（絶対パス・相対パスで木の外へ出るもの）で写しを作らずに終了コード 2 になり（途中のリンクを通って木の外へ出るものを含む）、木の中を指すリンクと、写さない `node_modules`・審査の記録の下のリンクでは止めないこと。印のファイルの名前（`.run-units-records`）と引継ぎの印の名前の形。
	- 権限の確かめは、利用者の umask に依らないよう、試験のファイルの間 umask を 022 にして行う。写しの全体を入力とする単位の入力に、写しにリンクした `node_modules` が入らないこと。
	- 記録の置き場所の持ち主の判定（生きている持ち主で止める・終わった持ち主・壊れた値・0 から引き継ぐ）、印の中身（プロセス番号と乱数）と自分の印だけを消すこと、負の数の印の引継ぎ、読む前に消えた印の取り直し、読んだ後に取り直された印と、読み直しで消えていた直後に取られた印を置き換えないこと、読んだ後に終わった引継ぎの持ち主の中身に替わった印をたどって引き継ぐこと（`fs.readFileSync` を包んで起こす）、引継ぎの印（中身ごと。動いている引継ぎの持ち主で止め、終わった引継ぎの持ち主からはさらに引き継ぐ）、持ち主の終わった印と印のない置き場所のそれぞれで、同時に6つのプロセスが取りにいくと1つだけが取ること（印・引継ぎの印の名前を書込みで開いてから中身を書くまで（`openSync`・`writeFileSync`・`copyFileSync`）と rename の前に 50ms 待たせる補助を読み込ませ、印・引継ぎの印を中身を書いた一時のファイルのリンクとして作ることを確かめる。取れなかったものは「ほかの run-units.js が使っている」の例外だけを数え、取った印が取ったプロセスの一時のファイルと同じファイル（`ino`）であること、持ち主の終わった印を取った後は印と引継ぎの印が同じファイルであることも確かめる）、結果の表を単位が終わるたびに書き直すこと（2つ目の単位の実行中に止めても1つ目の行がある）、信号（SIGINT・SIGTERM・SIGHUP）で実行中の単位を止めて写しを消すこと、止めた単位の古い記録を残さないこと。単位が写しの置き場所ごと消した後の信号でも、後始末を終えて信号の終了コードで終わること。
	- 1つの単位の実行の例外で、ほかの実行中の単位を止めてから写しを消し、新しい単位を始めないこと。単位が写しの置き場所ごと消したときも終了コード 2 で終わり、後始末が例外にならないこと。
	- 止めるプロセスの選び方: 記録の置き場所が `KOGAI_TRACE_DIR` のもの・`KOGAI_TRACE_UNITS` の行にあるものだけで、ほかの変数に書いたもの・長い名前の置き場所のものを選ばず、`stopUnit` がそれらを止めないこと（下の 5. の1回目で加えた）。止める間に記録の置き場所を持つプロセスが新しく現れても止めること。
	- 契約の試験: 実物の `repeat-tests.js`・`mutate.js --spec`・`mutate.js --auto --since`（git を起こしたプログラムとして照合する）の単位で、試験が読んだ補助のファイルが入力に入ること、SIGTERM の後に `mutate.js` の試験のプロセスが残らないこと、入れ子の `run-units.js` の単位も止まること。

### 3. 実装がない状態での確認

比較元（`a6f6173`）の木に今の試験を重ねて実行した（作業用の写し。下の 5. で試験を加えた後に取り直した）。

| 試験ファイル | 比較元での結果 | 区分 |
| :--- | :--- | :--- |
| `tests/unit/dev-scripts-run-units.test.js` | ファイルが失敗（`Cannot find module '../scripts/run-units'`。17件とも実行されない） | 変える（新規） |
| `tests/unit/dev-scripts-trace-reads.test.js` | 7件すべて不合格（`--require` の `trace-reads.js` がない） | 変える（新規） |

- 変えない経路（`mutate.js`・`repeat-tests.js`・`headless-runner.js` と、それらの試験）は変えていない。契約の試験は、変えないそれらの引数・写しの名前と置き場所・プロセスグループを実物で確かめる。

### 4. 実装の下書きと、Stage 4 で決めた細部

- 下書きは、Gate 1 の3回目の是正の後の `tests/scripts/run-units.js`・`tests/scripts/trace-reads.js` で、下の 5. の直しを加えたもの。新しい試験24件はすべて合格し、`check-docs.js`・`precheck.js` は問題なし（このファイルの結果待ちのプレースホルダーのほか）。
- Stage 4 で決めた細部（Gate 2 の審査の対象に含める）:
	- `run-units.js` の止めるプロセスの選び方（`tracedProcesses`）: 環境変数の全体に単位の記録の置き場所の文字を含まないプロセスは、比べる前に除く（下の 5. の1回目で、比べ方の変異がほかの単位のプロセスを止めたため）。正しい比べ方のもとでは選ぶプロセスは変わらない（安全のための重ね）。
	- `trace-reads.js`: `createReadStream` と `exists` は包まない（中で呼出しの時点の `fs.open`・`fs.access` を呼ぶので、包んだ関数で記録される。試験の `o.txt`・`p.txt` で確かめる）。
	- `run-units.js` の実行の仕組みの SHA-256 は、`run-units.js` が読み込むモジュールをすべて含める（`tests/scripts` の外を除く条件は、読み込むモジュールがすべて `tests/scripts` の中にあるため働かず、除いた。4.6 の (7) の書き方を改めた）。作業ツリーの外の入力の SHA-256 は、実行の前に求めたものがあればそれを使う（絶対パスかの判定は、実行の前に求めたものが絶対パスだけなので要らない）。
	- `trace-reads.js`: 一覧と glob の options は、オブジェクトかを見ずに `recursive`・`cwd` を読む（options の代わりに渡すコールバックと文字列には、どちらもない）。Worker の `SHARE_ENV` はシンボルなので、オブジェクトの判定で除く。fork は与えた options に `shell: false` を重ねる（fork はシェルを使わない）。`module.registerHooks` の読込みは、URL を作って `file:` でないもの（`node:` の組込み）を除く。
- Gate 2 の1回目の是正で決めた細部:
	- `run-units.js` の記録の置き場所の印: 中身をプロセス番号と乱数にし、中身を書いた一時のファイルのリンクとして作る。持ち主の終わった印は、その中身ごとの引継ぎの印（`run-units.lock.<16文字>.taken`。これも一時のファイルのリンク）を作れた1つだけが、一時のファイルの rename で置き換える。引継ぎの印の持ち主が終わっていれば（置き換える前に止まった）、その中身でさらに引き継ぐ。引継ぎの印は残す。4.6 の (6) の書き方を改めた。
	- `trace-reads.js`: `exec`（コールバック）は包まない（中で呼出しの時点の `execFile` を、シェルを与えて呼ぶので、`execFile` の包みで記録される。試験で確かめる）。`execSync` は中の `spawnSync` を直接呼ぶので包む。
- Gate 2 の2回目の是正で決めた細部:
	- `run-units.js` の印の引継ぎ: 引継ぎの印を作った後、置き換える前に印を読み直し、その回に読んだ印か、たどった引継ぎの印の中身のままのときだけ置き換える（その間に持ち主が印を消し、ほかが取り直していれば初めからやり直す）。4.6 の (6) に書いた。
	- `trace-reads.js`: 包む関数の `util.promisify.custom`（`execFile` の Promise の版。元の関数を直接呼ぶ）も、記録してから呼ぶものにする（将来の潜在の経路だけの指摘の反映）。4.6 の `trace-reads.js` の行に書いた。
	- `run-units.js`: 写しのファイルの一覧と写しの変更の判定に、作業ツリーの中のシンボリックリンク（向き先の文字）を含め、入力の SHA-256 もリンクの向き先を含める（将来の潜在の経路だけの指摘の反映）。4.6 の (5) に書いた。
- Gate 2 の3回目の是正で決めた細部:
	- `run-units.js`: 作業ツリーの中に木の外を指すシンボリックリンク（絶対パスのもの、相対パスで木の外へ出るもの）があれば、写しを作らずに終了コード 2 で終わる（`outsideLinks`。将来の潜在の経路だけの指摘の反映）。4.6 の (2) に書いた。
	- 開発用のスクリプトの試験の Windows での扱い: 上の 2. のとおり（利用者の決定。Stage 4 に書いた）。
- Gate 2 の4回目の是正で決めた細部: 木の外を指すリンクの判定は、向き先を、途中のリンクをたどってから `..` を戻る形で求める（`resolveThrough`。将来の潜在の経路だけの指摘の反映）。4.6 の (2) に書いた。
- 下書きの写し: Stage 7 の当て直しの `--since` のため、Gate 2 に出す時点の2本の写しを作業用のフォルダ（`bl68/draft-g2/`）に保存した。

### 5. 変異の当て込み

- 単位（`run-units.js` で実行。単位の一覧と記録の置き場所は作業用のフォルダの `bl68/`）: スクリプトごとに、全行への自動の変異（`mutate.js --auto <スクリプト> --since <空の比較元>`。新規のファイルなので全行が変わった行）と、規則ごとの一覧の変異（`--spec`。件数は回ごとに下に書く）。試験はそのスクリプトの試験のファイルだけ。新しい試験の2ファイルの一掃（上の 1.）も同じ一覧に入れた。
- 1回目（2026-11-26 11:24〜11:33Z。一覧の変異は `run-units.js` 169件・`trace-reads.js` 50件）:
	- `trace-reads.js`: 自動の変異は59件中11件が生存、一覧の変異は50件中6件が生存。
		- 試験を加えた: `exec` の既定のシェル（自動の 139:122、一覧「launched: exec shell ignored」）、fork の `shell`（自動の 137:87）、`process.env` の記録の置き場所を変えた後の起動（一覧「inherits: compared with the current env」）、`SHARE_ENV` と options のない Worker（自動の 146:25・146:40）、`module.registerHooks` のない Node でのモジュールの読込みの記録と、記録の置き場所が消えた後の読込み（一覧「load: not recorded」「write: failures not caught」）、`appendFileSync` が `fs.openSync` を通るときに記録を書く処理を記録しないこと（自動の 43:13）。
		- 書き方を改めて、意味のない分岐を除いた: `file:` の URL の判定（自動の 56:29）、一覧と glob の options のオブジェクトの判定（自動の 84:39・87:79）、`module.registerHooks` の `file:` の判定（自動の 105:34）、Worker の `SHARE_ENV` の判定（自動の 146:75）、fork の options の有無（自動の 137:87）、包む必要のない `createReadStream`・`exists`（一覧「READ: createReadStream not wrapped」「READ: exists not wrapped」。上の 4.）。一覧の変異は、改めた行に合わせて直し、`open`・`access` を包まない変異、fork の `shell`、`SHARE_ENV` の変異を加えた。
		- 自動の 123:104（Windows の既定のシェルの `||`）は、下の等価の一覧に書いた。
	- `run-units.js`: 自動の変異と一覧の変異の2単位が、同じ時刻（11:33:11Z）に SIGKILL で止まった。`tracedProcesses` の `units && …` を `units || …` にする自動の変異が、試験の中の `run-units.js` の後始末で、`KOGAI_TRACE_UNITS` を持つすべてのプロセス、つまり外側の `run-units.js` の2つの単位のプロセスを止めたため。上の 4. の選び方の重ねを入れ、止めるプロセスの選び方を直接確かめる試験（上の 2.）と、一覧の変異（記録の置き場所の前方一致・`KOGAI_TRACE_UNITS` の文字としての照合）を加えた。
- 2回目（11:44〜12:05Z。すべての単位の入力が変わった。一覧の変異は `run-units.js` 171件・`trace-reads.js` 52件）: 一掃の2単位は合格（10回とも）。
	- `trace-reads.js`: 自動の変異は49件中1件（125:104。等価の一覧を単位に加える前の実行）、一覧の変異は52件中1件（「write: failures not caught」）が生存。この変異は、初めに書けなかったとき書込み中の印が残り、その後の行を書かなくなる。記録の置き場所が消えた試験では違いが見えないため、後からできた記録の置き場所に書き続ける試験を加えた。
	- `run-units.js`: 自動の変異は210件中17件、一覧の変異は171件中4件が生存。
		- 試験を加えた（上の 2.）: 親のない記録の置き場所（自動の 182:38）、理由に挙げる入力が5件ちょうど（359:68）、形式の違う記録（364:92・364:114・364:172。`reuse: false` も確かめる）、作業ツリーの中のリンク（415:21・519:71）、一時ディレクトリを消した単位（536:81）、0 の持ち主（598:39）、ない・ディレクトリでない `--root`（642:36、一覧「main: missing root accepted」）、写しの置き場所ごと消した単位の信号と例外（624:65・711:65）、.js の名前のディレクトリ（一覧「unitError: directory script allowed」）、ほかのパスの Node（一覧「runUnit: nodes not recorded」）、起動できない単位。
		- 書き方を改めた（上の 4.）: 実行の仕組みの SHA-256 の `tests/scripts` の外を除く条件（一覧「runnerDigest: modules outside tests/scripts included」。一覧から除いた）、作業ツリーの外の入力の判定（541:91）、記録の置き場所の持ち主の印を消すときの `force`（613:87。読めた直後に消し、消せなければ下の catch で扱う）。
		- 438:27・456:28・496:11 は、下の等価の一覧に書いた。
- 3回目（12:12〜12:34Z。すべての単位の入力が変わった。Gate 2 の1回目に出した結果）: 6単位すべて合格。自動の変異は `run-units.js` 207件・`trace-reads.js` 49件で、等価の4件のほかはすべて検出。一覧の変異は `run-units.js` 170件・`trace-reads.js` 52件で、すべて検出。一掃は2ファイルとも10回とも合格し、上限の半分を超えた試験はない（新しい試験は node:test の `timeout` を使わず、比べる上限はない）。結果の表（3回目の `summary.md`。終了コード 0）:

| 単位 | 入力の SHA-256（件数） | 結果 | 出力 |
| :--- | :--- | :--- | :--- |
| 一掃 tests/unit/dev-scripts-run-units.test.js | 23f7376a0ce4（139件。写しの全体を含む） | 合格（51秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-run-units.test.js-0ef66b8f8d64.out |
| 一掃 tests/unit/dev-scripts-trace-reads.test.js | c0810f8a7387（135件。写しの全体を含む） | 合格（11秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-trace-reads.test.js-c006804665f9.out |
| 自動の変異 tests/scripts/run-units.js | 115efdcfd963（141件。写しの全体を含む） | 合格（1266秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_run-units.js-a8d5a41aaa9a.out |
| 自動の変異 tests/scripts/trace-reads.js | 8fea7d3cd7ec（137件。写しの全体を含む） | 合格（45秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_trace-reads.js-6f28a95aafe7.out |
| 一覧の変異 run-units | c5f31b9f83d8（144件。写しの全体を含む） | 合格（1117秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/run-units-a3ed8b1621ba.out |
| 一覧の変異 trace-reads | 82cfcb1e0514（136件。写しの全体を含む） | 合格（49秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/trace-reads-a4321c1af2d6.out |

- 4回目（Gate 2 の1回目の是正の後。すべての単位の入力が変わった。3回目の表の出力のファイルは、この回の出力で上書きした）:
	- 1度目（13:18〜13:53Z）: 自動の変異の `run-units.js` 630:20（`=== → !==`。印を読めないときの ENOENT の判定）が生存した。調べると、印が壊れたリンクのときは読むたびに ENOENT になり、印の取り直しが終わらなかった。名前が残っていれば読めない印として例外にし（4.6 の (6)）、ディレクトリ・壊れたリンクの印の試験を加えた。ほかの5単位は合格（一覧の変異は `run-units.js` 185件・`trace-reads.js` 78件で、すべて検出）。
	- 2度目（13:55〜14:25Z）: 一覧の変異の `run-units.js` の単位が、変異なしの基準の実行の不合格（終了コード 1）で止まった。基準の実行は開始から約4秒で終わっていた（この試験ファイルはふだん約9秒）。`mutate.js` は基準の実行の出力を残さないので、どの試験が落ちたかは分からない（残件台帳の BL-010）。ほかの5単位は合格（自動の変異は `run-units.js` 211件・`trace-reads.js` 49件で、等価の4件のほかはすべて検出）。
		- 試験ファイルを4つ並べて5回（20回）実行しても再現しなかった。OOM による強制終了は起動以来0回だった。
		- 不合格の単位だけをやり直し（14:29Z〜。合格。一覧の変異185件をすべて検出）、同じ時間帯に、同じ試験ファイルを繰り返し実行して落ちた回の出力を残した。224回のうち1回、印の同時の引継ぎの試験で2つのプロセスが取った（`['busy', 'busy', 'busy', 'busy', 'taken', 'taken']`）。
		- 原因: 引継ぎの印を wx で作ってから中身を書いていたため、その間に読んだ別のプロセスが空の中身を終わった持ち主とみなし、空の中身の引継ぎの印を作って引き継いだ。作業用の写しで、作ってから書くまでに 50ms の待ちを入れると15回中15回で2つ以上が取り、引継ぎの印を一時のファイルのリンクとして作る形（上の 4.）では、置き換える前に 50ms の待ちを入れても15回中0回だった（待ちを入れない写しでは、負荷をかけてもどちらも80回中0回）。引継ぎの印を一時のファイルのリンクとして作る形に直し、4.6 の (6) にも書いた。
	- 3度目（2026-11-26 15:08〜15:43Z。改訂日を直した木で始め直した）: 6単位すべて合格。自動の変異は `run-units.js` 211件・`trace-reads.js` 49件で、等価の4件のほかはすべて検出。一覧の変異は `run-units.js` 185件・`trace-reads.js` 78件で、すべて検出。一掃は2ファイルとも10回とも合格。結果の表（3度目の `summary.md`。終了コード 0）:

| 単位 | 入力の SHA-256（件数） | 結果 | 出力 |
| :--- | :--- | :--- | :--- |
| 一掃 tests/unit/dev-scripts-run-units.test.js | 856c1f5052e1（139件。写しの全体を含む） | 合格（92秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-run-units.test.js-0ef66b8f8d64.out |
| 一掃 tests/unit/dev-scripts-trace-reads.test.js | 3e7ca5ea65e0（135件。写しの全体を含む） | 合格（13秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-trace-reads.test.js-c006804665f9.out |
| 自動の変異 tests/scripts/run-units.js | 3fe3a1e2243f（141件。写しの全体を含む） | 合格（1809秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_run-units.js-a8d5a41aaa9a.out |
| 自動の変異 tests/scripts/trace-reads.js | f2f65caf062d（137件。写しの全体を含む） | 合格（53秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_trace-reads.js-6f28a95aafe7.out |
| 一覧の変異 run-units | 3a961fbae87b（145件。写しの全体を含む） | 合格（1952秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/run-units-a3ed8b1621ba.out |
| 一覧の変異 trace-reads | 5f434c104379（136件。写しの全体を含む） | 合格（90秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/trace-reads-a4321c1af2d6.out |

- 5回目（Gate 2 の2回目の是正の後。すべての単位の入力が変わった）:
	- 1度目（2026-11-26 16:22〜17:01Z）: 関数を加えて行番号がずれたため、自動の変異の2単位が「等価の指定に一致する変異がない」で不合格になった（等価の一覧を今の行番号に直した）。そのほかに、自動の変異の `run-units.js` 680:21（`!== → ===`。置き換える前の読み直しで印が消えていたときのやり直し）が生存したため、読み直しの直前に印を消す試験を加えた。ほかの4単位は合格（一覧の変異は `run-units.js` 196件・`trace-reads.js` 82件で、すべて検出）。
	- 2度目（17:02〜17:41Z）: 6単位すべて合格。自動の変異は `run-units.js` 215件・`trace-reads.js` 51件で、等価の4件のほかはすべて検出。一覧の変異は `run-units.js` 196件・`trace-reads.js` 82件で、すべて検出。一掃は2ファイルとも10回とも合格。結果の表（2度目の `summary.md`。終了コード 0）:

| 単位 | 入力の SHA-256（件数） | 結果 | 出力 |
| :--- | :--- | :--- | :--- |
| 一掃 tests/unit/dev-scripts-run-units.test.js | 97b31c66a882（139件。写しの全体を含む） | 合格（91秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-run-units.test.js-0ef66b8f8d64.out |
| 一掃 tests/unit/dev-scripts-trace-reads.test.js | 53a65a159782（135件。写しの全体を含む） | 合格（13秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-trace-reads.test.js-c006804665f9.out |
| 自動の変異 tests/scripts/run-units.js | 20975ecd0c53（141件。写しの全体を含む） | 合格（2332秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_run-units.js-a8d5a41aaa9a.out |
| 自動の変異 tests/scripts/trace-reads.js | 99c698e09801（137件。写しの全体を含む） | 合格（53秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_trace-reads.js-6f28a95aafe7.out |
| 一覧の変異 run-units | 7f9607615df1（145件。写しの全体を含む） | 合格（2083秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/run-units-a3ed8b1621ba.out |
| 一覧の変異 trace-reads | a39959420aea（136件。写しの全体を含む） | 合格（91秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/trace-reads-a4321c1af2d6.out |

- 6回目（Gate 2 の3回目の是正の後。すべての単位の入力が変わった）:
	- 1度目（2026-11-26 21:55〜22:35Z）: 自動の変異の `run-units.js` 441:34（`|| → &&`。木の外を指すリンクを探すときに `node_modules`・審査の記録の下を除く条件）が生存したため、その下の木の外を指すリンクでは止めない試験を加えた。ほかの5単位は合格（一覧の変異は `run-units.js` 208件・`trace-reads.js` 83件で、すべて検出）。
	- 2度目（22:36〜23:16Z）: 6単位すべて合格。自動の変異は `run-units.js` 218件・`trace-reads.js` 51件で、等価の4件のほかはすべて検出。一覧の変異は `run-units.js` 208件・`trace-reads.js` 83件で、すべて検出。一掃は2ファイルとも10回とも合格。結果の表（2度目の `summary.md`。終了コード 0）:

| 単位 | 入力の SHA-256（件数） | 結果 | 出力 |
| :--- | :--- | :--- | :--- |
| 一掃 tests/unit/dev-scripts-run-units.test.js | f9b98a58b1b6（139件。写しの全体を含む） | 合格（92秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-run-units.test.js-0ef66b8f8d64.out |
| 一掃 tests/unit/dev-scripts-trace-reads.test.js | e763aae29904（135件。写しの全体を含む） | 合格（12秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-trace-reads.test.js-c006804665f9.out |
| 自動の変異 tests/scripts/run-units.js | 6c6792b5d582（141件。写しの全体を含む） | 合格（2329秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_run-units.js-a8d5a41aaa9a.out |
| 自動の変異 tests/scripts/trace-reads.js | 158cf9932023（137件。写しの全体を含む） | 合格（53秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_trace-reads.js-6f28a95aafe7.out |
| 一覧の変異 run-units | fef7c88ddc5f（145件。写しの全体を含む） | 合格（2188秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/run-units-a3ed8b1621ba.out |
| 一覧の変異 trace-reads | b123a268cdac（136件。写しの全体を含む） | 合格（91秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/trace-reads-a4321c1af2d6.out |

- 7回目（Gate 2 の4回目の是正の後。すべての単位の入力が変わった）:
	- 1度目（2026-11-27 00:17〜01:00Z）: 自動の変異の `run-units.js` 435:13（`|| → &&`。`resolveThrough` の空の部分と `.` を飛ばす条件）が生存した。飛ばしても飛ばさなくても結果が同じなので、等価の一覧に加えた（コードは変えない）。ほかの5単位は合格（一覧の変異は `run-units.js` 214件・`trace-reads.js` 83件で、すべて検出）。
	- 2度目（01:01〜01:42Z。等価の一覧が入力の、自動の変異の `run-units.js` の単位だけをやり直し、ほかの5単位は記録を使った）: 6単位すべて合格。自動の変異は `run-units.js` 222件・`trace-reads.js` 51件で、等価の5件のほかはすべて検出。一覧の変異は `run-units.js` 214件・`trace-reads.js` 83件で、すべて検出。一掃は2ファイルとも10回とも合格。結果の表（2度目の `summary.md`。終了コード 0）:

| 単位 | 入力の SHA-256（件数） | 結果 | 出力 |
| :--- | :--- | :--- | :--- |
| 一掃 tests/unit/dev-scripts-run-units.test.js | ea9e0de90100（139件。写しの全体を含む） | 再利用（合格 2026-11-27T00:19:27.387Z） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-run-units.test.js-0ef66b8f8d64.out |
| 一掃 tests/unit/dev-scripts-trace-reads.test.js | 3e01b31600b1（135件。写しの全体を含む） | 再利用（合格 2026-11-27T00:18:07.252Z） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_unit_dev-scripts-trace-reads.test.js-c006804665f9.out |
| 自動の変異 tests/scripts/run-units.js | c76d7e39e59b（141件。写しの全体を含む） | 合格（2453秒） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_run-units.js-a8d5a41aaa9a.out |
| 自動の変異 tests/scripts/trace-reads.js | 603cce5360e1（137件。写しの全体を含む） | 再利用（合格 2026-11-27T00:20:19.753Z） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/tests_scripts_trace-reads.js-6f28a95aafe7.out |
| 一覧の変異 run-units | f87aaaa25140（145件。写しの全体を含む） | 再利用（合格 2026-11-27T00:58:47.241Z） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/run-units-a3ed8b1621ba.out |
| 一覧の変異 trace-reads | e91876d26706（136件。写しの全体を含む） | 再利用（合格 2026-11-27T01:00:22.832Z） | /tmp/claude-1000/-home-k-workspace-kogaidocs/16a95b2d-3c34-438d-9b94-467d521a19e4/scratchpad/bl68/units/trace-reads-a4321c1af2d6.out |

- 等価とした変異（自動の変異は `--equivalents` の一覧（`bl68/specs/run-units.equivalents.json`・`trace-reads.equivalents.json`）に書いた。名前は今の行番号）:

| スクリプト | 変異 | 等価の理由 |
| :--- | :--- | :--- |
| `tests/scripts/run-units.js` | `435:13 \|\| → &&` | 区切りが続くところ・末尾の区切りの空の部分と `.` は、`path.join` でいまの場所のままになり、その実パスもいまの場所なので、飛ばしても飛ばさなくても求める実パスは同じ（`resolveThrough`） |
| `tests/scripts/run-units.js` | `506:27 \|\| → &&` | `/proc` の数字でない名前は、このプロセス自身（`self`・`thread-self`）か `environ` のないもの（読めずに除く）である。このプロセス自身の環境変数は単位の記録の置き場所を含まない（記録の置き場所は、このプロセスが起動の後に作った一時ディレクトリの中）。どちらの式でも選ぶプロセスは同じ |
| `tests/scripts/run-units.js` | 524:28 < → <= | 50回目の後も、止めるたびに記録の置き場所を持つ新しいプロセスが現れ続けるときだけ違い、そのときもどちらも止めきれない（上限は終わらない繰返しを防ぐためのもの） |
| `tests/scripts/run-units.js` | 564:11 true → false | `'exit'` と `'error'` の両方が起きるのは、起動の後に kill・IPC の送信が失敗したときで、`execute` はどちらも行わない（起動の失敗では `'error'` だけが起きることを試験で確かめる）。終わりの処理は1回だけ呼ばれる |
| `tests/scripts/trace-reads.js` | `134:104 \|\| → &&` | Windows（`process.platform === 'win32'`）でだけ評価する式で、この環境（Linux）では届かない |

## 1回目 — 要是正（Stage 4）

指摘は15件（ゲートを止める指摘12件、文書だけの指摘3件）。`finding-scope.js --from-snapshot` では、すべて差分の中（新規ファイル）で、変更外とした指摘はない。審査の途中でアプリが落ち、同じレビュワーを再開して結果を受けた（作業ツリーは変わっておらず、残ったプロセス・写しはなかった）。

ゲートを止める指摘:

- trace-reads.js:80〜83・92: 包む名前のうち、試験が使わない名前（`lstat`・`realpath`・`readlink`・`copyFile`・`openAsBlob`・`readdir`・`opendirSync`/`opendir`・`cp`・`glob`、`fs.realpath` の `native`）を1つずつ除く変異が生存する。
- trace-reads.js:136・142・116: `spawn`・`execFile`・`exec` を1つずつ除く変異と、`isNode` の正規表現の末尾の固定を外す変異が生存する。
- run-units.js:265: `mutate.js` の写しの対応で、一時ディレクトリの実パスを除く変異と `escapeRegExp` を外す変異が生存する（試験の一時ディレクトリがリンクでない）。
- dev-scripts-run-units.test.js:253: 記録の読み方の試験が、`os.tmpdir()` が実パスであることを前提にしている（一時ディレクトリがリンクを通る環境で落ちる）。
- run-units.js:92: `--root` の既定値の変異が生存する。
- run-units.js:686: 結果の表を単位が終わるたびに書き直すことを外す変異が生存する。
- run-units.js:498: 終わった単位を実行中の一覧から除く行を消す変異が生存する。
- run-units.js:456: `stopUnit` の繰返しを1回にする変異が生存する。
- run-units.js:502: 標準エラーを出力に入れない変異が生存する。
- run-units.js:566: 入力の SHA-256 の集約値を名前だけから求める変異が生存する。
- run-units.js:596・607: 持ち主の終わった印の引継ぎが原子的でなく、同時に引き継いだ2つの `run-units.js` が同じ記録の置き場所を使う。
- dev-scripts-run-units.test.js:772・489: git のない環境と `/proc` のない環境で落ちる。

文書だけの指摘（4.1 の 4.）: review100:18（Windows で除く試験の書き方が試験と合わない）、review100:65（一覧の変異の件数）、review100:13（既存の試験の一掃の結果の表がない）。

### 是正（Stage 4 に戻って直した。4.1 の 8.）

- 包む名前: 包む名前ごとに別のファイルを読む試料を加えた（上の 2.）。`fs.realpath`（コールバック）は中で呼出しの時点の `fs.lstat` を呼ぶため、`realpath` の名前は `fs.promises.realpath` で確かめる。`exec`（コールバック）は中で `execFile` を通るため包むのをやめ（上の 4.）、`spawn`・`execFile`・`exec` の試料と、名前が node で始まるだけのプログラムの試料を加えた。名前ごとの変異（`trace-reads.js` の一覧に26件）を加えた。
- `mutate.js` の写しの対応: 記録の読み方の試験で、単位の一時ディレクトリを実在するリンクにし、実パスに `+` を含めた（実パスの行が対応すること、記号をそのまま比べること）。試料の置き場所は実パスにした（一時ディレクトリがリンクを通る環境でも同じ）。
- `--root` の既定値、結果の表の書き直し、実行中の一覧、`stopUnit` の繰返し（止められると記録の置き場所を持つ sleep に置き換わる sh）、標準エラー、集約値: それぞれ試験を加え（上の 2.）、変異を一覧に加えた。
- 記録の置き場所の印: 上の 4. のとおり引継ぎを原子的にした。試験は、印の中身、自分の印だけを消すこと、引継ぎの印（動いている持ち主・終わった持ち主）、6つのプロセスの同時の引継ぎで1つだけが取ること。変異（引継ぎの印の wx・引継ぎの連鎖・中身ごとの名前・一時のファイル・乱数・自分の印だけを消すこと・0 の扱い）を一覧に加えた。
- 環境: `/proc` に依る確かめは `/proc` のある環境だけで、git に依る単位は git のある環境だけで行う。シンボリックリンクを作る試験は Windows で除く（上の 2.）。
- 文書: 上の 1. に一掃の結果の表の置き場所と事情を、上の 2. に環境による除き方を書き、上の 5. の一覧の変異の件数を回ごとに書いた。
- 是正の後の変異の当て込みは、上の 5. の4回目。

## 2回目 — 要是正（Stage 4。要是正の2回目）

指摘は12件（ゲートを止める指摘10件、将来の潜在の経路だけの指摘2件）。`finding-scope.js --from-snapshot` では、すべて差分の中（新規ファイル）で、変更外とした指摘はない。

ゲートを止める指摘:

- run-units.js:639・648: 印を読んでから持ち主を確かめるまでの間に、持ち主が印を消して終わり、ほかの run-units.js が取り直すと、読んだ中身の引継ぎの印を作れてしまい、動いている持ち主の印を置き換える。
- run-units.js:620・642: 印と引継ぎの印を中身を書いた一時のファイルのリンクとして作る規則を外す変異（wx の writeFileSync に戻す）が生存する（6つのプロセスの試験は、開いてから書くまでの短い間を偶然にしか突かない）。
- run-units.js:634・593: 読む前に印が消えたときの取り直しを外す変異と、負の数の印を持ち主とする変異が生存する。
- trace-reads.js:73・75・dev-scripts-trace-reads.test.js:73: `this` を渡さない変異と、`util.promisify.custom`（シンボルのキー）を写さない変異が生存する（試験の確かめは、包まなくなった exec を見ていた）。
- trace-reads.js:55: 相対パスの Buffer を絶対パスにしない変異が生存する。
- run-units.js:488・489: 単位に `TMP`・`TEMP` を渡さない変異が生存する。
- run-units.js:763: コマンドとしての終了コードを外す変異が生存する。
- run-units.js:190: 既にある空のディレクトリに置く印のファイルの権限を外す変異が生存する。
- dev-scripts-run-units.test.js:388・795・dev-scripts-trace-reads.test.js:36: Windows で除き漏れがある（`"` を含むファイル名、止まらない単位、リンクを作る試料）。
- dev-scripts-run-units.test.js:228・506・650: Windows で除きすぎている（リンク・信号を使う一部分のために、試験の全体を除いている）。

将来の潜在の経路だけの指摘（4.1 の 5. 検査に加えて通過の扱い）: trace-reads.js:75・136（`util.promisify(execFile)` が元の関数を直接呼び、記録を通らない）、run-units.js:340・535（作業ツリーの中のシンボリックリンクが、写しの全体の入力と写しの変更の判定に入らない）。

### 是正（Stage 4 に戻って直した。4.1 の 8.）

- 印の引継ぎ: 上の 4. のとおり、置き換える前に印を読み直す。試験は、`fs.readFileSync` を包んで、初めに読んだ直後に印を動いているプロセスのものに替える場合（例外になり置き換えない）と、読む直前に消す場合（取り直す）。負の数の印の引継ぎの試験を加えた。
- 印と引継ぎの印の作り方: 同時に取りにいく6つのプロセスに、wx の書込みを開いてから書くまでと rename の前に 50ms 待たせる補助を読み込ませ、持ち主の終わった印と印のない置き場所の両方で1つだけが取ることを確かめる（印・引継ぎの印を wx で作る変異では、中身のない印を読む間ができ、2つ以上が取る。引継ぎの印の変異は、置き換える前の読み直しでほとんど防がれるが、2つが読み直した後に続けて置き換える間が残るため、rename の前にも待たせる）。
- `this`・`util.promisify.custom`・相対パスの Buffer・`TMP`・`TEMP`・終了コード・印のファイルの権限: それぞれ試験を加えた（上の 2.）。`util.promisify.custom` は将来の経路の指摘とあわせて包むようにした（上の 4.）。
- Windows: 上の 2. のとおり、除く理由ごとに見直した。試料のリポジトリで `main` を動かす試験は、写しに `node_modules` のリンクを作るので、試験の全体を除く（除きすぎの指摘のうち 506 の試験はこれに当たる。650 の試験は印と信号に分け、印の試験は Windows でも動かす）。記録の読み方の試験（228）は、リンクの部分だけを除いた。
- 作業ツリーの中のシンボリックリンク: 上の 4. のとおり、写しの一覧・写しの変更・入力の SHA-256 に含めた。試験を加えた（上の 2.）。
- 指摘の規則を外す変異（印の読み直し・印と引継ぎの印のリンク・取り直し・負の数・`TMP`・`TEMP`・終了コード・印の権限・リンク・`this`・シンボルのプロパティ・`util.promisify.custom`・相対パスの Buffer）を一覧に加えた。
- 是正の後の変異の当て込みは、上の 5. の5回目。

## 3回目 — 要是正（Stage 4。要是正の3回目）

指摘は9件（ゲートを止める指摘7件、将来の潜在の経路だけの指摘1件、文書だけの指摘1件）。`finding-scope.js --from-snapshot` では、すべて差分の中（新規ファイル）で、変更外とした指摘はない。

ゲートを止める指摘:

- run-units.js:644・668・dev-scripts-run-units.test.js:814: 印・引継ぎの印を中身を書いた一時のファイルのリンクとして作る規則を外す変異のうち、wx の writeFileSync でない形（`copyFileSync` の `COPYFILE_EXCL`、`openSync` の wx と `writeSync`）が生存する（同時に取る試験の補助が wx の writeFileSync だけを遅らせる）。
- dev-scripts-run-units.test.js:829・run-units.js:639: 同時に取る試験が、取れなかったプロセスの例外をどれも「使っている」と数える（一時のファイルの名前を固定する変異が生存する）。
- run-units.js:676・682・dev-scripts-run-units.test.js:783: 置き換える前の読み直しで印が消えていたときに初めからやり直す規則を外す変異が生存する（試験は、その後にほかのプロセスが印を取らない）。
- trace-reads.js:66: 記録の失敗で元の処理を変えない try/catch を外す変異が生存する。
- dev-scripts-run-units.test.js:221・465・466: 権限の確かめが利用者の umask に依る（umask 077 では権限の変異5件が生存する）。
- run-units.js:222: 写しの一覧の走査で `.git`・`node_modules` を除く行を外す変異が生存する。
- dev-scripts-run-units.test.js:146・411・989・dev-scripts-trace-reads.test.js:37: Windows で除きすぎている（理由になる部分だけを分けていない）。

将来の潜在の経路だけの指摘（4.1 の 5. 検査に加えて通過の扱い）: run-units.js:438・214（作業ツリーの中の、木の外を指すシンボリックリンクは、写しの中から写しの外を指す）。

文書だけの指摘（4.1 の 4.）: review100:21（Windows で除く試験の一覧に契約の試験がなく、例外で止める試験が重なる）。

### 指摘の傾向（要是正が3回続いたため利用者に報告。4.1 の 7.）

- 指摘の数は 15件（ゲートを止める指摘12件）、12件（10件）、9件（7件）と減り、細かくなっている。
- 印の原子性の試験の検出力（1回目の是正で作り直した印の取り方）: 2回目は wx で作る形と読んだ後の取り直し、3回目は copyFile・openSync で作る形と読み直しの後の取り直しで、同じ規則を外す別の書き方が続いた。根本の原因は、競合を起こす試験の補助が特定の書き方しか遅らせないこと。
- Windows での試験の除き方: 1回目は環境で落ちる試験、2回目は除き漏れと除きすぎ、3回目は除きすぎで、3回続いた。根本の原因は、開発用のスクリプトの試験で Windows をどこまで扱うかの基準がないこと。
- 新しいコードの境界の変異（umask、記録の失敗の try/catch、写しの一覧の `node_modules`）: 回ごとに加えたコードの細部。

### 利用者の決定

- 3回目の指摘を直して、4回目の Gate 2 を受ける。
- 開発用のスクリプトの試験は POSIX を対象とし、Windows では、シンボリックリンク・シグナル・プロセスグループ・`/proc`・Windows のファイル名に使えない文字に依る試験を試験ごと除く。基準を開発プロセス定義書（Stage 4）とこの記録に書き、除き方の指摘はこの基準で判断する。

### 是正（Stage 4 に戻って直した。4.1 の 8.）

- 印・引継ぎの印の作り方: 同時に取る試験の補助を、印・引継ぎの印の名前（`run-units.lock`・`*.taken`）を書込みで開く呼出し（`openSync`・`writeFileSync`・`copyFileSync`）のすべてで、開いてから中身を書くまで 50ms 待つ形にした（rename の前の待ちも残す）。持ち主の終わった印を取った後、印とその引継ぎの印が同じファイル（`ino`）であることも確かめる。取れなかったプロセスは、例外の文言が「ほかの run-units.js（プロセス …）」のときだけを「使っている」と数え、ほかの例外は試験の失敗にする。
- 読み直しで印が消えていたとき: 読み直しで印を消し、その直後に動いているプロセスの印を置く試験を加えた（例外になり、その印が残る）。
- 記録の失敗: ホストのある `file:` の URL（記録の `fileURLToPath` が投げる）で、`existsSync` が false を返し、`fs.promises.readFile` が拒否される Promise を返すことを確かめる試験を加えた。
- umask: この試験のファイルの間は umask を 022 にする。
- 写しの一覧の `node_modules`: 写しの全体を入力とする単位の入力に `node_modules` がないことを確かめる。
- Windows: 利用者の決定の基準で、理由になる部分を含む試験を試験ごと除く形にそろえた（上の 2.。2回目の是正で部分に分けた記録の読み方の試験と印の試験も、試験ごと除く形に戻した）。
- 木の外を指すシンボリックリンク: 上の 4. のとおり誤りにし、試験を加えた（絶対パス・相対パスで木の外へ出るもの・木の中を指すもの）。
- 文書: 上の 2. の Windows で除く試験の一覧を、基準に合わせて書き直した。
- 指摘の規則を外す変異（印・引継ぎの印の copyFile・openSync の形、一時のファイルの名前、読み直しの2つの形、記録の try/catch、写しの一覧の `node_modules`、木の外を指すリンクの3つの形）を一覧に加えた。
- 是正の後の変異の当て込みは、上の 5. の6回目。

## 4回目 — 要是正（Stage 4。要是正の4回目）

指摘は5件（ゲートを止める指摘3件、将来の潜在の経路だけの指摘1件、文書だけの指摘1件）。`finding-scope.js --from-snapshot` では、すべて差分の中で、変更外とした指摘はない。

ゲートを止める指摘:

- run-units.js:668・dev-scripts-run-units.test.js:850: 印を中身を書いた一時のファイルのリンクとして作る規則を外す変異のうち、数の flags で開いて書く形が生存する（同時に取る試験の補助が flags を文字列でしか見ない）。
- run-units.js:696: たどった引継ぎの印の中身を覚える行を消す変異が生存する（自分の中身の引継ぎの印を作り、それを持ったまま終わると、次の run-units.js が引継ぎの印をたどる繰返しから出られない）。
- run-units.js:59・650: 印のファイル（`.run-units-records`）と引継ぎの印の名前を変える変異が生存する（試験が `MARKER`・`lockClaim` で比べる）。

将来の潜在の経路だけの指摘（4.1 の 5. 検査に加えて通過の扱い）: run-units.js:445（木の外を指すリンクの判定が字面で、途中のリンクを通って木の外へ出るリンクを見落とす）。

文書だけの指摘（4.1 の 4.）: development_process.md:372（(2) に、写さないものの下のリンクを除くことがない）。

### 指摘の傾向と利用者の決定（要是正が4回続いたため報告。4.1 の 7.）

- 指摘の数は 15件（ゲートを止める指摘12件）、12件（10件）、9件（7件）、5件（3件）と減った。Windows での除き方の指摘は、3回目の後の基準でなくなった。4回目のゲートを止める指摘3件は、どれも印の試験と名前の検出力の穴で、直し方が決まっている。
- 利用者の決定: 4回目の指摘を直し、Stage 4 の変異の当て込みで合格を確かめたら、Gate 2 を通過とする（「直して通過、残りは Gate 3 で」）。直した分の確かめは Gate 3 で行う。

### 是正（Stage 4 に戻って直した。4.1 の 8.）

- 印の作り方: 同時に取る試験の補助が、数の flags（`O_WRONLY`・`O_RDWR`・`O_CREAT` のビット）で開くときも待つようにした。補助が一時のファイル（`*.new`）の `ino` を覚え、取ったプロセスは、取った印がそれと同じファイルであるときだけ「取った」と出す（書き方によらず、リンクでない作り方を見つける）。
- 引継ぎの連鎖: `fs.readFileSync` を包み、初めに読んだ直後に、印を「引継ぎの印を作って取り、その後に終わった持ち主」の中身に替える試験を加えた（引き継いで取り、自分の中身の引継ぎの印を作らない）。
- 名前: 印のファイルの名前（`.run-units-records` だけを置いた置き場所を使えること）と、引継ぎの印の名前の形（`run-units.lock.<16文字>.taken`）を文字で確かめる。
- 途中のリンク: 上の 4. のとおり判定を改め、試験を加えた（`data/a/up → ../..` を通る `data/a/esc → up/../outside.txt`）。
- 文書: 4.6 の (2) に、途中のリンクをたどること、写さないものの下のリンクを除くことを書いた。
- 指摘の規則を外す変異（数の flags で作る印、たどった中身を覚えないこと、名前の2件、途中のリンクの2件）を一覧に加えた。
- 是正の後の変異の当て込みは、上の 5. の7回目。

### 判定

通過（利用者の決定により、4回目の是正と Stage 4 の7回目の合格をもって通過。直した分の確かめは Gate 3 で行う）。
