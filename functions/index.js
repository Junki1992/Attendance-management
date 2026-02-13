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
// 設定（settings/app）の firstBlockDeadlineDay / secondBlockDeadlineDay および deadlineOverrides に従う
const DEADLINE_DEFAULTS = { firstBlockDeadlineDay: 25, secondBlockDeadlineDay: 10 };

exports.scheduledRemindSubmit = functions.pubsub
  .schedule('0 9 * * *') // 毎日 09:00 JST に実行
  .timeZone('Asia/Tokyo')
  .onRun(async (context) => {
    try {
      const db = admin.firestore();
      const now = new Date();
      const today = now.getDate();
      const year = now.getFullYear();
      const month = now.getMonth();

      const settingsSnap = await db.collection('settings').doc('app').get();
      const settings = settingsSnap.exists() ? { ...DEADLINE_DEFAULTS, ...settingsSnap.data() } : DEADLINE_DEFAULTS;
      const firstDay = settings.firstBlockDeadlineDay ?? 25;
      const secondDay = settings.secondBlockDeadlineDay ?? 10;
      const overrides = settings.deadlineOverrides || {};

      const tasks = [];
      if (today === firstDay) {
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        tasks.push({
          startStr: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`,
          endStr: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-15`,
          message: '来月1～15日分のシフト提出は本日が締切です。お早めに提出してください。',
        });
      }
      if (today === secondDay) {
        const lastDay = new Date(year, month + 1, 0).getDate();
        tasks.push({
          startStr: `${year}-${String(month + 1).padStart(2, '0')}-16`,
          endStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
          message: '当月16日～月末分のシフト提出は本日が締切です。お早めに提出してください。',
        });
      }
      Object.entries(overrides).forEach(([key, value]) => {
        if (!value) return;
        const deadlineDate = new Date(value);
        if (Number.isNaN(deadlineDate.getTime())) return;
        if (deadlineDate.getFullYear() !== year || deadlineDate.getMonth() !== month || deadlineDate.getDate() !== today) return;
        const match = key.match(/^(\d{4})-(\d{2})_(first|second)$/);
        if (!match) return;
        const [, y, m, block] = match;
        const monthNum = parseInt(m, 10);
        const yearNum = parseInt(y, 10);
        if (block === 'first') {
          tasks.push({
            startStr: `${yearNum}-${m}-01`,
            endStr: `${yearNum}-${m}-15`,
            message: `${yearNum}年${monthNum}月1～15日分のシフト提出は本日が締切です。お早めに提出してください。`,
          });
        } else {
          const lastDay = new Date(yearNum, monthNum, 0).getDate();
          tasks.push({
            startStr: `${yearNum}-${m}-16`,
            endStr: `${yearNum}-${m}-${String(lastDay).padStart(2, '0')}`,
            message: `${yearNum}年${monthNum}月16日～月末分のシフト提出は本日が締切です。お早めに提出してください。`,
          });
        }
      });

      if (tasks.length === 0) {
        console.log('[scheduledRemindSubmit] not deadline day, skip', { today });
        return null;
      }

      const usersSnap = await db.collection('users').where('role', '==', 'staff').get();
      const staff = usersSnap.docs.map((d) => ({ id: d.id, name: (d.data() && d.data().name) ? d.data().name : d.id }));
      if (staff.length === 0) {
        console.log('[scheduledRemindSubmit] no staff found');
        return null;
      }

      let totalCreated = 0;
      for (const { startStr, endStr, message } of tasks) {
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
        const promises = [];
        staff.forEach((s) => {
          if (!submitted.has(s.id)) {
            promises.push(
              db.collection('notifications').add({
                userId: s.id,
                type: 'remind_submit',
                message,
                read: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              }).then(() => { totalCreated += 1; }).catch((e) => console.error('[scheduledRemindSubmit] notif add failed', s.id, e))
            );
          }
        });
        await Promise.all(promises);
      }
      console.log('[scheduledRemindSubmit] finished', { totalCreated });
      return null;
    } catch (err) {
      console.error('[scheduledRemindSubmit] error', err);
      return null;
    }
  });
