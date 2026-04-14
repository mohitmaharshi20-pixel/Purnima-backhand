// ============================================================
//  PURNIMA E-SPORTS \u2014 PRODUCTION BACKEND
//  Stack: Node.js + Express + Firebase Admin + Cashfree
//  Deploy: Render / Railway / Vercel (serverless)
// ============================================================

const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

// \u2500\u2500 Raw body for webhook signature verification \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
app.use(
  "/webhook/cashfree",
  express.raw({ type: "application/json" })
);
app.use(express.json());

// ============================================================
//  ENV VARIABLES (set in Render / Railway dashboard)
//  FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//  CASHFREE_APP_ID, CASHFREE_SECRET_KEY
//  CASHFREE_WEBHOOK_SECRET
//  ADMIN_UID
// ============================================================

// \u2500\u2500 Firebase Admin Init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// \u2500\u2500 Cashfree Config \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET = process.env.CASHFREE_SECRET_KEY;
const CF_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET;
const CF_BASE_URL = "https://api.cashfree.com/pg"; // production

// ============================================================
//  HELPERS
// ============================================================

// Verify Firebase ID token \u2192 returns uid
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
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

// Require admin role
async function requireAdmin(uid, res) {
  if (uid !== process.env.ADMIN_UID) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// Generate referral code
function genReferralCode(uid) {
  return uid.slice(0, 6).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// ============================================================
//  POST /auth/signup
// ============================================================
app.post("/auth/signup", async (req, res) => {
  try {
    const { uid, username, email, referralCode } = req.body;

    if (!uid || !username || !email) {
      return res.status(400).json({ error: "uid, username, email required" });
    }

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    if (snap.exists) {
      return res.json({ success: true, message: "User already exists" });
    }

    const newUser = {
      username: String(username).trim(),
      email: String(email).trim(),
      wallet: 0,
      totalXP: 0,
      joinedMatches: [],
      referralCode: genReferralCode(uid),
      referredBy: null,
      matchesPlayed: 0,
      totalKills: 0,
      dailyStreak: 0,
      isVIP: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Handle referral
    if (referralCode) {
      const refSnap = await db
        .collection("users")
        .where("referralCode", "==", referralCode)
        .limit(1)
        .get();

      if (!refSnap.empty) {
        const refUid = refSnap.docs[0].id;
        newUser.referredBy = refUid;

        // Bonus to referrer
        await db.collection("users").doc(refUid).update({
          wallet: admin.firestore.FieldValue.increment(20),
        });
      }
    }

    await userRef.set(newUser);
    return res.json({ success: true });
  } catch (e) {
    console.error("/auth/signup", e);
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  POST /wallet/createOrder  (Cashfree order create)
// ============================================================
app.post("/wallet/createOrder", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Minimum amount is \u20b91" });
    }

    const orderId = `ORD_${uid.slice(0, 6)}_${Date.now()}`;

    // Get user info
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });
    const user = userSnap.data();

    // Create Cashfree order
    const cfRes = await axios.post(
      `${CF_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: uid,
          customer_email: user.email,
          customer_phone: "9999999999", // Cashfree requires phone
        },
        order_meta: {
          notify_url: `${process.env.BACKEND_URL}/webhook/cashfree`,
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

    const sessionId = cfRes.data.payment_session_id;

    // Save PENDING transaction in Firestore
    await db.collection("transactions").doc(orderId).set({
      userId: uid,
      type: "deposit",
      amount,
      orderId,
      status: "PENDING",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ orderId, sessionId });
  } catch (e) {
    console.error("/wallet/createOrder", e?.response?.data || e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  POST /webhook/cashfree  (ONLY place wallet is credited)
// ============================================================
app.post("/webhook/cashfree", async (req, res) => {
  try {
    // \u2500\u2500 Signature Verification \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const rawBody = req.body; // Buffer (raw middleware)
    const receivedSig = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];

    if (!receivedSig || !timestamp) {
      return res.status(400).json({ error: "Missing signature headers" });
    }

    const signed
