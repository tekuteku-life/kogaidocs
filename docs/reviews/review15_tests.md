# 校外委員会 先行テストスイート テスト観点網羅性レビュー報告書（第2ゲート）

**文書バージョン**: 1.0.0<br>
**実施日**: 2026年10月18日<br>
**評価担当**: 独立シニアQAリードおよびテストアーキテクト（Gemini 4 Argon）<br>
**対象テストスイート**:
- `tests/unit/app.test.js` (URLパラメータ解釈、数値エイリアス、モード指定共有、History API 同期)
- `tests/unit/district.test.js` (自治会統合パネルトグル開閉、転入統合パネルトグル開閉、名簿上下ボタン、上書き確認ダイアログ)
- `tests/unit/transfer.test.js` (提出先文言「指定された提出先」、転入者URL共有ボタン)
- `tests/unit/rep.test.js` (代表切り出し出力 exportSingleDistrictFromRep、単一地区構造 PoLP、パスワード柔軟化、多層出力チャンネル)
- `tests/integration/transfer-integration.test.js` (Pattern E: 転入者 -> 代表受入・割当 -> 代表から地区切り出し -> 地区役員受入)
- `tests/system/system-matrix.test.js` (機能20: URLパラメータ起動・モード指定共有・トグル開閉・名簿ボタン直結・カード6ジャンル別・代表切り出し配付 E2E)
- `tests/helpers/dom-mock.js` (History API / window.location モック拡張)
**参照設計文書**:
- `docs/system_design.md` (v2.5.0)
- `docs/reviews/review14_design.md` (第1ゲート レビュー指摘・是正措置 A-1 〜 A-4)
- `docs/development_process.md` (v1.2.0 Stage 5)
**評価ステージ**: Stage 5（テスト観点網羅性レビュー 第2ゲート）<br>
**総合判定**: **条件付き合格（CONDITIONAL PASS / 是正措置反映後のStage 6移行承認）**

---

