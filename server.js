import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { Readable } from "stream";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// ============================
// PING ROUTE
// ============================
app.get("/ping", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), uptime: Math.floor(process.uptime()) });
});

// Block old admin URL
app.get("/xadmin.html", (req, res) => res.status(404).send("Not found"));

// ============================
// MONGODB
// ============================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// GridFS bucket (set after connection)
let gfsBucket;
mongoose.connection.once("open", () => {
  gfsBucket = new GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });
  console.log("✅ GridFS ready");
});

// ============================
// SCHEMAS
// ============================
const userSchema = new mongoose.Schema({
  username:        { type: String, required: true },
  email:           { type: String, required: true, unique: true },
  password:        { type: String, required: true },
  role:            { type: String, default: "user" },
  status:          { type: String, default: "active" },
  aiPoints:        { type: Number, default: 5 },
  aiPointsResetAt: { type: Date, default: () => new Date(Date.now() + 24*60*60*1000) },
  aiUsageCount:    { type: Number, default: 0 },
  purchasedPdfs:   { type: [String], default: [] },
  createdAt:       { type: Date, default: Date.now },
  lastLogin:       { type: Date, default: Date.now }
});

const pdfSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  description:  { type: String, default: "" },
  category:     { type: String, required: true },
  subject:      { type: String, default: "" },
  semester:     { type: String, default: "" },
  access:       { type: String, default: "public" },
  price:        { type: Number, default: 0 },
  // GridFS file IDs
  fileId:       { type: mongoose.Schema.Types.ObjectId },
  thumbnailId:  { type: mongoose.Schema.Types.ObjectId },
  // Keep old fields for backward compatibility
  filename:     { type: String, default: "" },
  originalName: { type: String, default: "" },
  fileSize:     { type: Number, default: 0 },
  fileType:     { type: String, default: "pdf" },
  thumbnail:    { type: String, default: "" },
  downloads:    { type: Number, default: 0 },
  views:        { type: Number, default: 0 },
  uploadedBy:   { type: String },
  uploadedAt:   { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  name:       { type: String, required: true },
  department: { type: String, default: "" },
  pdfCount:   { type: Number, default: 0 },
  createdAt:  { type: Date, default: Date.now }
});

const logSchema = new mongoose.Schema({
  type:      String,
  message:   String,
  userId:    { type: String, default: null },
  details:   { type: Object, default: {} },
  timestamp: { type: Date, default: Date.now }
});

const notifSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  message:    { type: String, required: true },
  type:       { type: String, default: "announcement" },
  sentBy:     String,
  recipients: { type: Number, default: 0 },
  sentAt:     { type: Date, default: Date.now }
});

const aiChatSchema = new mongoose.Schema({
  userId:    { type: String, required: true },
  question:  { type: String, required: true },
  answer:    { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  value:     { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const paymentSchema = new mongoose.Schema({
  userId:             { type: String, required: true },
  pdfId:              { type: String, required: true },
  pdfTitle:           { type: String },
  amount:             { type: Number, required: true },
  phone:              { type: String, required: true },
  checkoutRequestId:  { type: String },
  merchantRequestId:  { type: String },
  status:             { type: String, default: "pending" },
  mpesaReceiptNumber: { type: String, default: "" },
  createdAt:          { type: Date, default: Date.now },
  completedAt:        { type: Date }
});

const User         = mongoose.model("User",         userSchema);
const PDF          = mongoose.model("PDF",          pdfSchema);
const Category     = mongoose.model("Category",     categorySchema);
const ActivityLog  = mongoose.model("ActivityLog",  logSchema);
const Notification = mongoose.model("Notification", notifSchema);
const AiChat       = mongoose.model("AiChat",       aiChatSchema);
const Settings     = mongoose.model("Settings",     settingsSchema);
const Payment      = mongoose.model("Payment",      paymentSchema);

// APK Settings stored in Settings collection
// key: "apk_version", value: "1.0.0"
// key: "apk_url", value: "https://..."
// key: "apk_size", value: "12.5 MB"
// key: "apk_changelog", value: "..."


// APK Settings stored in Settings collection
// key: "apk_version", value: "1.0.0"
// key: "apk_url", value: "https://..."
// key: "apk_size", value: "12.5 MB"
// key: "apk_changelog", value: "..."


// ============================
// ALLOWED FILE TYPES
// ============================
const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};

const IMAGE_TYPES = ["image/jpeg","image/png","image/webp","image/gif"];

// ============================
// MULTER — memory storage (files go to GridFS)
// ============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ============================
// GRIDFS HELPERS
// ============================
async function uploadToGridFS(buffer, filename, mimetype) {
  return new Promise((resolve, reject) => {
    const readableStream = Readable.from(buffer);
    const uploadStream   = gfsBucket.openUploadStream(filename, {
      contentType: mimetype,
      metadata: { uploadedAt: new Date() }
    });
    readableStream.pipe(uploadStream);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.on("error",  reject);
  });
}

async function deleteFromGridFS(fileId) {
  try {
    if (fileId) await gfsBucket.delete(new mongoose.Types.ObjectId(fileId));
  } catch(e) { console.log("GridFS delete error:", e.message); }
}

// ============================
// SEED CATEGORIES
// ============================
async function seedCategories() {
  const count = await Category.countDocuments();
  if (count === 0) {
    await Category.insertMany([
      { name: "Nursing",                department: "Nursing" },
      { name: "Biomedical Engineering", department: "Biomedical" },
      { name: "Radiography",            department: "Radiography" },
      { name: "EMT",                    department: "EMT" },
      { name: "Clinical",               department: "Clinical" }
    ]);
    console.log("✅ Default categories seeded");
  }
}

// ============================
// HELPERS
// ============================
async function logActivity(type, message, userId = null, details = {}) {
  try { await ActivityLog.create({ type, message, userId, details }); } catch {}
}

// ============================
// EMAIL
// ============================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 587, secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
});

// ============================
// MIDDLEWARES
// ============================
function adminAuth(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token) return res.json({ success: false, message: "Unauthorized" });
  try {
    const [adminId] = Buffer.from(token, "base64").toString().split(":");
    if (adminId !== "admin001") return res.json({ success: false, message: "Invalid token" });
    next();
  } catch { return res.json({ success: false, message: "Invalid token" }); }
}

