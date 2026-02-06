/**
 * 指定ユーザーの全データを Firestore と Storage から削除
 * 既に設定画面で削除済みのユーザーの残存データを手動で消す場合に使用
 *
 * 実行: npm run delete-user-shifts -- <userId>
 * 例: npm run delete-user-shifts -- WUWZVizaonhshHudK9omMPiguMk1
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON（Firebase サービスアカウントの JSON 文字列）
 *          または GOOGLE_APPLICATION_CREDENTIALS（サービスアカウント JSON ファイルのパス）
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const BATCH_SIZE = 500;

async function deleteCollection(db, collectionName, field, value) {
  const snapshot = await db.collection(collectionName).where(field, "==", value).get();
  if (snapshot.empty) return 0;
  let deleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach((d) => {
      batch.delete(d.ref);
      deleted++;
    });
    await batch.commit();
  }
  return deleted;
}

async function deleteMessagesAndRooms(db, userId) {
  const [senderSnap, receiverSnap] = await Promise.all([
    db.collection("messages").where("senderId", "==", userId).get(),
    db.collection("messages").where("receiverId", "==", userId).get(),
  ]);
  const roomIds = new Set();
  const docMap = new Map();
  [...senderSnap.docs, ...receiverSnap.docs].forEach((d) => {
    docMap.set(d.id, d);
    const rid = d.data().roomId;
    if (rid) roomIds.add(rid);
  });
  let messagesDeleted = 0;
  const allDocs = Array.from(docMap.values());
  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    allDocs.slice(i, i + BATCH_SIZE).forEach((d) => {
      batch.delete(d.ref);
      messagesDeleted++;
    });
    await batch.commit();
  }
  const roomRefs = Array.from(roomIds).map((roomId) => db.collection("chatRooms").doc(roomId));
  for (let i = 0; i < roomRefs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    roomRefs.slice(i, i + BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return { messages: messagesDeleted, rooms: roomRefs.length };
}

async function deleteWageHistory(db, userId) {
  const snapshot = await db.collection("users").doc(userId).collection("wageHistory").get();
  if (snapshot.empty) return 0;
  let deleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach((d) => {
      batch.delete(d.ref);
      deleted++;
    });
    await batch.commit();
  }
  return deleted;
}

async function deleteProfileImage(storage, userId) {
  try {
    const bucket = storage.bucket();
    const file = bucket.file(`profileImages/${userId}/avatar`);
    await file.delete();
    return 1;
  } catch (e) {
    if (e.code === 404 || e.code === "storage/object-not-found") return 0;
    throw e;
  }
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("使い方: npm run delete-user-shifts -- <userId>");
    console.error("例: npm run delete-user-shifts -- WUWZVizaonhshHudK9omMPiguMk1");
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
  const storage = admin.storage();

  console.log(`userId=${userId} の全データを削除します...`);

  const notifications = await deleteCollection(db, "notifications", "userId", userId);
  console.log(`  通知: ${notifications} 件`);

  const shiftChangeRequests = await deleteCollection(db, "shiftChangeRequests", "userId", userId);
  console.log(`  シフト変更申請: ${shiftChangeRequests} 件`);

  const { messages, rooms } = await deleteMessagesAndRooms(db, userId);
  console.log(`  メッセージ: ${messages} 件, チャットルーム: ${rooms} 件`);

  const wageHistory = await deleteWageHistory(db, userId);
  console.log(`  時給履歴: ${wageHistory} 件`);

  const shifts = await deleteCollection(db, "shifts", "userId", userId);
  console.log(`  シフト: ${shifts} 件`);

  let profileImage = 0;
  try {
    profileImage = await deleteProfileImage(storage, userId);
    if (profileImage) console.log(`  プロフィール画像: 1 件`);
  } catch (e) {
    console.warn(`  プロフィール画像: スキップ (${e.message})`);
  }

  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    await userRef.delete();
    console.log(`  ユーザードキュメント: 1 件`);
  } else {
    console.log(`  ユーザードキュメント: 既に削除済み`);
  }

  console.log(`完了しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
