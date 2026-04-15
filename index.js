// ============================================================
//  PURNIMA E-SPORTS — FINAL PRODUCTION BACKEND (VERCEL)
// ============================================================

const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(cors({ origin: "*" }));

// Cashfree Webhook ke liye raw body zaroori hai
app.use("/api/webhook/cashfree", express.raw({ type: "application/json" }));
app.use(express.json());

// 1. Firebase Admin Initialization (Vercel Serverless Fix)
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

// 2. Cashfree Config
const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET = process.env.CASHFREE_SECRET_KEY;
// नया कोड (टेस्टिंग के लिए)
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

// Test Route: Check if live
app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Purnima Backend Live! ✅",
    status: "Ready for requests",
  });
});

// Signup Route
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { uid, username, email, referralCode } = req.body;
    if (!uid || !username || !email) {
      return res.status(400).json({ error: "Details missing" });
    }

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    if (snap.exists) return res.json({ success: true, message: "User exists" });

    const newUser = {
      username: String(username).trim(),
      email: String(email).trim(),
      wallet: 0,
      referralCode: genReferralCode(uid),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await userRef.set(newUser);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create Order Route
app.post("/api/wallet/createOrder", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 1)
      return res.status(400).json({ error: "Min ₹1 required" });

    const orderId = `ORD_${uid.slice(0, 6)}_${Date.now()}`;

    const cfRes = await axios.post(
      `${CF_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: uid,
          customer_email: "user@purnima.com",
          customer_phone: "9999999999",
        },
      },
      {
        headers: {
          "x-client-id": CF_APP_ID,
          "x-client-secret": CF_SECRET,
          "x-api-version": "2023-08-01",
          "Content-Type": "application/json",
        },
      }
    );

    await db.collection("transactions").doc(orderId).set({
      userId: uid,
      amount,
      status: "PENDING",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ sessionId: cfRes.data.payment_session_id, orderId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Verify Order Route (NAYA)
app.post("/api/wallet/verifyOrder", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const { orderId } = req.body;
    if (!orderId)
      return res.status(400).json({ error: "Order ID missing" });

    const cfRes = await axios.get(`${CF_BASE_URL}/orders/${orderId}`, {
      headers: {
        "x-client-id": CF_APP_ID,
        "x-client-secret": CF_SECRET,
        "x-api-version": "2023-08-01",
      },
    });

    const status = cfRes.data.order_status;

    if (status === "PAID") {
      const txnRef = db.collection("transactions").doc(orderId);
      const txn = await txnRef.get();
      if (txn.exists && txn.data().status !== "PAID") {
        await txnRef.update({ status: "PAID" });
        await db.collection("users").doc(uid).update({
          wallet: admin.firestore.FieldValue.increment(txn.data().amount),
        });
      }
    }

    res.json({ status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export for Vercel
module.exports = app;
