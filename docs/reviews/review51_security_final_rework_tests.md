# セキュリティ最終手戻り先行テストレビュー（Gate 2・第1回）

## 対象

- 別タブの `localStorage.clear()` 通知
- Service Workerの実行時公開資産取得

## 確認結果

- `StorageEvent.key === null`、`oldValue === null`、`newValue === null` の標準的な全消去通知を再現している。
- 全4モード、秘密入力、印刷DOMの即時破棄とロック画面表示を検査している。
- 全消去後に保護済みタブが平文保存を再開できないことを検査している。
- Service Workerのcold fetchとcached responseのバックグラウンド更新を分け、入力Requestが `force-cache` でも実効Requestを `credentials: omit`、`cache: no-store` へ上書きすることを検査している。
- 実装前実行では、全消去通知の秘密状態破棄1件とService Workerの2経路が想定どおりRedになった。

## 判定

PASS
