const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

admin.initializeApp();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// POST /markLastRead
// body: { roomId: string, uid: string }
app.post('/markLastRead', async (req, res) => {
  try {
    const { roomId, uid } = req.body || {};
    if (!roomId || !uid) {
      return res.status(400).json({ error: 'roomId and uid required' });
    }

    const ref = admin.firestore().doc(`chatRooms/${roomId}`);
    await ref.set({ lastReadBy: { [uid]: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('markLastRead error', err);
    return res.status(500).json({ error: String(err) });
  }
});

exports.api = functions.https.onRequest(app);

// Scheduled function: 締切日当日の朝に未提出者へ催促通知を自動送信する
exports.scheduledRemindSubmit = functions.pubsub
  .schedule('0 9 * * *') // 毎日 09:00 JST に実行（timezone below）
  .timeZone('Asia/Tokyo')
  .onRun(async (context) => {
    try {
      const db = admin.firestore();

      // 設定を取得（defaults.shiftSubmitDeadlineDay = 25）
      const settingsRef = db.doc('settings/app');
      const settingsSnap = await settingsRef.get();
      const shiftSubmitDeadlineDay = (settingsSnap.exists && settingsSnap.data().shiftSubmitDeadlineDay) ? settingsSnap.data().shiftSubmitDeadlineDay : 25;

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); // 0-indexed
      const lastDay = new Date(year, month + 1, 0).getDate();
      const deadlineDay = Math.min(shiftSubmitDeadlineDay, lastDay);

      // 本日が締切日でなければ何もしない
      if (now.getDate() !== deadlineDay) {
        console.log('[scheduledRemindSubmit] not deadline day, skip', { today: now.getDate(), deadlineDay });
        return null;
      }

      // 対象月の範囲を構築
      const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // スタッフ一覧を取得
      const usersSnap = await db.collection('users').where('role', '==', 'staff').get();
      const staff = usersSnap.docs.map((d) => ({ id: d.id, name: (d.data() && d.data().name) ? d.data().name : d.id }));
      if (staff.length === 0) {
        console.log('[scheduledRemindSubmit] no staff found');
        return null;
      }

      // 既に提出済み/確定のユーザーを取得
      const shiftsSnap = await db.collection('shifts')
        .where('date', '>=', startStr)
        .where('date', '<=', endStr)
        .get();
      const submitted = new Set();
      shiftsSnap.docs.forEach((d) => {
        const data = d.data();
        if (!data) return;
        if (data.status === 'submitted' || data.status === 'confirmed') {
          if (data.userId) submitted.add(data.userId);
        }
      });

      // 未提出者へ通知を作成
      let createdCount = 0;
      const promises = [];
      staff.forEach((s) => {
        if (!submitted.has(s.id)) {
          const message = `${month + 1}月のシフト提出がまだです。お早めに提出してください。`;
          promises.push(
            db.collection('notifications').add({
              userId: s.id,
              type: 'remind_submit',
              message,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }).then(() => { createdCount += 1; }).catch((e) => console.error('[scheduledRemindSubmit] notif add failed', s.id, e))
          );
        }
      });

      await Promise.all(promises);
      console.log('[scheduledRemindSubmit] finished', { year, month: month + 1, deadlineDay, createdCount });
      return null;
    } catch (err) {
      console.error('[scheduledRemindSubmit] error', err);
      return null;
    }
  });