async function userAuth(req, res, next) {
  const token = req.headers["x-user-token"];
  if (!token) return res.json({ success: false, message: "Please login first" });
  try {
    const [userId] = Buffer.from(token, "base64").toString().split(":");
    const user = await User.findById(userId);
    if (!user)                       return res.json({ success: false, message: "User not found" });
    if (user.status === "suspended") return res.json({ success: false, message: "Account suspended" });
    req.user = user;
    next();
  } catch { return res.json({ success: false, message: "Invalid token" }); }
}

// ============================
// PUBLIC ROUTES
// ============================
app.get("/", (req, res) => res.sendFile(process.cwd() + "/public/index.html"));

// ── SERVE FILES FROM GRIDFS ──
app.get("/api/files/:fileId", async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.fileId);
    const files  = await gfsBucket.find({ _id: fileId }).toArray();
    if (!files.length) return res.status(404).json({ success: false, message: "File not found" });
    const file = files[0];
    res.set("Content-Type", file.contentType || "application/octet-stream");
    res.set("Content-Length", file.length);
    gfsBucket.openDownloadStream(fileId).pipe(res);
  } catch(e) {
    res.status(404).json({ success: false, message: "File not found" });
  }
});

// ── REGISTER ──
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.json({ success: false, message: "All fields required" });
    if (await User.findOne({ email }))
      return res.json({ success: false, message: "Account already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ username, email, password: hashed });
    await logActivity("register", `Registered: ${email}`, user._id.toString());
    res.json({ success: true, message: "Account created successfully" });
  } catch (err) {
    res.json({ success: false, message: "Registration failed" });
  }
});

app.post("/verify", async (req, res) => {
  res.json({ success: true, message: "Verified" });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user)                       return res.json({ success: false, message: "Account not found" });
    if (user.status === "suspended") return res.json({ success: false, message: "Account suspended" });
    if (!await bcrypt.compare(password, user.password))
      return res.json({ success: false, message: "Wrong password" });
    user.lastLogin = new Date();
    await user.save();
    const token = Buffer.from(`${user._id}:${Date.now()}`).toString("base64");
    await logActivity("login", `Login: ${email}`, user._id.toString());
    res.json({ success: true, message: "Login successful", token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    res.json({ success: false, message: "Login failed" });
  }
});

// ============================
// SUPPORT FORM
// ============================
app.post("/api/support", async (req, res) => {
  const { name, email, type, subject, message } = req.body;
  if (!name || !email || !message)
    return res.json({ success: false, message: "All fields required" });
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: "studentshelplibrary@gmail.com",
      subject: `[SUPPORT] ${type?.toUpperCase()} — ${subject || "No subject"}`,
      html: `<div style="background:#071018;padding:30px;color:white;font-family:Arial;border-radius:12px;">
        <h2 style="color:#00d9ff;">MASTER BIOMEDS — Support Request</h2>
        <table style="width:100%;margin:20px 0;">
          <tr><td style="color:#5a7a8a;padding:6px 0;">Name</td><td style="font-weight:600;">${name}</td></tr>
          <tr><td style="color:#5a7a8a;padding:6px 0;">Email</td><td>${email}</td></tr>
          <tr><td style="color:#5a7a8a;padding:6px 0;">Type</td><td style="color:#00d9ff;">${type}</td></tr>
          <tr><td style="color:#5a7a8a;padding:6px 0;">Subject</td><td>${subject}</td></tr>
        </table>
        <div style="background:#0b1622;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="color:#5a7a8a;margin-bottom:8px;">Message:</p>
          <p style="line-height:1.7;">${message}</p>
        </div>
        <p style="color:#5a7a8a;font-size:12px;margin-top:16px;">Reply to: ${email}</p>
      </div>`
    });
    await logActivity("support", `Support: ${type} from ${email}`);
    res.json({ success: true, message: "Support request sent!" });
  } catch(err) {
    console.error("Support email error:", err.message);
    res.json({ success: true, message: "Received!" }); // Still show success to user
  }
});

