# シフト復旧（スタッフ全員の行に載せる）

## 本命：アーカイブ → **今のスタッフ UID** に直接書き戻す

削除で `shifts` から消えたデータは **`shiftArchives`** に残っていることが多いです。  
このスクリプトは **アーカイブの氏名** と **いまの `users`（role=staff）の名前** を照合し、`現UID_2026-02-01` 形式で **`shifts` に新規作成**します。

```bash
npm run restore-archives-to-staff -- --dry-run --year 2026 --month 2
npm run restore-archives-to-staff -- --execute --year 2026 --month 2
```

- dry-run で **梶田・人見…それぞれ何件戻るか** を必ず確認してください。
- **既に同じ `現UID_日付` がある**場合はスキップします（上書きしません）。

### 名前だけ合わないとき

- **旧 Firebase UID → 現スタッフ UID**（Authentication で旧 UID が分かるとき）:

```bash
export RESTORE_UID_MAP_JSON='{"旧UID1":"現UID1","旧UID2":"現UID2"}'
npm run restore-archives-to-staff -- --execute --year 2026 --month 2
```

- **アーカイブ上の表示名 → 現スタッフ UID**（例：是安遥）:

```bash
export RESTORE_NAME_MAP_JSON='{"是安遥":"現スタッフのFirebase UID"}'
npm run restore-archives-to-staff -- --execute --year 2026 --month 2
```

### 確認

```bash
npm run diagnose-shift-grid -- 2026 2
```

## 補助：`name_*` だけ直す（既に書いてある退職者キー用）

```bash
export REWIRE_MAP_JSON='{"是安遥":"UID","金澤優也":"UID"}'
npm run rewire-namekey-shifts -- --execute --year 2026 --month 2
```

## 認証情報

`GOOGLE_APPLICATION_CREDENTIALS_JSON` または `GOOGLE_APPLICATION_CREDENTIALS`

## アーカイブに該当月が無い場合

このスクリプトでは **増やせません**。バックアップや別システムからの復旧が必要です。
