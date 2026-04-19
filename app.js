const express = require("express");
const session = require("express-session");
const multer = require("multer");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const admin = require("firebase-admin");

// 🔥 تأكد إن الفولدر بيتعمل تلقائي
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// 🔥 تأكد من وجود Firebase config
if (!process.env.FIREBASE_CONFIG) {
  console.log("❌ FIREBASE_CONFIG مش موجود");
  process.exit(1);
}

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

// تهيئة Firebase
admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
});
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات رفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// 🔥 خلي Express يقرأ ملفات EJS من نفس المكان
app.set("views", __dirname);
app.set("view engine", "ejs");

// ❌ شيلنا public عشان مش عندك فولدر
// app.use(express.static("public"));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "secret-key",
  resave: false,
  saveUninitialized: true,
}));

// 🔥 Firestore Functions
async function loadResults() {
  const snapshot = await db.collection("results").get();
  return snapshot.docs.map(doc => doc.data());
}

async function addResult(result) {
  await db.collection("results").doc(result.file).set(result);
}

async function deleteResult(file) {
  await db.collection("results").doc(file).delete();
}

async function findResultsByPhone(phone) {
  const snapshot = await db.collection("results").where("phone", "==", phone).get();
  return snapshot.docs.map(doc => doc.data());
}

// إعداد البريد
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_ADDRESS,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// الصفحات
app.get("/", (req, res) => {
  res.render("index");
});

app.post("/result", async (req, res) => {
  const phone = req.body.phone;
  const filteredResults = await findResultsByPhone(phone);

  res.render("result", { 
    result: filteredResults,
    phoneNumber: phone
  });
});

app.get("/download/:filename", (req, res) => {
  const file = path.join(__dirname, "uploads", req.params.filename);
  res.download(file);
});

app.get("/view/:filename", (req, res) => {
  const file = path.join(__dirname, "uploads", req.params.filename);
  res.sendFile(file);
});

// admin
app.get("/admin", async (req, res) => {
  if (req.session.loggedIn) {
    const results = await loadResults();
    res.render("dashboard", { results });
  } else {
    res.render("login");
  }
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === (process.env.ADMIN_USERNAME || "john") &&
    password === (process.env.ADMIN_PASSWORD || "latif")
  ) {
    req.session.loggedIn = true;
    res.redirect("/admin");
  } else {
    res.send("بيانات الدخول غير صحيحة.");
  }
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin");
  });
});

app.post("/admin/upload", upload.single("pdf"), async (req, res) => {
  if (!req.session.loggedIn) return res.redirect("/admin");

  const { name, phone, email, test, notes } = req.body;
  const file = req.file.filename;

  const newResult = {
    name,
    test,
    phone,
    email,
    notes: notes || "",
    file,
    date: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })
  };

  await addResult(newResult);

  const link = `http://lab-results.up.railway.app/`;

  const mailOptions = {
    from: process.env.EMAIL_ADDRESS,
    to: email,
    subject: "نتيجة التحاليل الخاصة بك",
    text: `مرحبًا ${name}\n\nالنتيجة جاهزة:\n${link}\n${notes || ""}`,
  };

  transporter.sendMail(mailOptions, (error) => {
    if (error) console.log("❌ فشل الإيميل:", error);
    res.redirect("/admin");
  });
});

app.post("/admin/delete", async (req, res) => {
  if (!req.session.loggedIn) return res.redirect("/admin");

  const fileToDelete = req.body.file;
  await deleteResult(fileToDelete);

  const filePath = path.join(__dirname, "uploads", fileToDelete);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  res.redirect("/admin");
});

app.post("/admin/notify", async (req, res) => {
  if (!req.session.loggedIn) return res.redirect("/admin");

  const fileToNotify = req.body.file;
  const snapshot = await db.collection("results").doc(fileToNotify).get();
  const result = snapshot.data();

  if (!result) return res.send("غير موجود");

  const mailOptions = {
    from: process.env.EMAIL_ADDRESS,
    to: result.email,
    subject: "تم حذف النتيجة",
    text: `تم حذف نتيجتك. للتواصل: https://wa.me/+201274445091`,
  };

  transporter.sendMail(mailOptions, () => {
    res.redirect("/admin");
  });
});

app.listen(PORT, () => {
  console.log(`✅ شغال على http://localhost:${PORT}`);
});