// Add about page route
app.get("/about", (req, res) => res.sendFile(process.cwd() + "/public/about.html"));
app.get("/about.html", (req, res) => res.sendFile(process.cwd() + "/public/about.html"));

// ============================
// GET GEMINI KEY FOR BROWSER
// ============================
app.get("/api/ai/getkey", userAuth, async (req, res) => {
  try {
    const k = await Settings.findOne({ key: "gemini_api_key" });
    const key = k?.value || process.env.GEMINI_API_KEY || "";
    res.json({ success:true, key });
  } catch(e) { res.json({ success:false, key:"" }); }
});

// ============================
// PUBLIC APK INFO
// ============================
app.get("/api/apk/info", async (req, res) => {
  try {
    const keys = ["apk_version","apk_url","apk_size","apk_changelog","apk_name"];
    const settings = await Settings.find({ key: { $in: keys } });
    const info = {};
    settings.forEach(s => info[s.key] = s.value);
    res.json({ success: true, apk: info });
  } catch(e) {
    res.json({ success: false, apk: {} });
  }
});

// ============================
// PUBLIC APK INFO
// ============================
app.get("/api/apk/info", async (req, res) => {
  try {
    const keys = ["apk_version","apk_url","apk_size","apk_changelog","apk_name"];
    const settings = await Settings.find({ key: { $in: keys } });
    const info = {};
    settings.forEach(s => info[s.key] = s.value);
    res.json({ success: true, apk: info });
  } catch(e) {
    res.json({ success: false, apk: {} });
  }
});

// ============================
// PUBLIC NOTIFICATIONS
// ============================
app.get("/api/notifications", async (req, res) => {
  try {
    const notifs = await Notification.find().sort({ sentAt: -1 }).limit(20);
    res.json({ success: true, notifications: notifs });
  } catch(e) {
    res.json({ success: false, notifications: [] });
  }
});

// ============================
// PUBLIC PDFs
// ============================
app.get("/api/pdfs", async (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const query = { access: { $ne: "restricted" } };
  if (category) query.category = category;
  if (search)   query.title = { $regex: search, $options: "i" };
  const total = await PDF.countDocuments(query);
  const pdfs  = await PDF.find(query).sort({ uploadedAt: -1 })
    .skip((page - 1) * limit).limit(parseInt(limit));
  res.json({ success: true, pdfs, total });
});

app.get("/api/categories", async (req, res) => {
  const cats = await Category.find().sort({ name: 1 });
  res.json({ success: true, categories: cats });
});

