const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Firebase Initialization
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") : undefined,
    }),
  });
}
const db = admin.firestore();

// API KEYS
const INSTA_API_KEY = "057d2350e917a1c3964a77aa1f7c6a06";
const INSTA_AUTH_TOKEN = "feb9373feeeb7f69188ea62f44d2a496";
const INSTA_BASE_URL = "https://www.instamojo.com/api/1.1/payment-requests/"; // Corrected URL

// 1. Create Payment
app.post("/api/wallet/instamojo/create", async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('purpose', 'Wallet Recharge');
    params.append('amount', req.body.amount);
    params.append('buyer_name', 'Player');
    params.append('email', 'user@example.com');
    params.append('send_email', 'False');
    params.append('allow_repeated_payments', 'False');

    const response = await axios.post(INSTA_BASE_URL, params, {
      headers: {
        'X-Api-Key':   057d2350e917a1c3964a77aa1f7c6a06  ,
        'X-Auth-Token': feb9373feeeb7f69188ea62f44d2a496 ,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.response ? e.response.data : e.message });
  }
});

// 2. Check & Update Wallet
app.post("/api/wallet/instamojo/check", async (req, res) => {
  try {
    const { paymentRequestId, uid, amount } = req.body;
    const response = await axios.get(`${INSTA_BASE_URL}${paymentRequestId}/`, {
      headers: { 'X-Api-Key':  057d2350e917a1c3964a77aa1f7c6a06    , 'X-Auth-Token': feb9373feeeb7f69188ea62f44d2a496  }
    });

    const status = response.data.payment_request.status;
    if (status === 'Completed') {
      await db.collection("users").doc(uid).update({
        balance: admin.firestore.FieldValue.increment(parseFloat(amount)),
        transactions: admin.firestore.FieldValue.arrayUnion({
          type: 'credit', amount: parseFloat(amount), msg: 'Wallet Recharge', date: Date.now()
        })
      });
      res.json({ success: true, status: 'Completed' });
    } else {
      res.json({ success: false, status: status });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