## 目次
1. [エグゼクティブサマリー](#1-エグゼクティブサマリー)
2. [ユーザー要求（7項目）のテスト観点充足性評価（レビュー観点1）](#2-ユーザー要求7項目のテスト観点充足性評価レビュー観点1)
3. [設計レビュー指摘（A-1 〜 A-4）のテスト充足度評価（レビュー観点2）](#3-設計レビュー指摘a-1--a-4のテスト充足度評価レビュー観点2)
4. [境界値・異常系・非対応環境のテスト網羅性監査（レビュー観点3）](#4-境界値異常系非対応環境のテスト網羅性監査レビュー観点3)
5. [テストコード品質・規約遵守・テストハーネス整合性監査（レビュー観点4）](#5-テストコード品質規約遵守テストハーネス整合性監査レビュー観点4)
6. [テストスイート是正措置（アクションアイテム T-1 〜 T-5）](#6-テストスイート是正措置アクションアイテム-t-1--t-5)
7. [総合判定・実装フェーズ（Stage 6）への申し送り事項](#7-総合判定実装フェーズstage-6への申し送り事項)

---

## 1. エグゼクティブサマリー

### 1.1 レビューの背景と目的
本報告書は、`kogaidocs 開発プロセス定義書 (v1.2.0)` の **Stage 5: テスト観点網羅性レビュー（第2ゲート）** に基づき、独立したシニアQAリードおよびテストアーキテクトの観点から、先行実装されたテストスイート群を対象に実施したテスト仕様・観点網羅性の監査結果を取りまとめたものである。

本改修（v2.5.0）は、ユーザーから提起された7項目の重要課題・機能改善要求（自治会統合ボタンの動作改善、自治会名簿の「＋ 行を追加」ボタン適正配置、児童名簿の「並び替え」「児童の追加」適正配置と転入パネルのトグル化、地区保存・読込・年度更新カードのジャンル別4大セクション整理、転入者モードの提出先文言柔軟化、URLパラメータによるモード直接起動＆モード指定URL共有、転入者フローの確立と代表モードからの地区データ切り出し出力機能）に対し、TDD（テスト駆動開発）原則に則り、本線実装（Stage 6）に先立って単体・結合・システムテストが作成された。

本レビューでは、これらのテストコードが設計仕様（v2.5.0）および第1ゲート設計レビュー指摘事項（A-1 〜 A-4）を漏れなく捉えられているか、境界値・異常系・非対応環境の防壁が構築されているか、テストハーネス自体が健全に機能しているかを厳格に検証した。

### 1.2 評価の結論とハイライト
先行実装されたテストスイート群は、要求された主要新機能を広範にカバーしており、特に代表モードからの地区切り出し出力（Split-Export）における単一地区オブジェクト抽出・他地区情報排除（PoLP検証）や、Pattern E による「転入家庭 → 代表受入・地区割当 → 代表から特定地区切り出し配付 → 地区役員側での復号受入」という双方向データ連携パイプラインの結合テストなど、極めて実効性の高い優れたテストケースが整備されている。

TDDサイクルとしての初期テスト実行（`npm test`）においても、既存テストの健全性を維持しつつ新規機能部分が綺麗に Red（失敗）となっており、テスト駆動開発の前提条件が満たされていることを確認した。

特に高く評価できるテスト設計ハイライトは以下の通りである：
1. **最小権限の原則（PoLP）と完全互換復号の厳密な単体テスト (`tests/unit/rep.test.js`)**:
	- `exportSingleDistrictFromRep` により出力された暗号文を復号し、対象地区（`district`, `hanList`, `officers`, `neighborhood`, `students`）のみが含まれ、他地区データや代表固有メタデータ（`szExternals`, `seatConfig` 等）が一切混入していないことをアサート。
	- 多層出力チャンネル（ダウンロード、クリップボードコピー、LINE、メール）を網羅。
2. **完全な双方向配付パイプラインの結合テスト (`tests/integration/transfer-integration.test.js` Pattern E)**:
	- 転入家庭が作成した暗号化ファイルを校外代表が取り込んで地区・班を割り当て、そこから切り出された単一地区ファイルを地区役員が自端末で読み込んで名簿に統合する一連のデータフローを完全自動テスト化。
3. **URLパラメータ解釈と History API 同期の網羅的テスト (`tests/unit/app.test.js`)**:
	- `?mode=transfer|rep|neighbor|district`、数値エイリアス `1〜4`、スクリプト混入（XSS攻撃）等の不正値フォールバック、モード指定URL共有、および `switchTab` 実行時の `history.replaceState` 呼び出しを網羅。

一方で、テスト精査の結果、以下の重大な不備・抜け漏れを検出した：
- **[重大な漏れ] 要求④（カード6 ジャンル別4大セクション）のテストが完全欠落**:
	- `tests/system/system-matrix.test.js:971` のタイトルに「ジャンル別カード6」と記載されているにもかかわらず、テスト関数内部にカード6に関するアサーションが1行も存在しない。
	- `tests/unit/district.test.js` にも、カード6の4大セクション構造やボタン群の動作を検証する単体テストが存在しない。
- **[テスト記述バグ] `rep.test.js` におけるフィクスチャ不整合によるテスト失敗（False Negative）**:
	- `createMockRepState()` は3地区（緑が丘 A班、緑が丘 B班、青葉台 1班）を返すが、テストコード内で `state.repState.districts.length === 2` や地区名 `'1丁目'` を期待しており、実装前にテストコード自体の前提が破綻している。
- **[不整合・検証不足] 児童名簿並び替えテストの関数名不整合および内容検証の欠落**:
	- `districtLib.sortStudents()` を呼び出しているが、既存実装およびHTML上の関数名は `sortStudentsDesc()` である。また、アサーションが配列長のみで、肝心のソート順序（班長・副班長 → 学年降順 → 住所五十音順）が検証されていない。
- **[DOM検証不足] 名簿上下「行を追加」「児童を追加」ボタンのマークアップ検証欠落**:
	- 単に JS 関数を呼んでいるだけで、テーブル直前ツールバーおよびテーブル直下フッターにボタンが配置されているかのDOM検証がない。

したがって、総合判定は **「条件付き合格（CONDITIONAL PASS / 是正措置反映後のStage 6移行承認）」** とする。

---

## 2. ユーザー要求（7項目）のテスト観点充足性評価（レビュー観点1）

ユーザーから提起された7大要求に対するテスト観点の網羅性・妥当性を詳細に精査した。

| 要求項目 | テストファイル・対象テスト名 | テスト観点充足性評価 | 判定 |
| :--- | :--- | :--- | :---: |
| **① 自治会データ統合ボタンの動作改善** | `tests/unit/district.test.js`<br/>`openNeighborImportPanel toggles panel, updates label, and sets aria-expanded` | ・初期非表示（`display: none`）状態からの展開確認。<br/>・1回目押下で `display: block`、ラベル「▲ 閉じる」、`aria-expanded="true"`。<br/>・2回目押下で `display: none`、ラベル「▼」、`aria-expanded="false"` のトグル動作を的確にアサート。 | **適合** |
| **② 自治会役員名簿の「＋ 行を追加」配置** | `tests/unit/district.test.js`<br/>`top and bottom buttons for neighborhood and student rosters trigger correct actions` | ・`addNeighborhoodRow()` が2回実行され行数が増加することを確認。<br/>・ただし、DOM上に上部ツールバーボタン・下部フッターボタンが存在しバインドされているかのマークアップ検証が欠落している（アクションアイテム T-4）。 | **一部要改善** |
| **③ 児童名簿の「並び替え」「児童の追加」配置** | `tests/unit/district.test.js`<br/>`toggleTransferImportPanel...`<br/>`top and bottom buttons...` | ・転入パネルのトグル開閉（`display: none` ⇄ `block`、ラベル、ARIA）は適合。<br/>・児童追加上下ボタンの動作も確認。<br/>・しかし、並び替え関数名が `sortStudents` となっており既存 `sortStudentsDesc` と不整合。またソート結果の順序検証が欠落（アクションアイテム T-3）。 | **一部要改善** |
| **④ カード6のジャンル別4大セクション整理** | なし（`tests/system/system-matrix.test.js` にタイトルのみ存在） | ・設計書に明記されているカード6の4大セクション（①パスワード設定・記憶、②保存・共有、③読込・復元、④年度更新）に関するDOM構造検証およびボタン動作検証が完全に欠落している（アクションアイテム T-1）。 | **不適合（要追加）** |
| **⑤ 転入者モードの文言柔軟化** | `tests/unit/transfer.test.js`<br/>`submission destination wording uses designated submission target` | ・HTML内の提出先文言に「指定された提出先」が含まれ、旧文言「校外委員会の地区役員・代表役員へ」が含まれないことを正規表現で確実に検証。<br/>・転入者用URL共有ボタン（`shareTransferAppUrl`）の動作も適合。 | **適合** |
| **⑥ URLパラメータ直接起動＆共有** | `tests/unit/app.test.js`<br/>`URL parameter direct mode selection and numeric aliases...`<br/>`shareAppUrl supports specificMode...` | ・全4モード名（`transfer`, `rep`, `neighbor`, `district`）および数値エイリアス（`4`, `3`, `2`, `1`）の直接起動。<br/>・XSS文字列混入時の安全なフォールバック。<br/>・モード指定共有URLの生成とクリップボード退避。<br/>・History API 同期（A-2）を網羅。 | **適合** |
| **⑦ 転入者フロー確立と代表切り出し出力（Split-Export）** | `tests/unit/rep.test.js`<br/>`tests/integration/transfer-integration.test.js` (Pattern E) | ・単一地区オブジェクト抽出、他地区データ混入防止（PoLP）、多層出力（保存・LINE・メール・コピー）、地区役員受入完全互換を網羅。<br/>・Pattern E 結合テストで双方向連携を完全立証。<br/>・ただし、`rep.test.js` のテストデータ前提にフィクスチャ不一致バグが存在（アクションアイテム T-2）。 | **条件付き適合** |

---

## 3. 設計レビュー指摘（A-1 〜 A-4）のテスト充足度評価（レビュー観点2）

第1ゲート設計レビュー報告書（`review14_design.md`）で規定された是正措置（アクションアイテム A-1 〜 A-4）のテスト充足度を検証した。

### 3.1 A-1: 代表切り出し出力（Split-Export）時の暗号化パスワード入力・指定UXの柔軟化
- **設計要件**:
	- `exportSingleDistrictFromRep(index, pass, channel)` において、引数パスワードの利用、引数なし時のプロンプト起動、およびプロンプトキャンセル時の中断処理をサポートすること。
- **テスト充足状況 (`tests/unit/rep.test.js`)**:
	- 引数でパスワードが渡された場合の正常暗号化出力（963行目）を検証。
	- 引数が渡されず `#rep-pass` が空の場合に `global.prompt` が起動され、入力されたパスワードで暗号化されること（1003行目）を検証。
	- `global.prompt` でキャンセル（`null`）された場合に `false` を返し安全に中断されること（1013行目）を検証。
- **評価**: **適合**。A-1 のコア要件を完全に網羅している。

### 3.2 A-2: URLパラメータによるモード起動後のブラウザ履歴（History API）同期
- **設計要件**:
	- `switchTab(mode)` 呼び出し時に、`window.history.replaceState` を呼び出して現在のアドレスバーと表示中モードを整合させること。
	- `shareAppUrl(specificMode)` において、指定されたモードに応じた決定論的なURLを生成すること。
- **テスト充足状況 (`tests/unit/app.test.js`)**:
	- `switchTab('rep')` および `switchTab('transfer')` 実行時に `window.history.replaceState` が呼ばれ、URLに `mode=rep` / `mode=transfer` が反映されることを検証（784行目）。
	- `shareAppUrl('transfer')` 実行時に共有URLに `?mode=transfer` が含まれることを検証（801行目）。
- **評価**: **適合**。History API の呼び出しとURL整合性が確実にアサートされている。

### 3.3 A-3: 自治会・転入トグルパネルのARIAアクセシビリティと開閉ラベル連動
- **設計要件**:
	- 自治会統合パネルおよび転入児童取り込みパネルのトグルボタンにおいて、開閉状態に応じてラベルテキストを動的に反転（「▼」⇄「▲ 閉じる」）し、`aria-expanded="false"` / `"true"` を同期更新すること。
- **テスト充足状況 (`tests/unit/district.test.js`)**:
	- `openNeighborImportPanel`: 展開時に `btn.textContent` に「▲」または「閉じる」が含まれ、`aria-expanded="true"` となること、再押下（格納）時に「▼」となり `aria-expanded="false"` となることを検証（740行目）。
	- `toggleTransferImportPanel`: 同様に展開時・格納時のラベル連動および `aria-expanded` 属性を検証（902行目）。
- **評価**: **優良**。アクセシビリティ要件とトグルUXの双方が厳密にアサートされている。

### 3.4 A-4: 地区役員側での切り出しデータ受入時における未保存データ上書き防止確認
- **設計要件**:
	- 地区役員モード（タブ①）でファイル読み込み（`loadDistrictTxt`）を実行する際、既に編集中の児童名簿や役員情報が存在する場合は、上書き確認ダイアログ（`confirm`）を表示して作業消失を防止すること。
- **テスト充足状況 (`tests/unit/district.test.js`)**:
	- 既存児童データが存在する状態でファイルを読み込んだ際、`global.confirm` が呼び出され、確認メッセージに「上書き」が含まれることを検証（957行目）。
	- ユーザーがキャンセル（`return false`）した場合に既存児童データが保護・維持されることを検証。
	- ユーザーが承認（`return true`）した場合に新しいファイル内容で上書きされることを検証。
- **評価**: **適合**。トランザクション保護のキャンセル・OK両分岐を網羅している。

---

## 4. 境界値・異常系・非対応環境のテスト網羅性監査（レビュー観点3）

システムの堅牢性と耐障害性を担保するための境界値・異常系テストの網羅性を評価した。

### 4.1 URLパラメータ解釈の耐障害性と境界値
- **現状の網羅状況**:
	- `?mode=invalid_hack<script>` のような不正文字列、XSSインジェクション文字列が渡された場合、ホワイトリストにより安全に除外され、直前の `localStorage` 保存モードまたはデフォルトモード（`district`）へフォールバックされることが検証されている（`tests/unit/app.test.js:771`）。
- **不足・改善推奨観点**:
	- 大文字小文字の混在（例: `?mode=TRANSFER`、`?mode=Transfer`）や、クエリ前後の空白（例: `?mode=%20district%20`）が渡された場合の正規化（サニタイズ処理）に関するテストケースが不足している。実運用ではLINEやメールの自動リンク機能により大文字や余分な文字が付与されるケースがあるため、正規化処理のテストがあるとさらに堅牢となる。

### 4.2 History API 非対応ブラウザおよび例外スロー時の保護
- **現状の網羅状況**:
	- `dom-mock.js` 上に `window.history.replaceState` がモックされ、呼び出しが検証されている。
- **不足・改善推奨観点**:
	- iframe内での動作や特定の制限付きブラウザ環境（iOS WebKit の一部設定など）において `replaceState` が `SecurityError` や例外をスローした場合、あるいは `window.history` 自体が存在しない環境において、タブ切り替え処理全体が例外でクラッシュしないための try-catch 保護（異常系耐障害性テスト）が未定義である。

### 4.3 地区ファイル読み込み時における空データ時のUX境界値
- **現状の網羅状況**:
	- 既存データが存在する場合の上書き確認（キャンセル・OK）は検証されている。
- **不足・改善推奨観点**:
	- 地区役員が新規作成直後やリセット後など、「まだ何もデータが入力されていない空の地区状態（児童数0件、役員未入力）」でファイルを読み込む場合、不要な確認ダイアログ（confirm）を出さずにスムーズに読み込まれるべきである（UX要件）。この「空データ時は confirm が呼び出されないこと」の境界値テストが不足している（アクションアイテム T-5）。

### 4.4 代表切り出し出力におけるパスワード境界値・キャンセル処理
- **現状の網羅状況**:
	- プロンプトでキャンセル（`null`）された場合の中断（返り値 `false`）および無効な地区インデックス（`999`）が渡された場合の中断（`false`）は網羅されている（`tests/unit/rep.test.js:1013-1019`）。
- **不足・改善推奨観点**:
	- プロンプト入力で12文字未満のパスワードが入力された場合のバリデーション（再入力またはエラー通知）の挙動に関するテストケースを追加することが推奨される。

---

## 5. テストコード品質・規約遵守・テストハーネス整合性監査（レビュー観点4）

テストコード自体の品質、プロジェクト規約遵守、およびテストハーネスの整合性を精査した。

### 5.1 インデント規約および末尾空白の検証
プロジェクト規約（全行タブインデント `\t` 徹底、不要な空行末尾空白ゼロ）に対する機械的監査を実施した：
- **末尾空白（Trailing Whitespace）**:
	- 対象テストファイル（`app.test.js`, `district.test.js`, `transfer.test.js`, `rep.test.js`, `transfer-integration.test.js`, `system-matrix.test.js`, `dom-mock.js`）を走査した結果、末尾空白エラーは **ゼロ（0箇所）**。
- **スペースインデント混在**:
	- コメント行・コード行を含め行頭スペースインデントを走査した結果、不正規なスペースインデントは **ゼロ（0箇所）** であり、完全なタブインデント（`\t`）で統一されていることを確認した。

### 5.2 テストハーネス・フィクスチャ整合性の詳細分析（重大検出事項）
`tests/unit/rep.test.js:947` のテストケースにおいて、使用しているフィクスチャ関数とテストコードのアサーションに重大な不整合を検出した：

```javascript
// tests/unit/rep.test.js:947
test('rep: exportSingleDistrictFromRep extracts single district with deep clone, PoLP security, and password flexibility (Action Item A-1)', async () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	// 2地区存在することを確認
	assert.strictEqual(state.repState.districts.length, 2); // ✖ 実際は 3地区返される
	const targetDistrict = state.repState.districts[0]; // コメント: 1丁目、実際は '緑が丘'
	const pass = 'SplitExportPass123!';
	...
	const resDownload = await rep.exportSingleDistrictFromRep(0, pass, 'download');
	assert.strictEqual(resDownload, true);
	assert(downloadedFileName.includes('1丁目')); // ✖ 実際は '緑が丘'
	...
	assert.strictEqual(parsedData.district, '1丁目'); // ✖ 実際は '緑が丘'
```

- **不整合の原因**:
	- `tests/helpers/fixtures.js:131` の `createMockRepState()` は、デフォルトで `d1` (緑が丘 A班), `d2` (緑が丘 B班), `d3` (青葉台 1班) の **3地区** を生成して返却する。
	- にもかかわらず、テスト作成者が手動モック（東地区/西地区等）と混同し、`state.repState.districts.length === 2` および地区名 `'1丁目'` をアサートしている。
- **影響**:
	- この不整合により、Stage 6 実装者が正しく `exportSingleDistrictFromRep` を実装しても、テストコード自体の前提不一致によりテストが失敗する（False Negative）。
- **是正策**:
	- テスト側で明示的に2地区（1丁目、2丁目）のStateオブジェクトを設定するか、またはフィクスチャの定義（3地区、地区名 `'緑が丘'`）にアサーションを修正する必要がある（アクションアイテム T-2）。

### 5.3 児童名簿並び替え関数の命名整合性
- `tests/unit/district.test.js:953` において `districtLib.sortStudents()` を呼び出している。
- しかし、既存の `js/district.js`（321行目、823行目）および `index.html`（147行目）では、関数名は一貫して `sortStudentsDesc` である。
- このままでは未定義関数エラー（`TypeError: districtLib.sortStudents is not a function`）となり、既存コードおよびUIとの整合性が崩れる。
- 是正策として、テスト側を `districtLib.sortStudentsDesc` に修正するか、または `js/district.js` 側で `sortStudents` をエイリアスとしてエクスポートする仕様を合意・明記する必要がある（アクションアイテム T-3）。

---

## 6. テストスイート是正措置（アクションアイテム T-1 〜 T-5）

本レビューで検出された課題・不備を解消するため、Stage 6（実装フェーズ）への移行前にテストスイートに対して講ずべき是正措置（T-1 〜 T-5）を策定した。

### T-1: カード6（ジャンル別4大セクション）の構成およびボタン群動作テストの追加
- **対象**: `tests/unit/district.test.js` および `tests/system/system-matrix.test.js`
- **内容**:
	- カード6（`#card-d-file`）内部に以下の4大セクションが存在することをDOM検証するテストを追加する：
		1. パスワード設定・端末記憶セクション（`#d-pass`, `#d-pass-confirm`, `#d-save-password-optin`）
		2. 地区データ保存・出力・外部共有セクション（保存ボタン、LINE共有、メール送信、テキストコピー、Web Share）
		3. 地区データ読み込み・復元セクション（ファイル読み込み `#d-file-in`、貼付読み込み）
		4. 新年度更新セクション（`#btn-district-rollover` 等）
	- 各セクション内の主要ボタンのクリックイベントが正常に発火することを検証する単体テストを追加する。

### T-2: `rep.test.js` におけるフィクスチャ不一致バグの解消
- **対象**: `tests/unit/rep.test.js` (947行目〜)
- **内容**:
	- `state.repState = createMockRepState();` のフィクスチャ（3地区、先頭地区名: `'緑が丘'`）に合わせ、アサーションを修正する：
		- `assert.strictEqual(state.repState.districts.length, 3);`
		- `assert(downloadedFileName.includes('緑が丘'));`
		- `assert.strictEqual(parsedData.district, '緑が丘');`
		- `assert.strictEqual(JSON.parse(decrypted2).district, '緑が丘');`
	- または、テスト内で独立した2地区（`1丁目`, `2丁目`）の `repState` を明示的に設定する形に変更する。

### T-3: 児童名簿並び替えテストの関数名整合および順序検証精緻化
- **対象**: `tests/unit/district.test.js` (953行目)
- **内容**:
	- 呼び出し関数名を既存コード・HTMLと一致する `districtLib.sortStudentsDesc()`（または両対応エイリアス）とする。
	- アサーションにおいて配列長のみをチェックするのではなく、ソート実行後に児童が「①班長 → ②学年降順（6年→1年） → ③住所五十音順」で正しくソートされていることを具体的にアサートする。

### T-4: 自治会名簿および児童名簿における上下ボタン（ツールバー＆フッター）のDOM配置検証追加
- **対象**: `tests/unit/district.test.js`
- **内容**:
	- 自治会役員名簿テーブル（`#neighborhood-table`）の上部ツールバーボタン（`#btn-add-neighbor-top`）および下部フッターボタン（`#btn-add-neighbor-bottom`）がDOM上に存在し、クリック時に `addNeighborhoodRow()` が呼び出されることを検証する。
	- 児童名簿テーブル（`#student-table`）の上部ツールバーボタン（並び替え・児童追加）および下部フッターボタン（児童追加）がDOM上に存在し、クリック時に正しく動作することを検証する。

### T-5: 空データ受入時における不要な上書き確認（confirm）抑止テストの追加
- **対象**: `tests/unit/district.test.js` (957行目付近)
- **内容**:
	- 児童名簿・役員名簿が完全に空（初期状態）の地区において `loadDistrictTxt` を呼び出した際、`global.confirm` が呼び出されることなく（`confirmCalled === false`）、直接データが読み込まれることを検証する正常系境界値テストを追加する。

---

## 7. 総合判定・実装フェーズ（Stage 6）への申し送り事項

### 7.1 総合判定
**条件付き合格（CONDITIONAL PASS / 是正措置反映後のStage 6移行承認）**

- **判定理由**:
	先行実装されたテストスイート群は、代表切り出し出力（Split-Export）の暗号学的安全境界（PoLP）、多層出力チャンネル、Pattern E 結合テスト、URLパラメータ解釈、トグル開閉ARIAアクセシビリティなど、極めて高度で網羅的なテストケースを策定しており、全体として高いテストアーキテクチャ品質を備えている。
	しかしながら、要求④（カード6の4大セクション整理）のテスト完全欠落、`rep.test.js` のフィクスチャ不一致によるテスト記述バグ、並び替え関数名の不整合など、実装フェーズにそのまま持ち込むと偽陰性や検証漏れを引き起こす重大な欠陥が認められた。
	上記アクションアイテム（T-1 〜 T-5）をテストコードに反映・是正した上で、直ちに本線実装（Stage 6）へ移行することを条件として、第2ゲートの条件付き合格を承認する。

### 7.2 実装フェーズ（Stage 6）への申し送り事項
1. **テストコード是正の先行反映**:
	- Stage 6 の本格的なプロダクションコード変更に着手する前に、まずアクションアイテム T-1 〜 T-5 をテストファイル群（`tests/unit/district.test.js`, `tests/unit/rep.test.js`, `tests/system/system-matrix.test.js`）へ適用すること。
2. **プロダクションコード実装の遵守点**:
	- `index.html`:
		- 自治会統合パネル（`#d-neighbor-import-panel`）および転入児童取り込みパネル（`#d-transfer-import-panel`）に `style="display:none;"` を明示。
		- 自治会・児童名簿テーブルの上部ツールバーおよび下部フッターにボタンを配置（HTMLマークアップ）。
		- カード6（`#card-d-file`）を4大セクション（パスワード設定・端末記憶、保存・外部共有、読み込み・復元、新年度更新）に明確に構造化。
		- 転入者画面の文言を「指定された提出先へご提出ください。」に更新し、共有ボタンを配置。
		- 代表集約一覧テーブル（`#rep-districts-table`）に「📤 切り出し」ボタンを設置。
	- `js/app.js`:
		- `restoreActiveMode`: URLパラメータ `?mode=`（文字列および数値 `1〜4`）の解釈とホワイトリスト検証。
		- `switchTab`: タブ切り替え時の `window.history.replaceState` によるURL同期（例外防護付き）。
		- `shareAppUrl`: 引数 `specificMode` を優先したURL生成。
	- `js/district.js`:
		- `openNeighborImportPanel` / `toggleTransferImportPanel`: トグル開閉制御、ボタンラベル動的反転、`aria-expanded` 更新。
		- `loadDistrictTxt`: 既存データ存在時の上書き確認ダイアログ（`confirm`）表示、空データ時のスムーズな読み込み。
		- `sortStudentsDesc`（および `sortStudents` エイリアス）: 児童名簿ソートの安定動作。
	- `js/rep.js`:
		- `exportSingleDistrictFromRep(index, pass, channel)`: 単一地区オブジェクト抽出（ディープクローン・PoLP徹底）、パスワード柔軟化、多層出力（ファイル、コピー、LINE、メール）。
3. **Stage 7 最終監査基準**:
	- `npm test`（`node --test --experimental-test-coverage tests/unit/*.test.js tests/integration/*.test.js tests/system/*.test.js`）の全件グリーン（100%パス）。
	- コード規約（全行タブインデント `\t`、末尾空白ゼロ）の完全遵守。
