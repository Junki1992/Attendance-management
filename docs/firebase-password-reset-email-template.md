# Firebase パスワードリセットメール 日本語テンプレート

Firebase Console でパスワードリセットメールを日本語にカスタマイズするためのテンプレートです。

---

## 設定手順

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. プロジェクトを選択
3. **Authentication** → **Templates**（テンプレート）をクリック
4. **パスワードをリセット** の鉛筆アイコンをクリック
5. **「アクション URL をカスタマイズ」** をクリック
6. 以下の URL を入力して保存：
   ```
   https://attendance-management-4bf79.web.app/reset-password
   ```
7. 下の **① 件名** と **② 本文** をそれぞれコピーして、Firebase の該当欄に貼り付け
8. 保存

---

## ① 件名（Subject）← これをコピー

```
【勤怠管理ツール】パスワードの再設定
```

---

## ② メッセージ本文（Message body）

**→ `docs/firebase-password-reset-body.txt` を開いて、全文をコピーして Firebase の本文欄に貼り付け**

※ `%LINK%` はそのまま。Firebase が自動で置き換えます。

---

## 補足

- アプリ名は `src/lib/app-config.ts` の `APP_NAME` と一致しています
- 本文は `<br>` タグで改行。HTML がそのまま表示された場合は、Firebase の制限です
- **迷惑メール対策**: 届いたメールで「迷惑メールではない」をクリックして Gmail に学習させる。恒久対策は Firebase Console → Authentication → Templates → パスワードをリセット → 「ドメインをカスタマイズ」で自社ドメインを設定
- **パスワード再設定画面**: メールのリンクはアプリの `/reset-password` に飛ぶ（Firebase デフォルト画面ではなく、当アプリのテンプレートを使用）
