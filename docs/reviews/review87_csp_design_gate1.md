# Gate 1 設計レビュー記録（R-25 意図しない外部通信の遮断）

**実施日**: 2026年11月21日<br>
**レビュワー**: 独立サブエージェント（Gate 1 設計・セキュリティレビュワー、読取専用。各回とも別個体）<br>
**対象**: `docs/requirements.md` R-25、`docs/external_design.md` E-14-01〜05、`docs/internal_design.md` I-14-01〜03 と I-05 の「厳格CSPとイベント」の参照、`docs/specification_traceability.md` 第18節（文書版 1.10、アプリ 2.12.1）<br>
**要求**: 利用者の追加要件「CSPを追加して、意図しない外部サーバーとの通信を遮断」

## 1回目 — 要是正（Stage 2）

- external_design.md:271: `frame-src 'self'` が、R-25 の「同一オリジンの入れ子文書」の許可と E-14-01 の「アプリ自身は入れ子文書を使わない」で食い違い、本番の方針を試験（SEC-34 の iframe 方式の3件）の都合で緩めている。file 起動の Chromium では `'self'` がすべての file: URL に一致し、CSP のないローカル HTML を入れ子にして外部へ fetch させられた（実証。悪用には HTML 注入が必要）。
- external_design.md:275: `x-dns-prefetch-control` は暗黙の先読みしか止めず、`<link rel="dns-prefetch">`・`preconnect` は CSP 違反なしで DNS の問い合わせ・接続を起こす（net-log で実証）。
- external_design.md:288: CSP で拒否される iframe・form の送信でも、Chromium は宛先の DNS 解決と接続を先に始める（実証）。残余に記載がない。
- internal_design.md:677: 「試験用サーバーが何も受信しない」は、CSP のない対照ページでも多くの手段で成り立ち、拒否の根拠にならない。陽性の対照「Node から到達できる」は Chromium からの到達を示さない。「Chromium がループバックの HTTP を読み込めない」も不正確（fetch・XHR は届く）。手段ごとの対照、`Network.loadingFailed` の `blockedReason: 'csp'` を根拠に加えるべき。
- specification_traceability.md:420: 外部の `new Worker`・`SharedWorker` は file 起動では CSP の判定より前に例外となり違反が出ない。第18節と I-14-03 が矛盾する。prefetch の `effectiveDirective` は `default-src`。
- internal_design.md:684: 既存の実Chromium 試験は file 起動で Service Worker を登録せず、保存と印刷は差し替えている。「Service Worker の登録を含む」は事実と異なる。実のダウンロードの試験を加えるべき。
- internal_design.md:668: ページ移動の字句固定に漏れ（`location.reload()`、`location.assign`、`location` への直接代入、`open(`、`navigation.navigate`、`submit()`・`requestSubmit()`、meta refresh、リンクの生成、`fetchLater`・`WebTransport`、icons/*.svg）。
- external_design.md:274: 文書: 「従来は…適用されなかった」は Chromium の挙動と合わない（旧順序でも manifest・icon の取得に CSP が適用された）。
- external_design.md:273: 文書: 「R-15 の CSP の要求」とあるが、R-15 に CSP の要求はない（I-05 の「厳格CSPとイベント」と開発プロセス定義書 4.5 の2）。

### 是正

- `frame-src 'none'` とし、R-25 から入れ子文書の許可を外した。理由（file 起動の `'self'` と、CSP を持たない同一オリジンの文書）を E-14-01 に書いた。SEC-34 の3件は、試験から開いた同一オリジンの別ウィンドウで再現する形に改める（I-14-03・第18節）。
- 資源ヒント、拒否される遷移に先立つ名前解決・接続、トップレベルのページ移動、WebRTC を、CSP で制限できない経路として R-25・E-14-05 に書き、E-14-03 の meta の効果を暗黙の先読みに限った。
- I-14-02 を、絶対 URL・通信 API・ページ移動・リンク・資源ヒントの許可リストに組み直した（`location.reload()` の全消去後の1か所、ダウンロードと LINE 内ブラウザ向けのリンクの `.href`、`WebTransport`・`fetchLater` の禁止、icons/*.svg の対象化、index.html の `rel` の許可値）。
- I-14-03 と第18節の試験を、CSP のない対照ページでの手段ごとの陽性の対照（CDP の要求・WebSocket の作成、受信できる手段はサーバーの受信）、違反イベントの `effectiveDirective` と `blockedURI`、`blockedReason: 'csp'` を根拠とする形に改めた。Worker は実ブラウザの対象から外し、prefetch の期待値を `default-src` とした。iframe・form の TCP 接続は判定に使わない。
- 既存の試験一式の記述を事実に合わせ（保存・印刷の差替え、Service Worker の未登録）、差し替えない `downloadTextFile` の実ダウンロードの試験を加えた。HTTP 配信の未検証の範囲（Service Worker、`worker-src`・`manifest-src`）を明記した。
- 文書: E-14-02 の旧順序の記述と、E-14-01 の参照先を直した。

---

## 2回目 — 要是正（Stage 2）

- internal_design.md:670: `open(` の規則が `window.open` と「`window.` のない `open(`」だけで、書かれたとおりでは sw.js の `caches.open` に一致する。逆に `X.open(` を除けば `document.open(url, '_blank', …)`・`globalThis.open`・`self.open` を検出できない（いずれも CSP 違反なしで外部のページを開くことを実証）。`location.host`・`hostname`・`protocol`・`port` への代入と添字の形もない（`location.host` への代入で別ホストへの移動が始まることを実証）。
- internal_design.md:680: リンク・資源ヒント・meta refresh の規則が、js の HTML 文字列（`innerHTML`・`insertAdjacentHTML`）を対象にしていない。`insertAdjacentHTML` の `<link rel="preconnect">` で接続、`innerHTML` の meta refresh でトップレベルの移動が CSP 違反なしで起きた（実証。現行のテンプレートには該当の字句がない）。
- internal_design.md:688: `manifest-src` は実ブラウザで確かめられる（`link[rel=manifest]` を外部へ向けて `Page.getAppManifest` で違反と `blockedReason: 'csp'` を観測、対照ではサーバーが受信）。アイコンの link も `img-src` の違反になる。試験の手段に加えるべき。
- external_design.md:271: file 起動では `'self'` がホスト付きの file: URL にも一致し、画像・script が CSP 違反なしで要求される（潜在。Windows では UNC として外部へ接続しうる。未確認）。残余に記録がない。
- internal_design.md:664: 文書: 「絶対 URL」の定義がなく、プロトコル名の比較の文字列などを誤検出・見逃しうる。
- internal_design.md:691: 文書: `blockedURI` の形は手段で異なる（入れ子文書・object はオリジンだけ、WebSocket は `ws:`、form の GET は末尾に `?`）。
- internal_design.md:701: 文書: 対照で試験用サーバーが受信する手段の範囲の記述が不完全。
- external_design.md:270: 文書: `'unsafe-inline'` の理由に、印刷の向きの `<style>` 要素（js/hata.js）が書かれていない。
- review87_csp_design_gate1.md:5: 文書: 対象欄の「I-03」は I-05 の誤り。

### 是正

- I-14-02 を組み直した。URL の定義（`://` を含む部分、プロトコル相対、`mailto:`・`data:`・`blob:`・`file:`・`javascript:`。プロトコル名だけの比較の文字列と SVG の名前空間は除く）と許可する箇所・件数を定めた。`open(` は `window.open` 6か所と `caches.open` 2か所だけとし、他の形をすべて禁止した。`location` は列挙した4か所の操作だけとし、属性への代入・添字・`assign` を禁止した。
- I-14-02 に「HTML の生成」を加え、js の文字列・テンプレートでリンク・meta・フォーム・入れ子文書・script のタグと `href=` などの属性を使わないこと、それらの要素の生成はファイルの保存の `a` だけであることを定めた。E-14-05 の CSP で制限できない経路にも HTML 文字列を加えた。
- I-14-03・第18節の実ブラウザの手段に、アイコンの link（`img-src`）と `Page.getAppManifest` によるマニフェスト（`manifest-src`、対照ではサーバーの受信）を加えた。未検証の範囲を `worker-src` と自オリジンのマニフェストの取得に限った。
- R-25・E-14-01・E-14-05 に、file 起動の `'self'` がホスト付きの file: URL に一致する残余と、防ぐ手段（file: の URL を含めない、R-15、HTTPS 配信の推奨）を書いた。
- 文書: `blockedURI` の形、対照で受信する6つの手段とその理由、`'unsafe-inline'` の理由（追跡表にも行を追加）、本記録の対象欄を直した。

---

## 3回目 — 要是正（Stage 2）

- internal_design.md:672: I-14-02 の固定がページ側の API だけで、CSP が適用されない sw.js から使える `WindowClient.navigate()`・`clients.openWindow()` が対象外（潜在。試作の走査で検出されないことを確認）。
- internal_design.md:664: URL の定義が小文字のスキームだけで、`HTTPS://`・`https:\\`・`https:host`・`/\host` を見逃す。タグ・属性も大文字小文字と `=` の前後の空白で見逃しうる（実Chromium で `<A HREF = "HTTPS://…">`・`<LINK REL = "preconnect">` が有効な要素になることを確認）。
- internal_design.md:694: 静的試験が実ファイルの走査だけで、禁止する形が現行コードにないため、照合が誤っていても常に合格する。規則ごとに違反の試料を与える観点がない。
- internal_design.md:695: `worker-src` は `blob:`・`data:` の Worker で実ブラウザでも確かめられる（実証）。
- external_design.md:297: ブラウザ自身の機能（拡張スペルチェックなど）がページの入力内容を外部へ送る経路が、制限できない経路にも範囲外にもない（潜在）。名簿の入力欄に `spellcheck="false"` がない。
- internal_design.md:678: 文書: 「`location` そのものへの代入」を字句どおりに実装すると、局所の名前（js/hata.js・js/handoff.js）に一致する。
- internal_design.md:664: 文書: `file:` などを位置の条件なしで探すと、js/district.js の文中の「file:」に一致する。
- specification_traceability.md:419: 文書: `'unsafe-inline'` の行の対応先は I-14-01。
- specification_traceability.md:421: 文書: 「外部の宛先への要求はすべて `blockedReason: 'csp'` で失敗する」は実際より広い（手段により CDP への現れ方が異なる）。

### 是正

- R-25・E-14-05 の CSP で制限できない経路に Service Worker の処理を加え、I-14-02 で sw.js の `clients` の操作を `claim()` だけとし、`navigate(`・`openWindow`・通知・プッシュなどを禁止した。
- I-14-02 に照合の規則（大文字小文字・`\`・特別スキームのスラッシュの有無・`mailto:` などの位置・`=` の前後の空白）を定め、URL の定義をそれに合わせた。
- I-14-03・第18節に、規則ごとの違反の試料（1〜3回目で実証された形を含む）と除外する形の試料で照合の検出力を確かめる観点を加えた。
- `blob:`・`data:` の Worker を実ブラウザの手段に加え（対照では実行を確かめる）、未検証の範囲を HTTP 配信の Service Worker の登録・更新と自オリジンのマニフェストの取得に限った。
- `<body spellcheck="false">` でページ全体のスペルチェックを無効にすることを R-25・E-14-03・I-14-02 に定めた（作業コピーの実Chromium で、地区モードの入力欄135個と後から作った入力欄に継承されることを確認）。利用者が操作・設定するブラウザ自身の機能（翻訳など）は範囲外と明記した。静的・実Chromium の試験の観点を加えた。
- 文書: `location` の対象（修飾した `.location` と局所で宣言されていない `location`）と除外する2か所、`mailto:` などの位置の条件、`'unsafe-inline'` の行の対応先、CDP への現れ方の記述を直した。

---

## 4回目 — 要是正（Stage 2）

- external_design.md:301: Microsoft Edge のテキスト予測（レビュワーが引用した Microsoft の文書では、既定で有効で、Microsoft のサービスが長文の入力欄の予測を生成するとされる。Edge での実際の送信は未観測）も入力中に自動で送られうるが、対策にも範囲外にもない（潜在。`writingsuggestions` 属性が Chromium 150 にあり、`<body>` から継承されることは実証）。
- internal_design.md:697: スペルチェックの固定が `spellcheck="true"`・値なし・`.spellcheck = true` だけで、`setAttribute`・`toggleAttribute`・`removeAttribute`、単引用符・引用符なし・大文字・空の値を見逃す（いずれも `<body spellcheck="false">` のもとで有効に戻ることを実証。現行コードに該当はない）。
- internal_design.md:666: 文書: URL を探す位置（文字列・属性値など。正規表現リテラル・コメントを除く）とスキームの左の境界が定められておらず、正規表現リテラルの `/\d+/g` などや `rows:5` に一致しうる。
- internal_design.md:716: 文書: iframe・form の CDP への現れ方（エラーページの受信・完了が続く）と、iframe を送信先とする form の送信で `frame-src` の違反も出ることが書かれていない。

### 是正

- `<body>` に `writingsuggestions="false"` も置き、R-25・E-14-03・E-14-05・I-14-02・I-14-03・第18節に反映した（古い Edge は利用者の設定による残余と明記）。
- スペルチェックと候補表示の固定を、値が `false` の属性・代入だけを許し、属性の操作の API を禁止する形に改め、指摘の形を違反の試料に加えた。
- 文書: URL を探す位置と、静的試験の境界の条件（スキームの左の境界、プロトコル相対の区切りとホスト名の `.`）と除外の試料、CDP への現れ方と form の試験で出る違反を書いた。

---

## 5回目 — 要是正（Stage 2）

- internal_design.md:701: `.spellcheck` への文字列の `'false'` の代入を許しているが、真偽値の IDL 属性のため真に変換され、スペルチェックが有効に戻る（実証。`document.body.spellcheck = 'false'` でページの入力欄129個が有効になった）。
- internal_design.md:680: 禁止する通信 API の一覧が、別名の `webkitRTCPeerConnection`（CSP 違反なしで STUN の要求を外部へ送ることを実証）と、`stun:`・`turn:` の URL、Web Speech API（音声認識・読み上げ。潜在）を扱っていない。名前を部分一致で照合するかも定められていない。
- internal_design.md:670: 文書: 照合する位置の定め（コメント・正規表現リテラルを除く）とファイル全体を走査する方式が両立せず、コメントの中の URL や `(/\./g` を除けない。属性名に左の境界がなく、`errEl =`・`mapping =` などに一致する。

### 是正

- `.spellcheck` は真偽値の `false` の代入だけを許し、`.writingSuggestions` は `false`・`'false'` を許すと分けた。
- 禁止する API の名前を部分一致で照合すると定め、`webkitRTCPeerConnection`・`SpeechRecognition`（`webkitSpeechRecognition`）・`speechSynthesis`・`PaymentRequest`・`PresentationRequest` を加えた。URL の定義に `stun:`・`stuns:`・`turn:`・`turns:` を加えた。R-25・E-14-05 の CSP で制限できない経路に、これらのブラウザの API を加えた。
- 文書: 照合は、簡易な字句解析でコメントと正規表現リテラルを取り除いた内容に対して行うと一意に定めた（作業コピーで、現行コードで取り除かれる箇所がコメントと正規表現リテラル56か所だけであることを確かめた）。タグ名・属性名の境界の条件を定め、指摘の形を違反・除外の試料に加えた。

---

## 6回目 — 要是正（Stage 2）

- internal_design.md:672: プロトコル相対の照合が「`//` の直後のホスト名」だけで、js の文字列で `\` を `\\` と書いた `'/\\host.example/x'`・UNC の `'\\\\host.example\\share'`・`'///host.example'` を見逃す（潜在。Chromium で外部・ホスト付きの file: に解決され、CSP 違反なしで要求されることを実証）。
- internal_design.md:681: Service Worker の通信の固定が `fetch(` と禁止 API の名前だけで、Cache の `add()`・`addAll()`（内部で任意の宛先を取得する）を扱っていない（潜在）。
- internal_design.md:698: リンクの宛先の固定が `.href` への代入と `setAttribute` だけで、`Object.assign(要素, { href })`・`setAttributeNS` を見逃す（潜在。`Object.assign` で設定したアンカーの click で CSP 違反なしの移動を実証）。
- requirements.md:179: 文書: WebRTC が2回出る。
- external_design.md:270: 文書: `@import` は `style-src` で制限される。
- internal_design.md:717: 文書: `blockedURI` が「試験用オリジンで始まる」と WebSocket・Worker の期待値が矛盾する。
- external_design.md:278: 文書: 生体認証連携（WebAuthn）でパスキーの提供元が行う通信が位置付けられていない。

### 是正

- 書き方の列挙では漏れが尽きないため、方式を改めた。`href`・`open`・`navigate` は、コメントと正規表現リテラルを除いた js・sw.js の中の語としての出現（書き方を問わない）を、ファイル・行の内容・件数で固定する。`openWindow`・`rel`・`ping`・`http-equiv` は出現0件とする。sw.js は Cache の `add`・`addAll` を使わず、`put` 2か所・`clients.claim()` 1か所に固定する。`fetch` の呼出しも件数で固定した。
- プロトコル相対の照合を、区切りの直後の `/`・`\` が2つ以上（数を問わない）続くものとし、すべて読み飛ばした後のホスト名で判定すると改め、js のエスケープの形の試料を加えた。
- 文書: R-25 の重複、`@import` の制限、`blockedURI` の手段ごとの期待値、WebAuthn のパスキーの提供元の通信（範囲外。アプリは名簿を渡さない）を直した。

---

## 7回目 — 要是正（Stage 2）

- internal_design.md:672: プロトコル相対の照合の「ホスト名に `.` を含む」の条件で、単一ラベルの UNC（`\\\\fileserver\\share`）・`//nasbox`・数値の IPv4・IPv6 のリテラルを見逃す（潜在。いずれも ホスト付きの file: に解決され、CSP 違反なしで要求されることを実証）。
- internal_design.md:719: 許可する箇所の固定が「ファイルと件数」（662・719行）と「ファイル・行の内容・件数」（680行）で食い違い、前者では許可した行の内容を件数を変えずに書き換えた転用（`link.href = importedModel.homepage;` など）を見逃す（潜在）。
- internal_design.md:681: 文書: sw.js の `href` の出現は4件（3行）。
- requirements.md:173: 文書: 「外部サーバー」の定義がなく、配信元との自動の通信（資産・Service Worker・起動時の version.json の確認）と字句の上で矛盾する。

### 是正

- プロトコル相対の照合から `.` の条件を外し、区切りの直後に `/`・`\` が2つ以上続き、その後にホストの文字が続くものとした（現行の対象ファイルに誤検出がないことはレビュワーが確認）。指摘の4つの形を試料に加えた。
- 許可する箇所の固定を、すべて「ファイル・行の内容（行番号ではない）・件数」にそろえ、許可した行の書換えと別ファイルへの移動の試料を加えた。
- 文書: sw.js の件数を「4か所（3行）」とし、R-25 に外部サーバー（配信元以外）の定義と、配信元との自動の通信の許可を書いた。

---

## 8回目 — 要是正（Stage 2）

- internal_design.md:697: `location` の規則が局所の名前を対象外にしており、実際の `Location` を受け取る js/handoff.js の `buildExternalBrowserUrl` の引数や、`const loc = window.location;` の別名からの `replace`・`assign`・`host` への代入を検出できない（潜在。CSP 違反なしで外部への移動になることを実証）。
- internal_design.md:707: URL の一部を変える `host`・`hostname`・`protocol`・`port` への代入を扱っておらず、ホスト名だけの文字列で外部の宛先を作れる（潜在。LINE 内ブラウザ向けのリンクの `hostname` の書換えで、CSP 違反なしで外部へ移動することを実証）。sw.js では字句の固定だけが防御である。

### 是正

- `location` を名前による固定に加え、js の48か所（36行）の行の内容を固定した（レビュワーの数えた49か所は、作業コピーで数え直すと48か所だった）。別名への代入・引数として渡すことは `buildExternalBrowserUrl` の既定値の1か所だけとし、この関数の中は読出しだけとした。局所の名前の除外をやめ、旗振りの場所の項目名も行の内容で固定する。
- `hostname`（3か所）・`protocol`（5か所）を名前による固定に加え、`host`・`port` は0件とした。これらへの代入（URL オブジェクト・リンク・`location`、`Object.assign` のキーを含む）を js・sw.js で禁止した。指摘の形を違反の試料に加えた。

---

## 9回目 — 要是正（Stage 2）

- internal_design.md:701: sw.js がナビゲーションに返すリダイレクト応答（`Response.redirect()`、`Location`・`Refresh` ヘッダー）が、名前による固定にも禁止の一覧にもない（潜在）。
- internal_design.md:662: 字句の固定の対象が決まった glob だけで、新しく加える HTML の文書や js/vendor/ のファイルが規則の外に出る（潜在）。
- internal_design.md:691: 禁止する API に位置情報（`navigator.geolocation`）がない（潜在）。
- internal_design.md:684: 文書: 名前による固定の「語」の境界が定められておらず、`'hata-location'` を数えるかで件数が変わる。
- internal_design.md:684: 文書: `window.location` を引数として渡す箇所は、js/handoff.js の `updateLineBrowserNotice` の呼出しを含めて2か所。
- internal_design.md:675: 文書: API の名前の照合で大文字小文字を区別するかが定められておらず、区別しない部分一致では `submit()` が `handleEnableEncryptionSubmit()` に一致する。

### 是正

- sw.js の `redirect`・`Refresh` を0件と定め（`Location` は `location` の固定で検出）、R-25・E-14-05 に Service Worker のナビゲーションへのリダイレクト応答を書いた。
- I-14-01 に配信するファイルの範囲（直下の4ファイルと css/・js/・icons/）を定め、HTML の文書は index.html だけ、直下に配信しないもの以外を置かない、sw.js の `ASSETS` と index.html の参照先は範囲に含まれる、とした。字句の固定の対象をこの範囲のテキストのファイルとした。R-25・E-14-02 にも書いた。
- `geolocation` を禁止する API に加え、R-25・E-14-05 の列挙に位置情報を加えた。
- 文書: 語の境界（英数字・`_`・`$`・`-`）、`window.location` を渡す2か所、API の名前は大文字小文字を区別した部分一致で `submit` はメンバーの呼出しとして照合すること、を書いた。いずれも試料に加えた。

---

## 10回目 — 要是正（Stage 2）

- requirements.md:179: 別の文書へのメッセージ（`postMessage`・`BroadcastChannel`・`MessageChannel`）が、CSP で制限できない経路にも禁止の API にもない（実証。アプリを入れ子にした CSP のないローカルの HTML と、別タブの CSP のない HTML が、将来の変更を模した送信を受け取って外部へ転送できた。現行コードの出現は0件）。
- external_design.md:302: WebAuthn を範囲外とする根拠（固定の rp・利用者名だけを渡す）を固定する規則がなく、選択肢に名簿を入れる変更や `rpId` の指定（Related Origin Requests による取得）を検出できない（潜在）。
- requirements.md:177: 文書: 「CSP と字句の固定は配信するすべてのファイルを対象とする」は、CSP を持たない sw.js・SVG と、字句の固定がテキストのファイルだけであることと食い違う。

### 是正

- `postMessage`・`BroadcastChannel`・`MessageChannel` を禁止する API に加え、`opener`・`parent` を0件とした。R-25・E-14-05 にこの経路と、HTTP 配信での `frame-ancestors`・`Cross-Origin-Opener-Policy` のヘッダーの推奨を書いた。
- WebAuthn の `rp`・`user` の選択肢を js/crypto.js の1か所の行の内容で固定し、`rpId` を0件とした。E-14-05 の範囲外の根拠に、字句の固定を明記した。
- 文書: R-25 で、CSP の対象（index.html。sw.js・SVG は対象外）と字句の固定の対象（配信するテキストのファイル）を分けて書いた。

---

## 11回目 — 通過（将来のコードの潜在の経路だけの指摘。反映して通過）

- internal_design.md:696: WebAuthn の選択肢の固定（`rp`・`user` の各1行）が現行コードの形と合わない。`user` は5行にわたるため、`name`・`displayName` の行と `WEBAUTHN_USER_ID` の定義、`extensions`（3か所）が固定されず、表示名に名簿を入れる変更や `largeBlob`・`credBlob` の追加を検出できない（潜在。試作の照合で、2つの変更を加えても列挙の結果が変わらないことを確認）。

### 通過とした理由と反映した内容

- 10回目の後、利用者が停止の基準を決めた: 今のコードで実証できる欠陥・退行・試験の検出力の欠落がなく、指摘が将来のコードの潜在の経路だけであれば、その経路を禁止の名前・許可リストに加えて反映し、再審査なしで Gate 1 を通過とする（開発プロセス定義書 4.1 の 5. に追記）。
- 11回目の指摘は、将来のコードが字句の固定をすり抜ける潜在の経路だけで、今のコードの挙動・試験の欠陥はない。このため Gate 1 は通過とした。
- 反映: js/crypto.js の `publicKey` の選択肢3か所の全行と `WEBAUTHN_USER_ID` の定義の行を行の内容で固定し、`extensions` を `prf` の `eval.first` だけ、`largeBlob`・`credBlob`・`rpId` を0件とした（I-14-02）。E-14-05 の根拠、I-14-03 の試料、第18節を合わせて直した。反映した内容は Gate 2・Gate 3 の審査対象に含める。

## 経過の要約

- 1〜2回目は CSP の本体（`frame-src` の扱い、資源ヒント・事前の接続の残余、試験の陽性の対照・拒否の根拠、Worker・マニフェスト・実ダウンロードの試験）の指摘で、設計を改めた。
- 3〜11回目は、CSP で制限できない経路を将来のコードが持ち込むことを検出する字句の固定（I-14-02）の漏れの指摘が中心だった。6回目に、書き方の列挙から名前の出現の固定へ方式を改めた。スペルチェック・入力の候補表示（3〜5回目）、Service Worker（3・6・9回目）、配信するファイルの範囲（9回目）、メッセージの API・WebAuthn（10〜11回目）を加えた。
