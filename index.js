// ============================================================
//  PURNIMA E-SPORTS — FINAL STABLE BACKEND (FULLY REPAIRED)
// ============================================================

const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// 1. Firebase Admin Initialization
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

// 2. Cashfree Config (Sandbox Mode for Testing)
const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET = process.env.CASHFREE_SECRET_KEY;
const CF_BASE_URL = "https://sandbox.cashfree.com/pg"; 

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
  return (
    uid.slice(0, 6).toUpperCase() +
    Math.random().toString(36).slice(2, 5).toUpperCase()
  );
}

// --- API ROUTES ---

// Test Route
app.get("/api", (req, res) => {
  res.status(200).json({ success: true, message: "Backend Full & Stable ✅" });
});

// ✅ 1. SIGNUP & REFERRAL (जो पहले गायब लग रहा था)
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
      wallet: 0, // दोनों नाम रख दिए ताकि ऐप कंफ्यूज न हो
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

// ✅ 3. FIXED CREATE QR CODE (STABLE SESSION-PAY VERSION)
app.post("/api/wallet/createQR", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 1) return res.status(400).json({ error: "Min ₹1 required" });

    const orderId = `ORD_QR_${uid.slice(0, 5)}_${Date.now()}`;

    // STEP A: Order Create (Session ID लेने के लिए)
    const orderRes = await axios.post(
      "https://sandbox.cashfree.com/pg/orders",
      {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: uid,
          customer_phone: "9999999999",
          customer_name: "App User"
        },
        order_expiry_time: new Date(Date.now() + 60 * 60000).toISOString(),
      },
      {
        headers: {
          "x-client-id": CF_APP_ID,
          "x-client-secret": CF_SECRET,
          "x-api-version": "2023-08-01",
          "Content-Type": "application/json"
        }
      }
    );

    const sessionId = orderRes.data.payment_session_id;

// STEP B: Get QR Code (USING SESSIONS-PAY URL)
    // सबसे ज़रूरी: यहाँ headers में ID और Secret नहीं भेजने हैं!
    const payRes = await axios.post(
      "https://sandbox.cashfree.com/pg/orders/sessions",
      {
        payment_session_id: sessionId,
        payment_method: { upi: { channel: "qrcode" } }
      },
      {
        headers: {
          "x-api-version": "2023-08-01",
          "Content-Type": "application/json"
        },
      }
    );

    // Save to Database
    await db.collection("transactions").doc(orderId).set({
      userId: uid,
      amount: amount,
      status: "PENDING",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      orderId: orderId,
      qrData: payRes.data.data.payload.qrcode, 
    });

  } catch (e) {
    const errorData = e.response && e.response.data ? e.response.data : e.message;
    res.status(500).json({ error: JSON.stringify(errorData) });
  }
});

// ✅ 4. VERIFY ORDER & ADD MONEY
app.post("/api/wallet/verifyOrder", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const { orderId } = req.body;
    const cfRes = await axios.get(`https://sandbox.cashfree.com/pg/orders/${orderId}`, {
      headers: {
        "x-client-id": CF_APP_ID,
        "x-client-secret": CF_SECRET,
        "x-api-version": "2023-08-01",
      },
    });

    if (cfRes.data.order_status === "PAID") {
      const txnRef = db.collection("transactions").doc(orderId);
      const txn = await txnRef.get();
      
      if (txn.exists && txn.data().status !== "PAID") {
        await txnRef.update({ status: "PAID" });
        
        await db.collection("users").doc(uid).update({
          balance: admin.firestore.FieldValue.increment(txn.data().amount),
          wallet: admin.firestore.FieldValue.increment(txn.data().amount),
          transactions: admin.firestore.FieldValue.arrayUnion({
            type: 'credit',
            amount: txn.data().amount,
            msg: 'Cash Added (QR)',
            date: Date.now()
          })
        });
      }
    }
    res.json({ status: cfRes.data.order_status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