// ── DOWNLOAD — serves from GridFS ──
app.get("/api/pdfs/:id/download", async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.json({ success: false, message: "File not found" });

    pdf.downloads += 1;
    await pdf.save();
    await logActivity("download", `Downloaded: ${pdf.title}`);

    // Try GridFS first
    if (pdf.fileId) {
      const fileId = new mongoose.Types.ObjectId(pdf.fileId);
      const files  = await gfsBucket.find({ _id: fileId }).toArray();
      if (files.length) {
        const ext = "." + (pdf.fileType || "pdf");
        res.set("Content-Disposition", `attachment; filename="${pdf.title}${ext}"`);
        res.set("Content-Type", files[0].contentType || "application/octet-stream");
        return gfsBucket.openDownloadStream(fileId).pipe(res);
      }
    }

    // Fallback to disk (old files)
    if (pdf.filename) {
      const fp = path.join(process.cwd(), "uploads/pdfs", pdf.filename);
      if (fs.existsSync(fp)) {
        const ext = path.extname(pdf.originalName || ("." + (pdf.fileType || "pdf")));
        return res.download(fp, pdf.title + ext);
      }
    }

    res.json({ success: false, message: "File not found on server. Please re-upload." });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// ============================
// AI ROUTES
// ============================
app.get("/api/ai/points", userAuth, async (req, res) => {
  const user = req.user;
  const now  = new Date();
  if (now >= new Date(user.aiPointsResetAt)) {
    user.aiPoints        = 5;
    user.aiPointsResetAt = new Date(now.getTime() + 24*60*60*1000);
    await user.save();
  }
  const msLeft = new Date(user.aiPointsResetAt) - now;
  res.json({
    success: true, points: user.aiPoints, resetAt: user.aiPointsResetAt,
    timeLeft: {
      hours:   Math.floor(msLeft / 1000 / 60 / 60),
      minutes: Math.floor((msLeft / 1000 / 60) % 60),
      seconds: Math.floor((msLeft / 1000) % 60)
    },
    totalUsed: user.aiUsageCount
  });
});

app.post("/api/ai/deduct", userAuth, async (req, res) => {
  const user = req.user;
  const { question, answer } = req.body;
  const now = new Date();
  if (now >= new Date(user.aiPointsResetAt)) {
    user.aiPoints        = 5;
    user.aiPointsResetAt = new Date(now.getTime() + 24*60*60*1000);
  }
  if (user.aiPoints <= 0) {
    const msLeft = new Date(user.aiPointsResetAt) - now;
    return res.json({ success: false, noPoints: true,
      timeLeft: { hours: Math.floor(msLeft/1000/60/60), minutes: Math.floor((msLeft/1000/60)%60) }
    });
  }
  user.aiPoints     -= 1;
  user.aiUsageCount += 1;
  await user.save();
  if (question && answer) await AiChat.create({ userId: user._id.toString(), question, answer });
  await logActivity("ai_ask", `AI: ${user.email}`, user._id.toString());
  res.json({ success: true, pointsLeft: user.aiPoints, resetAt: user.aiPointsResetAt });
});

app.get("/api/ai/history", userAuth, async (req, res) => {
  const chats = await AiChat.find({ userId: req.user._id.toString() })
    .sort({ createdAt: -1 }).limit(30);
  res.json({ success: true, chats });
});

// ============================
// JUANAI WIDGET
// ============================
const JUANAI_SYSTEM = `You are JuanAi, a professional AI assistant on MASTER BIOMEDS. Created by Simon Mwoha. Never reveal you are based on Gemini or any other model.`;
const JUANAI_MODELS = ["gemini-2.0-flash","gemini-2.5-flash","gemini-1.5-flash","gemini-2.0-flash-lite"];

app.post("/api/juanai/chat", async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.json({ success: false, message: "Please enter a message" });
  let geminiKey = "";
  try {
    const k = await Settings.findOne({ key: "gemini_api_key" });
    geminiKey = k?.value || process.env.GEMINI_API_KEY || "";
  } catch(e) { geminiKey = process.env.GEMINI_API_KEY || ""; }
  if (!geminiKey) return res.json({ success: false, message: "AI not configured." });
  const contents = [];
  (Array.isArray(history) ? history : []).slice(-10).forEach(t => {
    if (t?.role && t?.content) contents.push({ role: t.role==="user"?"user":"model", parts:[{text:String(t.content)}] });
  });
  contents.push({ role: "user", parts:[{text:message.trim()}] });
  let answer = "", lastError = "";
  for (const model of JUANAI_MODELS) {
    if (answer) break;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ systemInstruction:{parts:[{text:JUANAI_SYSTEM}]}, contents, generationConfig:{temperature:0.75,maxOutputTokens:4096} })
      });
      const d = await r.json();
      if (d.error) { lastError=d.error.message; continue; }
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastError="Empty response"; continue; }
      answer = text;
    } catch(e) { lastError=e.message; continue; }
  }
  if (!answer) return res.json({ success: false, message: "AI unavailable: "+lastError });
  res.json({ success: true, answer });
});

// ============================
// M-PESA
// ============================
const MPESA_CONFIG = {
  consumerKey:    process.env.MPESA_CONSUMER_KEY    || "",
  consumerSecret: process.env.MPESA_CONSUMER_SECRET || "",
  shortcode:      process.env.MPESA_SHORTCODE       || "",
  passkey:        process.env.MPESA_PASSKEY         || "",
  callbackUrl:    process.env.MPESA_CALLBACK_URL    || "https://medical-training-co-ke.onrender.com/api/mpesa/callback",
  env:            process.env.MPESA_ENV             || "sandbox"
};

function mpesaBaseUrl() {
  return MPESA_CONFIG.env==="production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}
async function getMpesaToken() {
  const creds = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString("base64");
  const r = await fetch(`${mpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, { headers:{"Authorization":`Basic ${creds}`} });
  const d = await r.json();
  if (!d.access_token) throw new Error("M-Pesa token failed");
  return d.access_token;
}
function stkPassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g,"").slice(0,14);
  return { password: Buffer.from(MPESA_CONFIG.shortcode+MPESA_CONFIG.passkey+timestamp).toString("base64"), timestamp };
}

app.post("/api/mpesa/pay", userAuth, async (req, res) => {
  const { pdfId, phone } = req.body;
  const user = req.user;
  if (!pdfId || !phone) return res.json({ success:false, message:"PDF ID and phone required" });
  let cleanPhone = phone.replace(/\s+/g,"").replace(/^0/,"254").replace(/^\+/,"");
  if (!/^254[0-9]{9}$/.test(cleanPhone))
    return res.json({ success:false, message:"Invalid phone. Use: 07XXXXXXXX" });
  const pdf = await PDF.findById(pdfId);
  if (!pdf) return res.json({ success:false, message:"PDF not found" });
  const amount = pdf.price || 0;
  if (!amount || amount <= 0) return res.json({ success:false, message:"This PDF is free — just download it!" });
  const existing = await Payment.findOne({ userId:user._id.toString(), pdfId, status:"completed" });
  if (existing) return res.json({ success:false, message:"Already purchased", alreadyPurchased:true });
  try {
    const token = await getMpesaToken();
    const { password, timestamp } = stkPassword();
    const r = await fetch(`${mpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method:"POST", headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
      body: JSON.stringify({
        BusinessShortCode: MPESA_CONFIG.shortcode, Password: password, Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline", Amount: Math.ceil(amount),
        PartyA: cleanPhone, PartyB: MPESA_CONFIG.shortcode, PhoneNumber: cleanPhone,
        CallBackURL: MPESA_CONFIG.callbackUrl,
        AccountReference: `BIOMEDS-${pdfId.slice(-6)}`,
        TransactionDesc: `Buy: ${pdf.title.substring(0,30)}`
      })
    });
    const d = await r.json();
    if (d.ResponseCode !== "0") return res.json({ success:false, message:d.errorMessage||d.ResponseDescription||"STK Push failed" });
    const payment = await Payment.create({ userId:user._id.toString(), pdfId, pdfTitle:pdf.title, amount, phone:cleanPhone, checkoutRequestId:d.CheckoutRequestID, merchantRequestId:d.MerchantRequestID });
    await logActivity("payment_initiated", `Payment: ${pdf.title} KES ${amount}`, user._id.toString());
    res.json({ success:true, message:`STK sent to ${phone}. Enter M-Pesa PIN.`, checkoutRequestId:d.CheckoutRequestID, paymentId:payment._id });
  } catch(err) {
    res.json({ success:false, message:"M-Pesa error: "+err.message });
  }
});

