// ============================================================
//  PURNIMA E-SPORTS — FINAL PRODUCTION BACKEND (VERCEL)
// ============================================================

const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

// Cashfree Webhook ke liye raw body zaroori hai
app.use("/api/webhook/cashfree", express.raw({ type: "application/json" }));
app.use(express.json());

// 1. Firebase Admin Initialization (Vercel Serverless Fix)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Private Key formatting fix
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();

// 2. Cashfree Config (Using your 5 variables)
const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET = process.env.CASHFREE_SECRET_KEY;
const CF_BASE_URL = "https://api.cashfree.com/pg"; // Production URL

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
  return uid.slice(0, 6).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// --- API ROUTES ---

// Test Route: Check if live
app.get("/api", (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: "Purnima Backend Live! ✅",
    status: "Ready for requests"
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
    if (!amount || amount < 1) return res.status(400).json({ error: "Min ₹1 required" });

    const orderId = `ORD_${uid.slice(0, 6)}_${Date.now()}`;
    
    const cfRes = await axios.post(`${CF_BASE_URL}/orders`, {
      order_id: orderId,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: uid,
        customer_email: "user@purnima.com",
        customer_phone: "9999999999"
      }
    }, {
      headers: {
        "x-client-id": CF_APP_ID,
        "x-client-secret": CF_SECRET,
        "x-api-version": "2023-08-01",
        "Content-Type": "application/json"
      }
    });

    await db.collection("transactions").doc(orderId).set({
      userId: uid,
      amount,
      status: "PENDING",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ sessionId: cfRes.data.payment_session_id, orderId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export for Vercel
module.exports = app;
