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

// API KEYS (Yahan Quotes "" lagana zaroori tha jo pehle miss the)
const INSTA_API_KEY = "057d2350e917a1c3964a77aa1f7c6a06";
const INSTA_AUTH_TOKEN = "feb9373feeeb7f69188ea62f44d2a496";

// 👇 AGAR AAP TEST ACCOUNT (Bina real paise ke) USE KAR RAHE HAIN TO YE URL USE KAREIN 👇
const INSTA_BASE_URL = "https://test.instamojo.com/api/1.1/payment-requests/";

// 👇 AGAR AAP LIVE ACCOUNT (Real paise ke liye) USE KAR RAHE HAIN TO ISKO UNCOMMENT KAREIN AUR UPAR WALE KO HATA DEIN 👇
// const INSTA_BASE_URL = "https://www.instamojo.com/api/1.1/payment-requests/";
// 0. Base Route (Vercel par 500 Error hatane ke liye)
app.get("/", (req, res) => {
  res.send("Purnima E-Sports Backend is Running Successfully!");
});

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
        'X-Api-Key': INSTA_API_KEY,  
        'X-Auth-Token': INSTA_AUTH_TOKEN, 
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.response ? e.response.data : e.message });
  }
});

// 2. Check & Update Wallet (Secured)
app.post("/api/wallet/instamojo/check", async (req, res) => {
  try {
    const { paymentRequestId } = req.body;

    // 1. Frontend se Token lekar User ID (uid) nikalna
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized user' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // 2. Instamojo se asli payment status check karna
    const response = await axios.get(`${INSTA_BASE_URL}${paymentRequestId}/`, {
      headers: { 
        'X-Api-Key': INSTA_API_KEY, 
        'X-Auth-Token': INSTA_AUTH_TOKEN 
      }
    });

    const status = response.data.payment_request.status;
    const amount = response.data.payment_request.amount; // Asli amount API se

    if (status === 'Completed' || status === 'Credit') {
      
      // 3. Security Check: Kahi ye payment pehle add to nahi ho chuki?
      const docRef = db.collection("instamojo_txns").doc(paymentRequestId);
      const doc = await docRef.get();
      
      if (!doc.exists) {
          // Pehli baar success hua hai, wallet mein paise add karo
          await db.collection("users").doc(uid).update({
            balance: admin.firestore.FieldValue.increment(parseFloat(amount)),
            transactions: admin.firestore.FieldValue.arrayUnion({
              type: 'credit', 
              amount: parseFloat(amount), 
              msg: 'Wallet Recharge (UPI)', 
              date: Date.now()
            })
          });
          
          // Transaction ko save kar do taaki dobara paise add na hon
          await docRef.set({ processed: true, uid: uid, amount: amount, date: Date.now() });
      }

      res.json({ success: true, status: 'Credit' });
    } else {
      res.json({ success: false, status: status });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