app.post("/api/mpesa/callback", async (req, res) => {
  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) return res.json({ ResultCode:0, ResultDesc:"OK" });
    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = body;
    const payment = await Payment.findOne({ checkoutRequestId:CheckoutRequestID });
    if (!payment) return res.json({ ResultCode:0, ResultDesc:"OK" });
    if (ResultCode === 0) {
      const meta    = CallbackMetadata?.Item || [];
      const receipt = meta.find(i=>i.Name==="MpesaReceiptNumber")?.Value || "";
      payment.status="completed"; payment.mpesaReceiptNumber=receipt; payment.completedAt=new Date();
      await payment.save();
      await User.findByIdAndUpdate(payment.userId, { $addToSet:{purchasedPdfs:payment.pdfId} });
      await logActivity("payment_completed", `Paid: ${payment.pdfTitle} KES ${payment.amount} ${receipt}`, payment.userId);
    } else {
      payment.status="failed"; await payment.save();
    }
  } catch(err) { console.error("[M-Pesa Callback]", err.message); }
  res.json({ ResultCode:0, ResultDesc:"OK" });
});

app.get("/api/mpesa/status/:checkoutId", userAuth, async (req, res) => {
  const payment = await Payment.findOne({ checkoutRequestId:req.params.checkoutId, userId:req.user._id.toString() });
  if (!payment) return res.json({ success:false, message:"Not found" });
  res.json({ success:true, status:payment.status, receipt:payment.mpesaReceiptNumber });
});

app.get("/api/mpesa/purchases", userAuth, async (req, res) => {
  const purchases = await Payment.find({ userId:req.user._id.toString(), status:"completed" }).sort({ completedAt:-1 }).limit(50);
  res.json({ success:true, purchases });
});

// ============================
// ADMIN AUTH
// ============================
async function handleAdminAuth(req, res) {
  const { email, password, secretKey } = req.body;
  if (secretKey !== (process.env.ADMIN_SECRET || "MASTERBIOMEDS_ADMIN_2024"))
    return res.json({ success:false, message:"Access denied" });
  if (email !== (process.env.ADMIN_EMAIL || "admin@masterbiomeds.com"))
    return res.json({ success:false, message:"Access denied" });
  const pwdSetting = await Settings.findOne({ key:"admin_password" }).catch(()=>null);
  const correctPwd = pwdSetting?.value || process.env.ADMIN_PASSWORD || "Admin123";
  if (password !== correctPwd) return res.json({ success:false, message:"Access denied" });
  const token = Buffer.from(`admin001:${Date.now()}`).toString("base64");
  await logActivity("admin_login", `Admin login: ${email}`);
  res.json({ success:true, token, admin:{ id:"admin001", username:"SuperAdmin", email, role:"superadmin" } });
}
app.post("/api/xadmin/auth", handleAdminAuth);
app.post("/api/mbx9k/auth",  handleAdminAuth);

