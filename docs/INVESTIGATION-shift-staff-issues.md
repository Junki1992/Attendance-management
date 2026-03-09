# 調査報告: スタッフ画面のシフト不具合

## 事象

1. **シフトの取り消しがスタッフ画面に反映されない**（管理者が確定取り消ししても、スタッフ側の表示が変わらない）
2. **スタッフ側でシフトの保存・提出ができない**（ボタンが押せない or 押しても動かない）

---

## 原因調査結果

### 事象1: 取り消しが反映されない

#### 想定される原因

**A. シフト購読で「キャッシュ由来」をすべて捨ている（最有力）**

- **場所**: `src/services/shiftService.ts` の `subscribeUserShifts`
- **処理**: `onSnapshot` のコールバック内で `if (snapshot.metadata.fromCache) return;` により、**fromCache のスナップを一切反映していない**
- **Firestore の挙動**: リスナー付与時は**まずキャッシュのスナップが返り、その後にサーバー確定スナップが返る**ことが多い
- **起こりうること**:
  - キャッシュのスナップは常にスキップ → 初回は「サーバーからの1回目」を待つ
  - ネットが遅い・不安定・オフライン気味だと、**サーバー確定スナップが届かない／かなり遅れる**ことがある
  - その場合、**購読からは一度も `applyShiftsToState` が呼ばれず、管理者の取り消しが画面に反映されない**

**B. 初回は getUserShiftsFromServer で取得しているが、その後の更新は購読のみ**

- 初回表示は `getUserShiftsFromServer` → `applyShiftsToState` で正しく表示される
- その後は `subscribeUserShifts` のコールバックでしか更新されない
- 上記 A のため、購読で更新が来ないと「取り消し」は永久に反映されない

**C. マージ処理の影響（可能性は低い）**

- `applyShiftsToState` 内で、`merged[d] === undefined && lastSavedShiftsRef.current[d] === undefined` のときだけ `prev` を残している
- 管理者が「取り消し」でドキュメントを削除した場合は、サーバーデータにその日が無く `merged[d]` が undefined になるが、`lastSavedShiftsRef` には入っている想定なので、** preserve されず上書きされる**動きになる
- 取り消しが「status 変更だけ」でドキュメントが残る実装なら、サーバーデータにその日が含まれるため、マージで上書きされる想定で、ここが直接の原因になる可能性は低い

**結論（事象1）**:  
**購読で `fromCache` を一律スキップしているため、サーバースナップが届かない環境では取り消しが一度も反映されない**、という原因が最も説明しやすい。

---

### 事象2: 保存・提出ができない

#### 保存・提出が「できない」の定義

- コード上では「**ボタンが disabled**」か「**押しても早期 return**」のどちらかで「できない」状態になる。

#### ボタンの無効条件（該当箇所）

- **保存ボタン**:  
  `disabled={loading || !hasEditableDays || !hasShiftsToSave || !hasChanges}`  
  （902行付近）
- **提出ボタン**:  
  `disabled={loading || !hasEditableDays || !hasShiftsToSave || !hasChanges}`  
  （907行付近）

いずれかが true だと押せない。

#### 各条件の意味

| 条件 | 定義（該当コード） |  false になりうるケース |
|------|---------------------|----------------------------|
| **hasEditableDays** | 「締切前かつ未確定かつ過去でない日」が1日でもあるか（236–238行付近） | 全曜日が `confirmedByDay[d] === true` に見えていると **false** |
| **hasShiftsToSave** | シフトが入っている日の中に、編集可能な日が1日でもあるか（543–546行付近） | 上に同じ。`confirmedByDay` が過剰に true だと **false** |
| **hasChanges** | 編集可能な日について、現在値と lastSaved の差分が1つでもあるか（548–559行付近） | 未編集 or 保存済みで差分が無いと **false** |

#### ハンドラ側のガード

- `handleSave` / `handleSubmit` の先頭で  
  `if (!user \|\| !hasEditableDays) return;`  
  があるため、**hasEditableDays が false のときは押しても何も実行されない**。

#### 事象1との関係

- **confirmedByDay** は `applyShiftsToState` 内で `setConfirmedByDay(confirmedMap)` により、**サーバー／購読で受け取ったシフト一覧からだけ**更新される
- 事象1の理由で購読が一度も反映されないと:
  - 管理者が取り消した後も、スタッフ画面の **confirmedByDay が古いまま**（取り消した日も確定のまま）
  - その結果 **hasEditableDays** が false になり、**保存・提出ボタンがずっと disabled**
  - さらに `handleSave` / `handleSubmit` の `!hasEditableDays` ガードでも return する

**結論（事象2）**:  
**「保存・提出ができない」のは、事象1（取り消しが反映されない）の結果、confirmedByDay が更新されず hasEditableDays が false のままになるため**、と説明できる。  
つまり、**事象2の主因は事象1（購読でキャッシュを捨てていること）**と考えられる。

---

## 設定（締切）まわり

- 保存・提出の「編集可能日」判定には `isDayPastDeadline` も使われており、これは **effectiveSettings**（`settings ?? DEFAULT_SETTINGS`）に依存している
- `subscribeSettings` は「サーバー確定スナップを優先し、未取得時のみキャッシュを採用」する実装になっており、**最初の1回はキャッシュで呼ばれる可能性**がある
- 締切設定がキャッシュで古いと、締切前なのに「締切後」と判定され、編集可能日が減る可能性はあるが、**「全員が保存・提出できない」ほどの影響になるかは、現状のコードだけでは断定しづらい**
- 少なくとも **「取り消しが反映されない → confirmedByDay が更新されない → 保存・提出不可」** の経路の方が、事象の説明として強い。

---

## まとめ

| 事象 | 想定主因 | 根拠 |
|------|----------|------|
| 取り消しがスタッフ画面に反映されない | `subscribeUserShifts` で **fromCache のスナップをすべてスキップ**しており、サーバースナップが届かない環境では購読から一度も状態更新されない | Firestore は初回にキャッシュを返すことが多く、その後サーバーが返らない／遅いケースがあり得る |
| 保存・提出ができない | 上記のため **confirmedByDay が更新されず**、`hasEditableDays` が false のままになる | 保存・提出ボタンの disabled 条件と handleSave/handleSubmit のガードが、いずれも hasEditableDays に依存している |

**推奨対応**:  
事象1を解消するため、**シフト購読で「キャッシュ由来を常にスキップする」処理を見直す**（例: キャッシュも一度は反映する、または「購読からの更新」のときはキャッシュ／サーバーを区別せず反映するなど）。  
その上で、必要なら「取り消し反映」と「保存・提出」の動作を実機／特定ユーザーで再確認する。
