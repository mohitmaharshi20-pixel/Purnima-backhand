// ============================================================
//  PURNIMA E-SPORTS — FINAL STABLE BACKEND (QR FIXED)
// ============================================================

const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
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

// 2. Cashfree Config (Testing Mode - Sandbox)
const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET = process.env.CASHFREE_SECRET_KEY;
const CF_URL = "https://sandbox.cashfree.com/pg"; 

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

// --- API ROUTES ---

app.get("/api", (req, res) => {
  res.status(200).json({ success: true, message: "Backend Live! ✅" });
});

// Create Order & Get QR Code (FIXED VERSION)
app.post("/api/wallet/createQR", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 1) return res.status(400).json({ error: "Min ₹1 required" });

    const orderId = `ORD_${uid.slice(0, 5)}_${Date.now()}`;

    // STEP 1: Order Create
    const orderResponse = await axios.post(
      `${CF_URL}/orders`,
      {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        order_expiry_time: new Date(Date.now() + 20 * 60000).toISOString(),
        customer_details: {
          customer_id: uid,
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

    const sessionId = orderResponse.data.payment_session_id;

    // STEP 2: Session Pay API (QR FIXED)
    const qrResponse = await axios.post(
      `${CF_URL}/orders/sessions/pay`, 
      {
        payment_session_id: sessionId,
        payment_method: {
          upi: { channel: "qrcode" }
        }
      },
      {
        headers: {
          "x-api-version": "2023-08-01",
          "Content-Type": "application/json",
        },
      }
    );

    // STEP 3: Firestore Transaction
    await db.collection("transactions").doc(orderId).set({
      userId: uid,
      amount,
      status: "PENDING",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      orderId: orderId,
      qrData: qrResponse.data.data.payload.qrcode,
    });

  } catch (e) {
    const errorMsg = e.response && e.response.data ? e.response.data : e.message;
    res.status(500).json({ error: JSON.stringify(errorMsg) });
  }
});

// Verify Payment
app.post("/api/wallet/verifyOrder", async (req, res) => {
  const uid = await verifyToken(req, res);
  if (!uid) return;

  try {
    const { orderId } = req.body;
    const cfRes = await axios.get(`${CF_URL}/orders/${orderId}`, {
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
          balance: admin.firestore.FieldValue.increment(txn.data().amount),
        });
      }
    }
    res.json({ status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