// ============================
// ADMIN ROUTES
// ============================
function registerAdminRoutes(prefix) {

  app.get(`${prefix}/stats`, adminAuth, async (req, res) => {
    const [totalPdfs, totalUsers, activeUsers, totalCats] = await Promise.all([
      PDF.countDocuments(), User.countDocuments(),
      User.countDocuments({ status:"active" }), Category.countDocuments()
    ]);
    const dlAgg      = await PDF.aggregate([{ $group:{ _id:null, total:{ $sum:"$downloads" } } }]);
    const storageAgg = await PDF.aggregate([{ $group:{ _id:null, total:{ $sum:"$fileSize" } } }]);
    const topPdfs    = await PDF.find().sort({ downloads:-1 }).limit(5).select("title downloads");
    const recentUploads = await PDF.find().sort({ uploadedAt:-1 }).limit(5);
    const totalAiChats  = await AiChat.countDocuments();
    res.json({ success:true, stats:{ totalPdfs, totalUsers, activeUsers, totalCats,
      totalDownloads:dlAgg[0]?.total||0, storageUsed:storageAgg[0]?.total||0,
      topPdfs, recentUploads, totalAiChats }});
  });

  app.get(`${prefix}/logs`, adminAuth, async (req, res) => {
    const { limit=100, type } = req.query;
    const query = type ? { type } : {};
    const logs  = await ActivityLog.find(query).sort({ timestamp:-1 }).limit(parseInt(limit));
    res.json({ success:true, logs });
  });

  // ── UPLOAD with GridFS ──
  app.post(`${prefix}/pdfs`, adminAuth,
    upload.fields([{ name:"pdf", maxCount:1 }, { name:"thumbnail", maxCount:1 }]),
    async (req, res) => {
      try {
        if (!req.files?.pdf) return res.json({ success:false, message:"No file uploaded" });
        const { title, description, category, access="public", subject, semester } = req.body;
        const price = parseFloat(req.body.price) || 0;
        if (!title || !category) return res.json({ success:false, message:"Title and category required" });

        const uploadedFile  = req.files.pdf[0];
        const thumbnailFile = req.files.thumbnail?.[0];
        const detectedType  = ALLOWED_TYPES[uploadedFile.mimetype] || "pdf";

        // Upload main file to GridFS
        const fileId = await uploadToGridFS(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);

        // Upload thumbnail to GridFS if provided
        let thumbnailId = null;
        if (thumbnailFile) {
          thumbnailId = await uploadToGridFS(thumbnailFile.buffer, thumbnailFile.originalname, thumbnailFile.mimetype);
        }

        const pdf = await PDF.create({
          title, description, category, access, subject, semester, price,
          fileId, thumbnailId,
          filename: uploadedFile.originalname,
          originalName: uploadedFile.originalname,
          fileSize: uploadedFile.size,
          fileType: detectedType,
          uploadedBy: "admin001"
        });
        await logActivity("upload", `Uploaded: ${title}`, "admin001");
        res.json({ success:true, pdf });
      } catch(err) { res.json({ success:false, message:err.message }); }
    }
  );

  app.get(`${prefix}/pdfs`, adminAuth, async (req, res) => {
    const { category, search, access } = req.query;
    const query = {};
    if (category) query.category = category;
    if (search)   query.title    = { $regex:search, $options:"i" };
    if (access)   query.access   = access;
    const pdfs = await PDF.find(query).sort({ uploadedAt:-1 });
    res.json({ success:true, pdfs, total:pdfs.length });
  });

  app.put(`${prefix}/pdfs/:id`, adminAuth,
    upload.fields([{ name:"thumbnail", maxCount:1 }]),
    async (req, res) => {
      try {
        const existing = await PDF.findById(req.params.id);
        if (!existing) return res.json({ success:false, message:"File not found" });
        const { title, description, category, access, subject, semester } = req.body;
        const price  = parseFloat(req.body.price) || 0;
        const update = { title, description, category, access, subject, semester, price, updatedAt:new Date() };

        if (req.files?.thumbnail?.[0]) {
          // Delete old thumbnail from GridFS
          if (existing.thumbnailId) await deleteFromGridFS(existing.thumbnailId);
          const thumbFile = req.files.thumbnail[0];
          update.thumbnailId = await uploadToGridFS(thumbFile.buffer, thumbFile.originalname, thumbFile.mimetype);
        }

        const pdf = await PDF.findByIdAndUpdate(req.params.id, update, { new:true });
        await logActivity("edit_pdf", `Updated: ${title}`, "admin001");
        res.json({ success:true, pdf });
      } catch(err) { res.json({ success:false, message:err.message }); }
    }
  );

  app.delete(`${prefix}/pdfs/:id`, adminAuth, async (req, res) => {
    const pdf = await PDF.findByIdAndDelete(req.params.id);
    if (!pdf) return res.json({ success:false, message:"File not found" });
    // Delete from GridFS
    await deleteFromGridFS(pdf.fileId);
    await deleteFromGridFS(pdf.thumbnailId);
    await logActivity("delete_pdf", `Deleted: ${pdf.title}`, "admin001");
    res.json({ success:true, message:"File deleted" });
  });

  app.post(`${prefix}/pdfs/bulk`, adminAuth,
    upload.array("pdfs", 20),
    async (req, res) => {
      if (!req.files?.length) return res.json({ success:false, message:"No files selected" });
      const { category="", access="public" } = req.body;
      const uploaded = [];
      for (const file of req.files) {
        // Accept all file types
        const title = file.originalname.replace(/\.[^/.]+$/, "").replace(/_/g," ");
        const detectedType = ALLOWED_TYPES[file.mimetype] || "pdf";
        const fileId = await uploadToGridFS(file.buffer, file.originalname, file.mimetype);
        const pdf = await PDF.create({
          title, category, access, fileId,
          filename: file.originalname, originalName: file.originalname,
          fileSize: file.size, fileType: detectedType, uploadedBy:"admin001"
        });
        uploaded.push({ id:pdf._id, title, type:detectedType });
      }
      await logActivity("bulk_upload", `Bulk: ${uploaded.length} files`, "admin001");
      res.json({ success:true, message:`${uploaded.length} files uploaded`, uploaded });
    }
  );

  app.get(`${prefix}/categories`, adminAuth, async (req, res) => {
    const cats = await Category.find().sort({ name:1 });
    res.json({ success:true, categories:cats });
  });
  app.post(`${prefix}/categories`, adminAuth, async (req, res) => {
    const { name, department } = req.body;
    if (!name) return res.json({ success:false, message:"Name required" });
    const cat = await Category.create({ name, department:department||name });
    res.json({ success:true, category:cat });
  });
  app.delete(`${prefix}/categories/:id`, adminAuth, async (req, res) => {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ success:true, message:"Category deleted" });
  });

  app.get(`${prefix}/users`, adminAuth, async (req, res) => {
    const users = await User.find().select("-password").sort({ createdAt:-1 });
    res.json({ success:true, users, total:users.length });
  });
  app.put(`${prefix}/users/:id/suspend`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { status:"suspended" });
    res.json({ success:true, message:"User suspended" });
  });
  app.put(`${prefix}/users/:id/activate`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { status:"active" });
    res.json({ success:true, message:"User activated" });
  });
  app.delete(`${prefix}/users/:id`, adminAuth, async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.json({ success:false, message:"Not found" });
    res.json({ success:true, message:"User deleted" });
  });
  app.put(`${prefix}/users/:id/promote`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { role:"moderator" });
    res.json({ success:true, message:"Promoted" });
  });
  app.put(`${prefix}/users/:id/resetpoints`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { aiPoints:5, aiPointsResetAt:new Date(Date.now()+24*60*60*1000) });
    res.json({ success:true, message:"AI points reset to 5" });
  });

  app.post(`${prefix}/notifications`, adminAuth, async (req, res) => {
    const { title, message, type="announcement", sendEmail } = req.body;
    if (!title || !message) return res.json({ success:false, message:"Required" });
    const userCount = await User.countDocuments();
    const notif = await Notification.create({ title, message, type, sentBy:"admin001", recipients:userCount });
    if (sendEmail) {
      const users = await User.find({ status:"active" }).select("email");
      users.forEach(u => transporter.sendMail({
        from: process.env.EMAIL_USER, to: u.email,
        subject: `[MASTER BIOMEDS] ${title}`,
        html: `<div style="background:#071018;padding:40px;color:white;font-family:Arial;"><h1 style="color:#00d9ff;">MASTER BIOMEDS</h1><h2>${title}</h2><p>${message}</p></div>`
      }).catch(()=>{}));
    }
    res.json({ success:true, notification:notif });
  });
  app.get(`${prefix}/notifications`, adminAuth, async (req, res) => {
    const notifs = await Notification.find().sort({ sentAt:-1 }).limit(50);
    res.json({ success:true, notifications:notifs });
  });

  app.get(`${prefix}/analytics`, adminAuth, async (req, res) => {
    const topDownloaded = await PDF.find().sort({ downloads:-1 }).limit(10);
    const cats          = await Category.find();
    const storageAgg    = await PDF.aggregate([{ $group:{ _id:null, total:{ $sum:"$fileSize" } } }]);
    const storageUsed   = storageAgg[0]?.total || 0;
    const activeUsers   = await User.countDocuments({ status:"active" });
    const totalDlAgg    = await PDF.aggregate([{ $group:{ _id:null, t:{ $sum:"$downloads" } } }]);
    const totalAiChats  = await AiChat.countDocuments();
    const byCategory    = await Promise.all(cats.map(async c => {
      const agg = await PDF.aggregate([{ $match:{ category:c._id.toString() } }, { $group:{ _id:null, total:{ $sum:"$downloads" } } }]);
      return { ...c.toObject(), downloads:agg[0]?.total||0 };
    }));
    res.json({ success:true, analytics:{ topDownloaded, byCategory, storageUsed,
      storageUsedMB:(storageUsed/1024/1024).toFixed(2), activeUsers,
      totalDownloads:totalDlAgg[0]?.t||0, totalAiQuestions:totalAiChats }});
  });

  app.get(`${prefix}/settings`, adminAuth, async (req, res) => {
    try {
      const settings = await Settings.find();
      const obj = {};
      settings.forEach(s => { obj[s.key]=(s.key==="gemini_api_key"&&s.value.length>6)?"••••••••••••"+s.value.slice(-6):s.value; });
      res.json({ success:true, settings:obj });
    } catch(err) { res.json({ success:false, message:err.message }); }
  });
  app.post(`${prefix}/settings/gemini-key`, adminAuth, async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || apiKey.trim().length < 10) return res.json({ success:false, message:"Enter a valid key" });
    await Settings.findOneAndUpdate({ key:"gemini_api_key" }, { key:"gemini_api_key", value:apiKey.trim(), updatedAt:new Date() }, { upsert:true, new:true });
    res.json({ success:true, message:"Gemini API key saved!" });
  });
  app.post(`${prefix}/settings/change-password`, adminAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.json({ success:false, message:"Both fields required" });
    if (newPassword.length < 6) return res.json({ success:false, message:"Min 6 characters" });
    const pwdSetting = await Settings.findOne({ key:"admin_password" });
    const currentPwd = pwdSetting?.value || process.env.ADMIN_PASSWORD || "Admin123";
    if (currentPassword !== currentPwd) return res.json({ success:false, message:"Wrong current password" });
    await Settings.findOneAndUpdate({ key:"admin_password" }, { key:"admin_password", value:newPassword, updatedAt:new Date() }, { upsert:true });
    res.json({ success:true, message:"Password changed!" });
  });
  app.post(`${prefix}/settings/ai-points`, adminAuth, async (req, res) => {
    const { points } = req.body;
    if (!points || points < 1 || points > 100) return res.json({ success:false, message:"Points must be 1-100" });
    await Settings.findOneAndUpdate({ key:"daily_ai_points" }, { key:"daily_ai_points", value:String(points), updatedAt:new Date() }, { upsert:true });
    res.json({ success:true, message:`Daily AI points set to ${points}` });
  });

  // APK Management
  app.get(`${prefix}/apk`, adminAuth, async (req, res) => {
    const keys = ["apk_version","apk_url","apk_size","apk_changelog","apk_name"];
    const settings = await Settings.find({ key: { $in: keys } });
    const info = {};
    settings.forEach(s => info[s.key] = s.value);
    res.json({ success: true, apk: info });
  });

  app.post(`${prefix}/apk`, adminAuth, async (req, res) => {
    const { apk_version, apk_url, apk_size, apk_changelog, apk_name } = req.body;
    try {
      const updates = { apk_version, apk_url, apk_size, apk_changelog, apk_name };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          await Settings.findOneAndUpdate(
            { key },
            { key, value: String(value), updatedAt: new Date() },
            { upsert: true, new: true }
          );
        }
      }
      await logActivity("apk_update", `APK updated: v${apk_version}`, "admin001");
      res.json({ success: true, message: "APK info updated successfully!" });
    } catch(e) {
      res.json({ success: false, message: e.message });
    }
  });

  // APK Management
  app.get(`${prefix}/apk`, adminAuth, async (req, res) => {
    const keys = ["apk_version","apk_url","apk_size","apk_changelog","apk_name"];
    const settings = await Settings.find({ key: { $in: keys } });
    const info = {};
    settings.forEach(s => info[s.key] = s.value);
    res.json({ success: true, apk: info });
  });

  app.post(`${prefix}/apk`, adminAuth, async (req, res) => {
    const { apk_version, apk_url, apk_size, apk_changelog, apk_name } = req.body;
    try {
      const updates = { apk_version, apk_url, apk_size, apk_changelog, apk_name };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          await Settings.findOneAndUpdate(
            { key },
            { key, value: String(value), updatedAt: new Date() },
            { upsert: true, new: true }
          );
        }
      }
      await logActivity("apk_update", `APK updated: v${apk_version}`, "admin001");
      res.json({ success: true, message: "APK info updated successfully!" });
    } catch(e) {
      res.json({ success: false, message: e.message });
    }
  });

  app.get(`${prefix}/payments`, adminAuth, async (req, res) => {
    const payments = await Payment.find().sort({ createdAt:-1 }).limit(100);
    const total = await Payment.aggregate([{ $match:{ status:"completed" } }, { $group:{ _id:null, total:{ $sum:"$amount" } } }]);
    res.json({ success:true, payments, totalRevenue:total[0]?.total||0 });
  });
}

