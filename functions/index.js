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

