// ============================================================
//  PURNIMA E-SPORTS — FINAL STABLE BACKEND (INSTAMOJO ADDED)
// ============================================================

const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// 1. Firebase Admin Initialization (आपका पुराना सही कोड)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
    }),
  });
}

const db = admin.firestore();

// --- HELPERS ---
async function verifyToken(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return null;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

function genReferralCode(uid) {
  return (uid.slice(0, 6).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase());
}

// ============================================================
// 🔴 INSTAMOJO API KEYS (यहाँ अपनी Keys डालें) 🔴
// ============================================================
const INSTA_API_KEY = "057d2350e917a1c3964a77aa1f7c6a06";         // अपनी API Key डालें
const INSTA_AUTH_TOKEN = "feb9373feeeb7f69188ea62f44d2a496";   // अपना Auth Token डालें
const INSTA_BASE_URL = "https://api.instamojo.com/v2/payment_requests/"; // Live URL

// --- API ROUTES ---

app.get("/api", (req, res) => {
  res.status(200).json({ success: true, message: "Backend with Instamojo is Live ✅" });
});

// ✅ 1. SIGNUP & REFERRAL (आपका पुराना कोड)
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { uid, username, email } = req.body;
    if (!uid || !username || !email) return res.status(400).json({ error: "Details missing" });

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    if (snap.exists) return res.json({ success: true, message: "User exists" });

    const newUser = {
      name: String(username).trim(),
      email: String(email).trim(),
      balance: 0, 
      wallet: 0,
      referralCode: genReferralCode(uid),
      transactions: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await userRef.set(newUser);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ 2. INSTAMOJO: CREATE PAYMENT LINK & QR
app.post("/api/wallet/instamojo/create", async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    const phone = req.body.phone || "9999999999";
    
    if (!amount || amount < 10) return res.status(400).json({ error: "Min ₹10 required" });

    const response = await axios.post(INSTA_BASE_URL, {
      purpose: "Wallet Recharge",
      amount: amount,
      buyer_name: "Gamer",
      email: "user@purnima.com",
      phone: phone,
      send_email: false,
      send_sms: false,
      allow_repeated_payments: false
    }, {
      headers: {
        'X-Api-Key': INSTA_API_KEY,
        'X-Auth-Token': INSTA_AUTH_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (e) {
    const errorData = e.response && e.response.data ? e.response.data : e.message;
    res.status(500).json({ error: errorData });
  }
});

// ✅ 3. INSTAMOJO: CHECK STATUS & ADD MONEY TO FIREBASE
app.post("/api/wallet/instamojo/check", async (req, res) => {
  try {
    const { paymentId, uid, amount } = req.body;
    if (!paymentId || !uid || !amount) return res.status(400).json({ error: "Missing data" });

    // Instamojo से पूछें पेमेंट हुई या नहीं
    const response = await axios.get(`${INSTA_BASE_URL}${paymentId}/`, {
      headers: {
        'X-Api-Key': INSTA_API_KEY,
        'X-Auth-Token': INSTA_AUTH_TOKEN
      }
    });

    const status = response.data.payment_request.status;

    // अगर पेमेंट सक्सेसफुल हो गई (Completed)
    if (status === 'Completed') {
      const txId = response.data.payment_request.payments[0].payment_id;
      
      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

      const txns = userDoc.data().transactions || [];
      
      // चेक करें कि ये पैसे पहले तो ऐड नहीं हो गए (ताकि डबल पैसा ऐड ना हो)
      const alreadyAdded = txns.find(t => t.paymentId === txId);
      
      if (!alreadyAdded) {
        // सुरक्षित तरीके से वॉलेट में पैसे डालें
        await userRef.update({
          balance: admin.firestore.FieldValue.increment(amount),
          transactions: admin.firestore.FieldValue.arrayUnion({
            type: 'credit',
            amount: amount,
            msg: 'Wallet Recharge',
            status: 'success',
            date: Date.now(),
            paymentId: txId // यह ID सेव कर ली ताकि दोबारा पैसे ऐड ना हों
          })
        });
        return res.json({ status: 'Credit' }); // पैसे जुड़ गए!
      } else {
        return res.json({ status: 'Already_Credited' });
      }
    } else {
      res.json({ status: 'Pending' });
    }
  } catch (e) {
    res.status(500).json({ error: "Check Error" });
  }
});

module.exports = app;