registerAdminRoutes("/api/xadmin");
registerAdminRoutes("/api/mbx9k");

// ── Serve thumbnail from GridFS ──
app.get("/api/thumbnail/:fileId", async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.fileId);
    const files  = await gfsBucket.find({ _id:fileId }).toArray();
    if (!files.length) return res.status(404).send("Not found");
    res.set("Content-Type", files[0].contentType || "image/jpeg");
    gfsBucket.openDownloadStream(fileId).pipe(res);
  } catch(e) { res.status(404).send("Not found"); }
});

// ============================
// SELF-PING
// ============================
function startSelfPing() {
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(async () => {
    try {
      const r = await fetch(`${SELF_URL}/ping`);
      const d = await r.json();
      console.log(`🏓 Ping OK — uptime: ${d.uptime}s`);
    } catch(err) { console.warn(`⚠️ Ping failed: ${err.message}`); }
  }, 5 * 60 * 1000);
  console.log(`✅ Self-ping started → ${SELF_URL}/ping`);
}

// ============================
// START
// ============================
mongoose.connection.once("open", async () => {
  await seedCategories();
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║   MASTER BIOMEDS — SERVER RUNNING    ║
╠══════════════════════════════════════╣
║  http://localhost:${PORT}              ║
║  Admin  : /mbd-ctrl-9x7k2mz.html    ║
║  Storage: MongoDB GridFS ✅          ║
╚══════════════════════════════════════╝`);
    startSelfPing();
  });
});
