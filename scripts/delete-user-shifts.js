/**
 * 指定ユーザーの全シフトを Firestore から削除
 * 実行: npm run delete-user-shifts -- <userId>
 * 例: npm run delete-user-shifts -- WUWZVizaonhshHudK9omMPiguMk1
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON（Firebase サービスアカウントの JSON 文字列）
 *          または GOOGLE_APPLICATION_CREDENTIALS（サービスアカウント JSON ファイルのパス）
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("使い方: node scripts/delete-user-shifts.js <userId>");
    console.error("例: node scripts/delete-user-shifts.js WUWZVizaonhshHudK9omMPiguMk1");
    process.exit(1);
  }

  let cred;
  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credJson) {
    cred = JSON.parse(credJson);
  } else if (credPath && fs.existsSync(path.resolve(credPath))) {
    cred = JSON.parse(fs.readFileSync(path.resolve(credPath), "utf8"));
  } else {
    console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS を設定してください");
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  const db = admin.firestore();

  const snapshot = await db.collection("shifts").where("userId", "==", userId).get();
  if (snapshot.empty) {
    console.log(`userId=${userId} のシフトは見つかりませんでした。`);
    return;
  }

  const BATCH_SIZE = 500;
  let deleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((d) => {
      batch.delete(d.ref);
      deleted++;
    });
    await batch.commit();
  }
  console.log(`userId=${userId} のシフト ${deleted} 件を削除しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
