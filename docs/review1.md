Viewed crypto.js:1-533
Viewed utils.js:1-353
Viewed app.js:1-540
Viewed sw.js:1-66
Viewed index.html:1-674
Viewed district.js:1-563
Viewed print.js:1-800
Viewed seat.js:1-132
Viewed print.js:801-910
Viewed hata.js:1-82

システム全体（アーキテクチャ・コード品質・機能整合性・PWA・テスト・設計書）の**全体コードレビュー**、および個人情報保護・暗号化実装に関する**セキュリティ・アセスメント**を実施いたしました。

全体として、サーバーレス・完全ローカル完結型の設計や AES-256-GCM + PBKDF2 + WebAuthn PRF によるハイブリッド暗号化、124件の自動テスト（カバレッジ95%超）など非常に高い水準で構築されていますが、精査の結果、**新設した「自治会役員モード」に関わる暗号化・消去漏れ（High）**や**PWAキャッシュ漏れ**など、実運用前に解消しておくべき重要な改善点がいくつか検出されました。

以下に詳細をご報告いたします。

---

## 1. セキュリティ・アセスメント（Security Assessment）

### 1.1 セキュリティ評価サマリー

| 評価領域 | 現状の評価 | 概要 |
| :--- | :---: | :--- |
| **暗号アルゴリズム・鍵導出** | **優良 (A)** | AES-256-GCM（96bitランダムIV、128bit認証タグ）＋ PBKDF2-HMAC-SHA256（100,000回反復、128bitランダムSalt）を標準 Web Crypto API で正確に実装。 |
| **生体認証連携 (WebAuthn PRF)** | **優良 (A)** | FIDO2 / WebAuthn Level 3 の `prf` 拡張を用い、256bit マスター鍵をラップ。`create` 時に PRF 出力を返さないブラウザ向けの直後 `get` フォールバック（[`crypto.js:247-269`](file:///home/k/workspace/kogaidocs/js/crypto.js#L247-L269)）も実装済み。 |
| **ローカルストレージ保護** | **要改善 (C)** | 地区データ・代表データは保護されているが、**新設した自治会データ（`kogai_neighbor_v2`）が暗号化有効化時および全消去時の処理から漏れている**（後述 S-1）。 |
| **セッション・ロック制御** | **要改善 (C)** | 即時ロック時に暗号鍵（`activeStorageKey`）は破棄されるが、**画面裏のDOM・メモリ変数・印刷領域に個人情報が残存**している。また無操作自動ロックが未実装（後述 S-2）。 |
| **XSS（クロスサイトスクリプティング）対策** | **良好 (B)** | 動的HTML生成箇所で `esc()` が徹底されているが、シングルクォート `'` のエスケープ追加と CSP ヘッダ導入でさらに堅牢化可能（後述 S-4, S-6）。 |
| **通信・外部依存リスク** | **最優良 (S)** | 外部スクリプト・CDN・外部API通信および本番 npm パッケージ依存が完全にゼロ（Supply Chain Attack リスク極小）。 |

---

### 1.2 検出されたセキュリティ課題と改善提案（重要度順）

#### 🚨 [S-1] 重要度：High — `kogai_neighbor_v2`（自治会データ）の暗号化移行漏れ・初期化消去漏れ
* **該当箇所**:
  * [`setupStorageEncryption()` (js/crypto.js:368-375)](file:///home/k/workspace/kogaidocs/js/crypto.js#L368-L375)
  * [`clearStorageSecurity()` (js/crypto.js:436-L441)](file:///home/k/workspace/kogaidocs/js/crypto.js#L436-L441)
  * [`index.html` タブ③ カード3 (index.html:575-580)](file:///home/k/workspace/kogaidocs/index.html#L575-L580)
* **リスク内容**:
  1. **平文残留**: 自治会役員モード（タブ③）で役員名簿を入力した後に「端末内保存の暗号化を有効化」を実行すると、`kogai_district_v2` と `kogai_rep_v2` は暗号化されるものの、`kogai_neighbor_v2` が再保存対象から漏れているため **`localStorage` 上に平文（JSON）のまま残り続けます**。
  2. **初期化時の消去漏れ**: 「🗑️ 保存データを全消去して初期化」（`clearStorageSecurity()`）を実行した際、`localStorage.removeItem('kogai_neighbor_v2')` が呼ばれておらず、**端末を初期化したつもりでも自治会役員の個人情報がブラウザ内に残留**します。
  3. **UI導線**: タブ①・タブ②にはパスワード欄のすぐ下に「🛡️ このパスワードでブラウザ内データ（LocalStorage）も暗号化保護する」ボタンがありますが、タブ③には同ボタンがありません。
* **対策案**:
  * `setupStorageEncryption()` 内で `neighborState` も `saveStorageData('kogai_neighbor_v2', neighborState)` する。
  * `clearStorageSecurity()` 内に `localStorage.removeItem('kogai_neighbor_v2')` を追加する。
  * タブ③にも `quickSetupEncryptionFromCard('neighbor-pass')` ボタンを設置する。

---

#### ⚠️ [S-2] 重要度：High — ロック中の DOM・メモリ・印刷領域への個人情報残存および自動ロック未実装
* **該当箇所**:
  * [`handleImmediateLock()` (js/app.js:345-350)](file:///home/k/workspace/kogaidocs/js/app.js#L345-L350)
  * [`docs/system_design.md` 4.4節](file:///home/k/workspace/kogaidocs/docs/system_design.md#L186-L190)
* **リスク内容**:
  1. **ロック中の画面裏データ残存**: 「🔒 今すぐストレージをロックする」を押すと `activeStorageKey = null` となりロック解除モーダルが表示されますが、背後の DOM（`<input>` 要素の `value` や `#print-area`）およびメモリ上の変数（`currentDistrict`, `repState`, `neighborState`）はクリアされていません。そのため、ロック画面のままブラウザの印刷（`Ctrl + P`）を実行したり、開発者ツールでモーダル要素を削除すると、ロックを解除せずに個人情報を閲覧・印刷できてしまいます。
  2. **無操作・バックグラウンド自動ロック**: システム設計書 4.4節に記載されている「一定時間（15分）の無操作またはタブ非表示時の自動ロック」がコード側に未実装です。
* **対策案**:
  * `lockStorage()` / `handleImmediateLock()` 実行時に、メモリ上の状態オブジェクトを初期空データへリセットし、テーブルの再描画および `#print-area` のクリアを行う（ロック解除時に `loadAppDataFromStorage()` でストレージから復号再ロードされるためデータは失われません）。
  * 無操作タイマー（15分）等の自動ロック機構を `app.js` に実装する。

---

#### ⚠️ [S-3] 重要度：Medium — `decryptPayload()` における `PLAIN:` プレフィックスの無認証バイパス
* **該当箇所**:
  * [`decryptPayload()` (js/crypto.js:49-51)](file:///home/k/workspace/kogaidocs/js/crypto.js#L49-L51)
* **リスク内容**:
  * `if (payloadStr.startsWith("PLAIN:"))` の分岐が残っているため、`BEGIN_DATA: PLAIN:<Base64> :END_DATA` というテキストを外部から読み込ませた場合、パスワードチェックおよび AES-GCM の改ざん検知（認証タグ検証）を完全にバイパスして任意の JSON をインジェクト可能です。
  * また、暗号化ペイロードの最小バイト長（Salt 16B + IV 12B + GCM Tag 16B = 44B）の事前チェックがありません。
* **対策案**:
  * 後方互換用の `PLAIN:` 分岐を廃止し、すべての外部ファイル・テキスト読込において AES-256-GCM 復号を必須化する。

---

#### ⚠️ [S-4] 重要度：Medium — HTMLエスケープ関数 `esc()` のシングルクォート未対応
* **該当箇所**:
  * [`esc()` (js/utils.js:10-17)](file:///home/k/workspace/kogaidocs/js/utils.js#L10-L17)
* **リスク内容**:
  * 現在 `&`, `<`, `>`, `"` の4文字のみエスケープされており、`'`（`&#39;`）が含まれていません。現状のテンプレートは `value="${esc(...)}"` のようにダブルクォートで統一されているため直ちに発火する XSS はありませんが、多層防御（Defense in Depth）の観点からシングルクォートもエスケープすべきです。
* **対策案**:
  * `.replace(/'/g, "&#39;")` を [`esc()`](file:///home/k/workspace/kogaidocs/js/utils.js#L10-L17) に追加する。

---

#### ℹ️ [S-5] 重要度：Low — Content Security Policy (CSP) による外部通信遮断の強制
* **該当箇所**:
  * [`index.html` `<head>` (index.html:3-23)](file:///home/k/workspace/kogaidocs/index.html#L3-L23)
* **リスク内容**:
  * 本システムは「外部へ一切通信しない」ことが最大のセキュリティ価値ですが、HTMLの `<meta http-equiv="Content-Security-Policy">` が未設定です。
* **対策案**:
  * `connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';` 等を含む CSP メタタグを追加することで、万が一スクリプト注入が起きた場合でも、外部サーバーへの個人情報送信（Exfiltration）をブラウザエンジン層で100%遮断できます。

---

#### ℹ️ [S-6] 重要度：Low — 生の暗号鍵バッファのゼロクリア（Zeroization）と Blob URL の解放
* **該当箇所**:
  * [`unwrapKeyWithPassword()` (js/crypto.js:197-199)](file:///home/k/workspace/kogaidocs/js/crypto.js#L197-L199)、[`unwrapKeyWithWebAuthn()` (js/crypto.js:329-330)](file:///home/k/workspace/kogaidocs/js/crypto.js#L329-L330)、[`setupStorageEncryption()` (js/crypto.js:343-356)](file:///home/k/workspace/kogaidocs/js/crypto.js#L343-L356)
  * [`downloadTextFile()` (js/utils.js:169-175)](file:///home/k/workspace/kogaidocs/js/utils.js#L169-L175)
* **対策案**:
  * `exportKey("raw", ...)` や `decrypt(...)` で生成された生の鍵 `ArrayBuffer`（`rawMasterKey` / `rawMasterBuf`）は、`importKey` やラップ処理の直後に `new Uint8Array(buf).fill(0)` でゼロ埋めしてヒープメモリから消去する。
  * `downloadTextFile()` で生成した `URL.createObjectURL(blob)` は、クリック後に `setTimeout(() => URL.revokeObjectURL(url), 1000)` で解放する。

---

## 2. 全体コード・機能・設計レビュー（Code & Architecture Review）

### 2.1 検出された機能・コード品質上の課題

#### 🔧 [C-1] 重要度：High — Service Worker (`sw.js`) のプリキャッシュ対象に `js/neighbor.js` が未登録
* **該当箇所**: [`sw.js:1-19`](file:///home/k/workspace/kogaidocs/sw.js#L1-L19)
* **内容**:
  * `ASSETS` リストに `./js/neighbor.js` が追加されておらず、`CACHE_NAME` も `'kogai-cache-v1'` のままです。
  * PWA としてインストールしオフライン環境で開いた際、`js/neighbor.js` がキャッシュされておらずタブ③（自治会役員モード）が動作しなくなります。
* **対策案**:
  * `ASSETS` に `'./js/neighbor.js'` を追加し、`CACHE_NAME` を `'kogai-cache-v2'` に更新する。

---

#### 🔧 [C-2] 重要度：Medium — `print.js` / `seat.js` 等に残存する旧互換コード（`d.officer` 参照・未使用エイリアス）
* **該当箇所**:
  * [`js/print.js`](file:///home/k/workspace/kogaidocs/js/print.js#L58)（58, 125, 234, 279, 373, 516, 564, 619行目の `d.officer ? [d.officer] : []`、52行目の `type === 'officers'`、461行目の未使用関数 `buildOfficersRosterPageHtml`）
  * [`js/seat.js:17`](file:///home/k/workspace/kogaidocs/js/seat.js#L17)（`d.officer ? [d.officer] : []`）
  * [`js/app.js:394, 439`](file:///home/k/workspace/kogaidocs/js/app.js#L394)、[`js/district.js:445`](file:///home/k/workspace/kogaidocs/js/district.js#L445)、[`js/rep.js:14, 126, 262`](file:///home/k/workspace/kogaidocs/js/rep.js#L14)（`d.officers = [d.officer || {}]; delete d.officer;`）
* **内容**:
  * 「改修によって生じた不要なコードや互換性維持のためのコードは削除して」という方針、および設計書第8章の記載に対し、`print.js` や `seat.js` 内に旧 `d.officer` 単一オブジェクト用の三項演算子や互換エイリアス関数 `buildOfficersRosterPageHtml` が残っています（`print.js` の関数カバレッジが 100% ではなく 98.61% なのも、この互換エイリアス関数が原因です）。
* **対策案**:
  * 旧 `d.officer` フォールバックおよび `buildOfficersRosterPageHtml`、`utils.js` 内の旧 `item.name` / `item.kana` / `officer.childName` / `officer.childKana` 互換フォールバックを整理・削除し、現行の `officers` 配列および姓名分割スキーマ（`lastName` / `firstName`）へ完全に一本化する。

---

#### 🔧 [C-3] 重要度：Medium — タブ①（各地区役員モード）におけるクリップボード経由の自治会データマージUI
* **該当箇所**: [`index.html:82-112`](file:///home/k/workspace/kogaidocs/index.html#L82-L112)、[`js/district.js:471-512`](file:///home/k/workspace/kogaidocs/js/district.js#L471-L512)
* **内容**:
  * タブ③（自治会役員モード）には「📋 暗号化テキストをコピー（メール貼付用）」ボタンがあり、タブ②（代表モード）にはテキスト貼り付け欄がありますが、**タブ①（地区役員モード）の「2. 自治会役員名簿」カードには `.txt` ファイル選択ボタンしかなく、LINEやメールで自治会長から送られてきた暗号化テキストを直接貼り付けてマージする入力欄がありません**。
* **対策案**:
  * タブ①のカード2（またはファイル読込エリア）にも、暗号化テキスト貼り付けマージ用の入力欄＆ボタンを追加すると、スマートフォン（LINE等）での自治会長→地区役員の連携が格段にスムーズになります。

---

#### 🔧 [C-4] 重要度：Low — `hata.js` のクリップボードコピー失敗時ハンドリングと特殊文字置換
* **該当箇所**: [`js/hata.js:41-54, 70-73`](file:///home/k/workspace/kogaidocs/js/hata.js#L41-L73)
* **内容**:
  1. `copyHataList()` で `navigator.clipboard.writeText(text)` が `try/catch` なしで呼ばれており、権限拒否時や非HTTPS環境でエラーになります（`neighbor.js` と同様にテキスト選択フォールバックを入れるのが安全です）。
  2. `fmt.replace(/\{住所\}/g, rawAddr)` 等において、置換文字列に `$&` や `$$` が含まれる場合の誤展開を防ぐため、`replace(/\{住所\}/g, () => rawAddr)` の関数渡し形式にするとなお安全です。

---

## 3. 今後のアクションについて

上記で検出された指摘事項（特に **[S-1] 自治会データのLocalStorage暗号化・消去漏れ**、**[S-2] ロック時の画面・メモリクリア**、**[S-3/C-2] 旧互換コード `PLAIN:` や `d.officer` の完全削除**、**[C-1] `sw.js` への `neighbor.js` 追加**、**[C-3] 地区モードでのテキスト貼付マージ対応**）について、このまま一括して修正・反映（およびテスト・設計書の同期）を進めましょうか？