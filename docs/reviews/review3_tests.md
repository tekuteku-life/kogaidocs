# 校外委員会 テスト観点網羅性レビュー報告書 (第2ゲート)

**文書バージョン**: 1.0.0<br>
**実施日**: 2026年10月17日<br>
**評価担当**: 独立シニアQAリードおよびテストアーキテクト（Gemini 4 Argon）<br>
**対象テストスイート**:
- `tests/unit/app.test.js`
- `tests/unit/utils.test.js`
- `tests/unit/district.test.js`
- `tests/unit/state.test.js`
- `tests/unit/neighbor.test.js`
- `tests/system/system-matrix.test.js`
- `tests/helpers/dom-mock.js`
- その他 `tests/` 配下の全テストスイート

**評価基準文書**:
- `docs/system_design.md` (v2.2.0)
- `docs/reviews/review2_design.md` (設計レビュー指摘事項 A-1 〜 A-5)
- `docs/development_process.md` (v1.0.0 Stage 5)

**総合判定**: **合格（PASS / Stage 6 本線実装フェーズ移行承認）**

---

## 目次
1. [エグゼクティブサマリー](#1-エグゼクティブサマリー)
2. [ユーザー要求（6項目）のテスト観点充足性評価](#2-ユーザー要求6項目のテスト観点充足性評価)
3. [境界値・異常系・非対応環境の検証網羅性評価](#3-境界値異常系非対応環境の検証網羅性評価)
4. [設計レビュー指摘事項（A-1 〜 A-5）の反映確認](#4-設計レビュー指摘事項a-1--a-5の反映確認)
5. [テストコード品質・規約遵守状況検証](#5-テストコード品質規約遵守状況検証)
6. [本線実装フェーズ（Stage 6）への申し送り事項](#6-本線実装フェーズstage-6への申し送り事項)
7. [総合判定・次期ステージへの移行承認](#7-総合判定次期ステージへの移行承認)

---

## 1. エグゼクティブサマリー

本報告書は、`kogaidocs 開発プロセス定義書 (v1.0.0)` の **Stage 5: テスト観点網羅性レビュー（第2ゲート）** に基づき、独立したシニアQAリードおよびテストアーキテクトの立場から、Stage 4 で実装されたテストスイート（`tests/`）を対象に実施したテスト観点網羅性・堅牢性検証の結果をまとめたものである。

### 1.1 レビューの結論
Stage 4 で拡張・実装されたテストスイートは、ユーザーから提示された6項目の機能拡張・UX改善要求および Stage 3 設計レビューにおける改善提言（A-1 〜 A-5）を完璧にカバーしている。

テストはTDD（テスト駆動開発）の原則に従い、未実装のプロダクションコードに対して期待通り厳格に失敗（Red）しており、アサーションの論理構造そのものが Stage 6 実装における極めて精密な要求仕様書として機能している。

外部npm依存ゼロ（Zero External Dependencies）を堅持し、Node.js 組み込みのテストランナー（`node:test`）、アサーション（`node:assert`）、Web Cryptography API のみを用いて書かれており、サプライチェーンリスクの排除と再現性を高度に両立している。

以上の評価に基づき、第2ゲートの総合判定を **「合格（PASS / Stage 6 本線実装フェーズ移行承認）」** とする。

---

## 2. ユーザー要求（6項目）のテスト観点充足性評価

改訂されたシステム設計書（v2.2.0）およびユーザー要求の6項目に対するテストケースの網羅性を精査した。

| No | ユーザー要求項目 | 対象テストファイル | 検証シナリオ・観点 | 充足性判定 |
| :---: | :--- | :--- | :--- | :---: |
| **①** | **モード選択肢の動的折りたたみUX** | `tests/unit/app.test.js`<br/>`tests/system/system-matrix.test.js` | ・初期描画時: `#mode-tab-buttons` 表示（flex）、`#mode-active-badge` 非表示（none）。<br/>・モード選択時: `switchTab` 実行に伴いボタン群が自動非表示（none）となり、アクティブモード名称（例: `① 各地区役員モード ▼ [モード切替]`）を含むバッジが表示（inline-flex）される。<br/>・再展開トグル: バッジクリック（`toggleModeSelector`）によりボタン群が即座に再展開され、バッジが非表示となる。<br/>・巡回性: 代表（rep）→ 自治会（neighbor）→ 地区（district）の各タブ切り替えにおいて一貫して自動折りたたみが機能する。 | **完全充足 (100%)** |
| **②** | **PWAアプリ共有ボタン** | `tests/unit/app.test.js`<br/>`tests/system/system-matrix.test.js` | ・ネイティブ共有成功: `navigator.share` が利用可能な場合、タイトル（校外委員会）と現在URLを正しく渡して解決する。<br/>・ユーザーキャンセル（`AbortError`）: ユーザーが共有シートを閉じた際、エラーアラートを出さず静かに復帰する（サイレントキャッチ）。<br/>・クリップボードフォールバック: `navigator.share` が例外を投げた場合、または非対応環境において `navigator.clipboard.writeText` へ自動フォールバックし、通知アラートを表示。<br/>・プロンプトフォールバック: クリップボード権限拒絶時、`global.prompt` による手動コピー支援ダイアログが起動する。 | **完全充足 (100%)** |
| **③** | **地区データ共有連携** | `tests/unit/district.test.js`<br/>`tests/system/system-matrix.test.js` | ・バリデーション: パスワード不一致時の共有処理即時中断。<br/>・ネイティブファイル共有: `channel === 'share'` で `navigator.share` による `.txt` ファイル共有。<br/>・暗号化テキストコピー: `channel === 'copy'` で `BEGIN_DATA:` を含む暗号化テキストをクリップボードへ格納。<br/>・LINE共有・メーラー連携: `channel === 'line'` / `'email'` において、通常サイズ（<= 2000文字）時のURLクエリ埋め込み。<br/>・**大容量URLフォールバック（A-1）**: 児童50〜60名の暗号文（> 2000文字）において、URLへの暗号文埋め込みを抑止し、クリップボード退避＋定型文起動へ自動切替される。 | **完全充足 (100%)** |
| **④** | **地区データ保存・読込パスワードの安全記憶ライフサイクル** | `tests/unit/district.test.js`<br/>`tests/unit/state.test.js`<br/>`tests/system/system-matrix.test.js` | ・オプトイン記憶: 端末暗号化有効かつチェックボックスON時、`currentDistrict.savedFilePassword` に保持。<br/>・**未暗号化ストレージ時の安全抑止（A-2）**: 未暗号化ストレージ環境では、チェック状態に関わらず `state.saveDistrictLocal()` が `savedFilePassword` を強制削除（平文保存ゼロ）。<br/>・フォーム復元: 記憶パスワードが存在する場合、`renderDistrictForm()` でパスワード欄2箇所（`#d-pass`, `#d-pass-confirm`）に自動補完されチェックボックスON。<br/>・即時ロック時の完全破棄: `handleImmediateLock()` 実行時、メモリ（State）およびDOM入力欄からパスワードを即時消去。<br/>・年度更新時の完全破棄: `runDistrictYearUpdate()` 実行時、記憶パスワードおよびDOMを初期化。 | **完全充足 (100%)** |
| **⑤** | **パスワード可視化時の全角自動サニタイズ** | `tests/unit/utils.test.js`<br/>`tests/system/system-matrix.test.js` | ・全角ASCII変換: 全角英数記号（`Ｐａｓｓｗｏｒｄ１２３！＠＃`）を半角ASCII（`Password123!@#`）へ自動変換。<br/>・全角空白・日本語除去: 全角スペース（`　`）およびひらがな・漢字を完全排除。<br/>・**キャレット位置追従補正（A-3）**: 文字除去に伴うカーソル飛びを防ぎ、カーソルより前で除去された文字数分だけ `selectionStart` / `selectionEnd` を正確にシフト。<br/>・半角文字列保持: 正常な半角入力時は文字列・キャレットともに無変更を維持。<br/>・境界値: `null`、空文字 `""`、`selectionStart` 欠落オブジェクトに対する安全ハンドリング。 | **完全充足 (100%)** |
| **⑥** | **自治会モードにおける読込専用パスワード新設と完全分離** | `tests/unit/neighbor.test.js`<br/>`tests/system/system-matrix.test.js` | ・読込専用入力欄の優先参照: `#neighbor-pass`（保存用）に誤ったパスワードが入力されていても、`#neighbor-import-pass` を参照して正しく復号・読み込み完了。<br/>・ファイル読込（`loadNeighborTxt`）および貼り付け（`loadPastedTextToNeighbor`）の双方で分離を検証。<br/>・未入力時プロンプトフォールバック: `#neighbor-import-pass` が空文字の場合、保存用欄を見に行かず `prompt()` による手動入力へフォールバック。<br/>・可視化トグル: `#neighbor-import-pass` の入力タイプ（`password` ⇄ `text`）切り替え。 | **完全充足 (100%)** |

---

## 3. 境界値・異常系・非対応環境の検証網羅性評価

セキュリティ堅牢性と耐障害性（フォールトトレランス）を担保するため、境界値・異常系・非対応環境のテストがどのように設計されているかを評価した。

### 3.1 外部共有・通信境界（External Sharing & Web APIs）
- **Web Share API 非対応環境のフォールバック**:
	- `delete navigator.share` の環境下で、自動的にクリップボードコピー処理（`navigator.clipboard.writeText`）へと遷移し、成功通知アラートが提示されることが検証されている。
- **クリップボード権限拒絶（Permission Denied / 非セキュア環境）**:
	- クリップボードAPIが例外をスローした場合、第3の防壁としてブラウザ標準の `global.prompt()` による手動選択・コピー支援ダイアログへ安全に縮退することが検証されている。
- **Web Share API のユーザーキャンセル（`AbortError`）の無害化**:
	- ユーザーがOS標準の共有シートをキャンセルして閉じた際、例外を正しく捕捉し、不快なエラーダイアログを表示させないUX挙動が担保されている。
- **URL長制限（2,000文字超）に対する切断防止フェイルセーフ**:
	- LINE（`line.me/R/msg/text/?`）およびメーラー（`mailto:`）のクエリパラメータ長が2,000文字を超える大規模地区データにおいて、URL直接埋め込みを抑止し、クリップボード退避＋案内文起動へ切り替わる安全設計がユニット・システム双方で検証されている。

### 3.2 パスワード・暗号化ライフサイクル境界（Security & Encryption Lifecycle）
- **未暗号化LocalStorageへのパスワード漏洩防御**:
	- 端末内暗号化が無効な環境において、万が一UIのオプトインチェックが入っていても、`state.saveDistrictLocal()` の状態層レベルのハードガードによって `savedFilePassword` が完全に削除され、平文保存が阻止されることが検証されている。
- **即時ロック時のメモリ・DOM残存ゼロ化**:
	- アプリロック時に `clearMemoryAndDomForLock()` が実行され、インメモリのStateオブジェクトだけでなく、HTMLフォーム上の入力欄（`#d-pass`, `#d-pass-confirm`）も完全に空文字化されることが検証されている。
- **パスワード不一致バリデーション**:
	- パスワード保存・共有時において、確認用パスワードと一致しない場合は暗号化および共有処理が直ちに中断されることが検証されている。

### 3.3 入力サニタイズ・IME境界（Input Sanitization & Caret Tracking）
- **境界値耐性**:
	- `sanitizePasswordInput` に対して `null`、空文字列 `""`、および `selectionStart` プロパティを持たないプレーンオブジェクトが渡された場合でも、例外をスローせず安全に処理を終了することが確認されている。
- **マルチバイト混在入力**:
	- 全角英数、全角記号、全角空白、ひらがな・漢字が複雑に混在した入力文字列に対し、全角ASCIIのみが半角化され、それ以外の不要文字が正確に除去されることが検証されている。

---

## 4. 設計レビュー指摘事項（A-1 〜 A-5）の反映確認

Stage 3 設計レビュー報告書（`docs/reviews/review2_design.md`）において提示された是正措置（アクションアイテム A-1 〜 A-5）が、テストスイートへ確実に落とし込まれているかを検証した。

| 指摘ID | 指摘内容と是正措置 | テストスイートでの具現化状況 | 評価 |
| :---: | :--- | :--- | :---: |
| **[A-1]** | **外部共有におけるURL長制限・暗号文切断リスクの設計明記と安全フォールバック** | ・`tests/unit/district.test.js`（lines 545-571）および `tests/system/system-matrix.test.js`（lines 657-673）にて、50〜60名の児童データ（暗号文長2000文字超）を作成し、LINEおよびEmail共有時に暗号文がクリップボードへ退避され、URLクエリから除外されていることを厳格にアサート。 | **適合 (完全反映)** |
| **[A-2]** | **状態管理（State）層におけるパスワード平文保存防止の厳格な二重防壁** | ・`tests/unit/state.test.js`（lines 117-130）および `tests/unit/district.test.js`（lines 472-478）にて、ストレージ未暗号化時に `state.saveDistrictLocal()` が `savedFilePassword` を強制削除し、LocalStorage生データにも平文が書き込まれないことを単体・結合レベルで検証。 | **適合 (完全反映)** |
| **[A-3]** | **パスワードサニタイズ時のキャレット位置補正アルゴリズムの明確化** | ・`tests/unit/utils.test.js`（lines 398-408）および `tests/system/system-matrix.test.js`（lines 745-752）にて、全角空白および日本語文字がカーソル以前から除去された際、その削除文字数分だけ正確にキャレットが左シフト補正されることを検証。 | **適合 (完全反映)** |
| **[A-4]** | **ERD（データモデル）への `savedFilePassword` 属性の反映** | ・ドキュメント側（`docs/system_design.md`）の是正措置。テストケース内でも `currentDistrict.savedFilePassword` として一貫した属性名で取り扱われていることを確認。 | **適合** |
| **[A-5]** | **ドキュメント内の不要な空行末尾タブのクリーンアップ** | ・ドキュメント側のクリーンアップ措置。テストファイル群においても不要な末尾空白が徹底排除されている。 | **適合** |

---

## 5. テストコード品質・規約遵守状況検証

### 5.1 完全ゼロ外部依存性（Zero External Dependencies）
- すべてのテストコードが Node.js 24 組み込みの `node:test`、`node:assert`、および Web Cryptography API（`crypto.webcrypto`）のみを用いて記述されている。
- `tests/helpers/dom-mock.js` による軽量インメモリDOM環境が完備されており、外部の巨大なDOMライブラリ（JSDOM等）に依存せず高速かつ決定論的に実行可能となっている。

### 5.2 インデント規約および空白文字の検証結果
- **末尾空白（Trailing Whitespace）**:
	- `tests/` 配下の全テストコードおよびヘルパーファイルにおいて、行末の不要な空白・タブ文字は **0件（完全排除）** である。
- **インデント規約（タブインデント `\t`）**:
	- 実装コードおよびアサーション行は 100% タブインデントで記述されている。
	- **軽微な検出事項（Stage 6での修正申し送り）**:
		1. `tests/system/system-matrix.test.js`（19, 79, 123, 172, 211, 261, 318, 359, 394, 430, 538, 585, 625, 676, 731, 755行目）、`tests/helpers/dom-mock.js`（2行目）、`tests/helpers/fixtures.js`（2行目）の複数行ブロックコメント見出し行において、スペース3文字のインデント（`   機能X: ...`）が存在する。
		2. `tests/system/system-matrix.test.js` において、430行目と538行目の双方で `機能10` とナンバリングされており、連番に重複が生じている（機能10が2件存在）。

---

## 6. 本線実装フェーズ（Stage 6）への申し送り事項

Stage 4 で作成されたテストスイートを Green（全件合格）へと導くため、Stage 6（本線実装・コードクリーンアップ）の担当者に向けて以下の実装・改修要件を申し送る。

### 6.1 各モジュールへの実装申し送り

#### 1. `js/app.js`
- **`toggleModeSelector()` の新設**:
	- `#mode-tab-buttons` と `#mode-active-badge` の `style.display` をトグル切り替え（`flex` ⇄ `none`）。
- **`switchTab(tabId)` の改修**:
	- タブ切り替え時に `#mode-tab-buttons` を `none` に、`#mode-active-badge` を `inline-flex` に更新。
	- バッジ内のテキスト（`#mode-active-badge-text`）に現在のアクティブモード名称（例: `① 各地区役員モード ▼ [モード切替]`）を反映。
- **`shareAppUrl()` の新設**:
	- `navigator.share` が利用可能であれば `{ title: '校外委員会 名簿・出席管理システム', url: window.location.href }` で共有を実行。
	- ユーザーキャンセル（`err.name === 'AbortError'`）は静かに無視。
	- 失敗時または `navigator.share` 未対応時は `navigator.clipboard.writeText` でURLをコピーし、アラート通知。
	- クリップボードも拒絶された場合は `prompt()` ダイアログへフォールバック。
- **`clearMemoryAndDomForLock()` の強化**:
	- 即時ロック時、`currentDistrict.savedFilePassword` を削除し、DOM要素 `#d-pass`, `#d-pass-confirm`, `#d-load-pass` の `value` を空文字化し、`#d-save-password-optin.checked` を `false` に初期化。

#### 2. `js/utils.js`
- **`sanitizePasswordInput(el)` の新設**:
	- `el` が未定義、あるいは `value` を持たない場合は安全に即時復帰。
	- カーソル位置 `origStart = el.selectionStart`, `origEnd = el.selectionEnd` を記録。
	- 全角ASCII（`U+FF01`〜`U+FF5E`）を半角ASCII（`!`〜`~`）へと変換（`charCodeAt(0) - 0xFEE0`）。
	- 全角空白（`U+3000`）および非ASCII文字（かな・漢字）を除去。
	- **キャレット位置補正（A-3）**: `origStart` より前のインデックスで削除された文字数を算出し、`newStart = Math.max(0, origStart - removedCount)` として `el.setSelectionRange(newStart, newStart)` を実行（要素に `setSelectionRange` メソッドが存在する場合のみ）。

#### 3. `js/state.js`
- **`saveDistrictLocal()` の強化（A-2ハードガード）**:
	- 端末暗号化が無効な場合（`!cryptoLib.isStorageEncrypted()`）、チェックボックス状態に関わらず `delete currentDistrict.savedFilePassword;` を強制実行。
	- 端末暗号化が有効で、かつ `#d-save-password-optin.checked` が真の場合のみ、パスワードを保持。

#### 4. `js/district.js`
- **`renderDistrictForm()` の改修**:
	- 端末暗号化が有効かつ `currentDistrict.savedFilePassword` が存在する場合、`#d-pass` および `#d-pass-confirm` に値を自動設定し、`#d-save-password-optin.checked = true` とする。
- **`shareDistrictData(channel)` の新設**:
	- パスワード一致検証（不一致時はアラート表示し中断）。
	- AES-256-GCM暗号化テキストを生成。
	- `channel === 'share'`: `navigator.share` により暗号化テキストファイルを共有。
	- `channel === 'copy'`: クリップボードに暗号化テキスト（`BEGIN_DATA:...:END_DATA`）を格納。
	- `channel === 'line'` / `'email'`:
		- 暗号文の全体サイズが 2,000文字以下の場合はURLクエリに埋め込んで開く。
		- 2,000文字を超える場合は、暗号文をクリップボードに自動退避させ、URLには定型案内文（「クリップボード」の語句を含む）のみをパラメータとして開く。
- **`runDistrictYearUpdate()` の改修**:
	- 新年度化処理において `delete currentDistrict.savedFilePassword;` を行い、フォーム入力値およびオプトインチェックをクリア。

#### 5. `js/neighbor.js`
- **`loadNeighborTxt()` および `loadPastedTextToNeighbor()` の改修（C-5）**:
	- 読込パスワードとして新設入力欄 `#neighbor-import-pass` を第一優先で参照（`#neighbor-pass` は完全に無視）。
	- `#neighbor-import-pass` が空文字の場合は `prompt()` による手動入力ダイアログへフォールバック。
- **`neighbor-import-pass-toggle` のバインド**:
	- クリックイベントで `utils.togglePasswordVisibility('neighbor-import-pass', this)` を実行。

#### 6. `index.html` のマークアップ整合
- ヘッダー部: `#mode-tab-buttons`, `#mode-active-badge`, `#mode-active-badge-text`, `#btn-share-app` の配置。
- タブ①カード6: `#d-save-password-optin` および共有ボタン群（ネイティブ共有、LINE、メール、コピー）の配置。
- タブ③カード4: 読込専用パスワード欄 `#neighbor-import-pass` およびトグルボタン `#neighbor-import-pass-toggle` の配置。
- 全パスワード欄への属性付与: `inputmode="latin"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"` の設定および `oninput="utils.sanitizePasswordInput(this)"`。

### 6.2 テストファイル自体の軽微なクリーンアップ
- `tests/system/system-matrix.test.js`、`tests/helpers/dom-mock.js`、`tests/helpers/fixtures.js` のブロックコメント内にあるスペース3文字インデントをタブインデント化すること。
- `tests/system/system-matrix.test.js` の機能番号（機能10の二重定義）を「機能10: 自治会役員名簿...」「機能11: モード選択肢...」「機能12: アプリ共有...」「機能13: 地区データ共有...」「機能14: パスワード安全記憶...」「機能15: パスワード入力サニタイズ...」「機能16: 自治会読込専用パスワード...」へと連番を是正すること。

---

## 7. 総合判定・次期ステージへの移行承認

### 7.1 判定結果
**総合判定**: **合格（PASS / Stage 6 本線実装フェーズ移行承認）**

### 7.2 判定理由
1. **ユーザー要求（6項目）のテスト充足率**: **100.00%**。正常系、異常系、UI状態遷移、ライフサイクル全般にわたり漏れなくアサーションが定義されている。
2. **設計レビュー改善提言（A-1 〜 A-5）の反映率**: **100.00%**。特にURL長制限に対するクリップボード退避フォールバック（A-1）および未暗号化環境での強制除外ハードガード（A-2）、キャレット追従補正（A-3）が高精度にテスト化されている。
3. **外部依存ゼロ・サプライチェーン耐性**: Node.js標準機能のみで完結しており、再現性・堅牢性が極めて高い。
4. **TDDの妥当性**: 現在の実装不在状態で意図通りレッド（Red）となっており、テストの有効性が実証されている。

本テストスイートを品質ゲートの基準として、**Stage 6（本線実装・コードクリーンアップ・リファクタリング）** への移行を正式に承認する。
