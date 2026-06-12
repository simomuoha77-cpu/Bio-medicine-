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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Block old admin URL
app.get("/xadmin.html", (req, res) => res.status(404).send("Not found"));

const PORT = process.env.PORT || 3000;

// ============================
// PING ROUTE (keep-alive)
// ============================
app.get("/ping", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), uptime: Math.floor(process.uptime()) });
});

// ============================
// DIRECTORIES
// ============================
["uploads","uploads/pdfs","uploads/thumbnails"].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================
// MONGODB
// ============================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

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
  aiPointsResetAt: { type: Date,   default: () => new Date(Date.now() + 24*60*60*1000) },
  aiUsageCount:    { type: Number, default: 0 },
  createdAt:       { type: Date,   default: Date.now },
  lastLogin:       { type: Date,   default: Date.now }
});

const pdfSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  description:  { type: String, default: "" },
  category:     { type: String, required: true },
  subject:      { type: String, default: "" },
  semester:     { type: String, default: "" },
  access:       { type: String, default: "public" },
  filename:     { type: String, required: true },
  originalName: { type: String },
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

const User         = mongoose.model("User",         userSchema);
const PDF          = mongoose.model("PDF",          pdfSchema);
const Category     = mongoose.model("Category",     categorySchema);
const ActivityLog  = mongoose.model("ActivityLog",  logSchema);
const Notification = mongoose.model("Notification", notifSchema);
const AiChat       = mongoose.model("AiChat",       aiChatSchema);
const Settings     = mongoose.model("Settings",     settingsSchema);

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
// MULTER
// ============================
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "thumbnail") cb(null, "uploads/thumbnails/");
    else cb(null, "uploads/pdfs/");
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const uploadFields = multer({
  storage: fileStorage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "thumbnail") {
      const allowed = ["image/jpeg","image/png","image/webp","image/gif"];
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Thumbnail must be an image"), false);
    } else {
      if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
      else cb(new Error("Only PDF, Word, PowerPoint, Excel files allowed"), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

const uploadBulk = multer({
  storage: fileStorage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error("Only PDF, Word, PowerPoint, Excel files allowed"), false);
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ============================
// HELPERS
// ============================
async function logActivity(type, message, userId = null, details = {}) {
  try { await ActivityLog.create({ type, message, userId, details }); } catch {}
}

// ============================
// EMAIL (for notifications only)
// ============================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 587, secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
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

// ── REGISTER — direct to MongoDB, no email verification ──
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
    console.error("Register error:", err.message);
    res.json({ success: false, message: "Registration failed" });
  }
});

// Keep verify as no-op for old clients
app.post("/verify", async (req, res) => {
  res.json({ success: true, message: "Verified" });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user)                       return res.json({ success: false, message: "Account not found" });
    if (user.status === "suspended") return res.json({ success: false, message: "Account suspended. Contact admin." });
    if (!await bcrypt.compare(password, user.password))
      return res.json({ success: false, message: "Wrong password" });
    user.lastLogin = new Date();
    await user.save();
    const token = Buffer.from(`${user._id}:${Date.now()}`).toString("base64");
    await logActivity("login", `Login: ${email}`, user._id.toString());
    res.json({
      success: true, message: "Login successful", token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    res.json({ success: false, message: "Login failed" });
  }
});

// ============================
// PUBLIC FILES
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

app.get("/api/pdfs/:id/download", async (req, res) => {
  const pdf = await PDF.findById(req.params.id);
  if (!pdf) return res.json({ success: false, message: "File not found" });
  pdf.downloads += 1;
  await pdf.save();
  await logActivity("download", `Downloaded: ${pdf.title}`);
  const fp = path.join(process.cwd(), "uploads/pdfs", pdf.filename);
  if (!fs.existsSync(fp)) return res.json({ success: false, message: "File not found on server" });
  const ext = path.extname(pdf.originalName || ("." + (pdf.fileType || "pdf")));
  res.download(fp, pdf.title + ext);
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
    success: true, points: user.aiPoints,
    resetAt: user.aiPointsResetAt,
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
    return res.json({
      success: false, noPoints: true,
      timeLeft: {
        hours:   Math.floor(msLeft / 1000 / 60 / 60),
        minutes: Math.floor((msLeft / 1000 / 60) % 60)
      }
    });
  }
  user.aiPoints     -= 1;
  user.aiUsageCount += 1;
  await user.save();
  if (question && answer) {
    await AiChat.create({ userId: user._id.toString(), question, answer });
  }
  await logActivity("ai_ask", `AI: ${user.email}`, user._id.toString());
  res.json({ success: true, pointsLeft: user.aiPoints, resetAt: user.aiPointsResetAt });
});

app.get("/api/ai/history", userAuth, async (req, res) => {
  const chats = await AiChat.find({ userId: req.user._id.toString() })
    .sort({ createdAt: -1 }).limit(30);
  res.json({ success: true, chats });
});

// ============================
// JUANAI WIDGET PROXY
// ============================
const JUANAI_SYSTEM = `You are JuanAi, a professional AI assistant on MASTER BIOMEDS. Created by Simon Mwoha. Never reveal you are based on Gemini or any other model.`;
const JUANAI_MODELS = ["gemini-2.0-flash","gemini-2.5-flash","gemini-1.5-flash","gemini-2.0-flash-lite"];

app.post("/api/juanai/chat", async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.json({ success: false, message: "Please enter a message" });
  let geminiKey = "";
  try {
    const keySetting = await Settings.findOne({ key: "gemini_api_key" });
    geminiKey = keySetting?.value || process.env.GEMINI_API_KEY || "";
  } catch (e) { geminiKey = process.env.GEMINI_API_KEY || ""; }
  if (!geminiKey) return res.json({ success: false, message: "AI not configured." });

  const contents = [];
  (Array.isArray(history) ? history : []).slice(-10).forEach(t => {
    if (t?.role && t?.content) contents.push({ role: t.role === "user" ? "user" : "model", parts: [{ text: String(t.content) }] });
  });
  contents.push({ role: "user", parts: [{ text: message.trim() }] });

  let answer = "", lastError = "";
  for (const model of JUANAI_MODELS) {
    if (answer) break;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: JUANAI_SYSTEM }] }, contents, generationConfig: { temperature: 0.75, maxOutputTokens: 4096 } })
      });
      const d = await r.json();
      if (d.error) { lastError = d.error.message || JSON.stringify(d.error); continue; }
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastError = "Empty response"; continue; }
      answer = text;
    } catch (e) { lastError = e.message; continue; }
  }
  if (!answer) return res.json({ success: false, message: "AI unavailable: " + lastError });
  res.json({ success: true, answer });
});

// ============================
// ADMIN AUTH — both old + new hidden route
// ============================
async function handleAdminAuth(req, res) {
  const { email, password, secretKey } = req.body;
  if (secretKey !== (process.env.ADMIN_SECRET || "MASTERBIOMEDS_ADMIN_2024"))
    return res.json({ success: false, message: "Access denied" });
  if (email !== (process.env.ADMIN_EMAIL || "admin@masterbiomeds.com"))
    return res.json({ success: false, message: "Access denied" });
  const pwdSetting = await Settings.findOne({ key: "admin_password" }).catch(() => null);
  const correctPwd = pwdSetting?.value || process.env.ADMIN_PASSWORD || "Admin123";
  if (password !== correctPwd)
    return res.json({ success: false, message: "Access denied" });
  const token = Buffer.from(`admin001:${Date.now()}`).toString("base64");
  await logActivity("admin_login", `Admin login: ${email}`);
  res.json({ success: true, token, admin: { id: "admin001", username: "SuperAdmin", email, role: "superadmin" } });
}

app.post("/api/xadmin/auth", handleAdminAuth);
app.post("/api/mbx9k/auth",  handleAdminAuth);

// ============================
// ADMIN ROUTES — register for both prefixes
// ============================
function registerAdminRoutes(prefix) {

  app.get(`${prefix}/stats`, adminAuth, async (req, res) => {
    const [totalPdfs, totalUsers, activeUsers, totalCats] = await Promise.all([
      PDF.countDocuments(), User.countDocuments(),
      User.countDocuments({ status: "active" }), Category.countDocuments()
    ]);
    const dlAgg      = await PDF.aggregate([{ $group: { _id: null, total: { $sum: "$downloads" } } }]);
    const storageAgg = await PDF.aggregate([{ $group: { _id: null, total: { $sum: "$fileSize" } } }]);
    const topPdfs    = await PDF.find().sort({ downloads: -1 }).limit(5).select("title downloads");
    const recentUploads = await PDF.find().sort({ uploadedAt: -1 }).limit(5);
    const totalAiChats  = await AiChat.countDocuments();
    res.json({ success: true, stats: {
      totalPdfs, totalUsers, activeUsers, totalCats,
      totalDownloads: dlAgg[0]?.total || 0,
      storageUsed:    storageAgg[0]?.total || 0,
      topPdfs, recentUploads, totalAiChats
    }});
  });

  app.get(`${prefix}/logs`, adminAuth, async (req, res) => {
    const { limit = 100, type } = req.query;
    const query = type ? { type } : {};
    const logs  = await ActivityLog.find(query).sort({ timestamp: -1 }).limit(parseInt(limit));
    res.json({ success: true, logs });
  });

  app.post(`${prefix}/pdfs`, adminAuth,
    uploadFields.fields([{ name: "pdf", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]),
    async (req, res) => {
      try {
        if (!req.files?.pdf) return res.json({ success: false, message: "No file uploaded" });
        const { title, description, category, access = "public", subject, semester } = req.body;
        if (!title || !category) return res.json({ success: false, message: "Title and category required" });
        const uploadedFile  = req.files.pdf[0];
        const thumbnailFile = req.files.thumbnail?.[0];
        const detectedType  = ALLOWED_TYPES[uploadedFile.mimetype] || "pdf";
        const pdf = await PDF.create({
          title, description, category, access, subject, semester,
          filename: uploadedFile.filename, originalName: uploadedFile.originalname,
          fileSize: uploadedFile.size, fileType: detectedType,
          thumbnail: thumbnailFile ? thumbnailFile.filename : "",
          uploadedBy: "admin001"
        });
        await logActivity("upload", `Uploaded: ${title}`, "admin001");
        res.json({ success: true, pdf });
      } catch (err) { res.json({ success: false, message: err.message }); }
    }
  );

  app.get(`${prefix}/pdfs`, adminAuth, async (req, res) => {
    const { category, search, access } = req.query;
    const query = {};
    if (category) query.category = category;
    if (search)   query.title    = { $regex: search, $options: "i" };
    if (access)   query.access   = access;
    const pdfs = await PDF.find(query).sort({ uploadedAt: -1 });
    res.json({ success: true, pdfs, total: pdfs.length });
  });

  app.put(`${prefix}/pdfs/:id`, adminAuth,
    uploadFields.fields([{ name: "thumbnail", maxCount: 1 }]),
    async (req, res) => {
      try {
        const existing = await PDF.findById(req.params.id);
        if (!existing) return res.json({ success: false, message: "File not found" });
        const { title, description, category, access, subject, semester } = req.body;
        const update = { title, description, category, access, subject, semester, updatedAt: new Date() };
        if (req.files?.thumbnail?.[0]) {
          if (existing.thumbnail) {
            const oldThumb = path.join(process.cwd(), "uploads/thumbnails", existing.thumbnail);
            if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb);
          }
          update.thumbnail = req.files.thumbnail[0].filename;
        }
        const pdf = await PDF.findByIdAndUpdate(req.params.id, update, { new: true });
        await logActivity("edit_pdf", `Updated: ${title}`, "admin001");
        res.json({ success: true, pdf });
      } catch (err) { res.json({ success: false, message: err.message }); }
    }
  );

  app.delete(`${prefix}/pdfs/:id`, adminAuth, async (req, res) => {
    const pdf = await PDF.findByIdAndDelete(req.params.id);
    if (!pdf) return res.json({ success: false, message: "File not found" });
    const fp = path.join(process.cwd(), "uploads/pdfs", pdf.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    if (pdf.thumbnail) {
      const tp = path.join(process.cwd(), "uploads/thumbnails", pdf.thumbnail);
      if (fs.existsSync(tp)) fs.unlinkSync(tp);
    }
    await logActivity("delete_pdf", `Deleted: ${pdf.title}`, "admin001");
    res.json({ success: true, message: "File deleted" });
  });

  app.post(`${prefix}/pdfs/bulk`, adminAuth, uploadBulk.array("pdfs", 20), async (req, res) => {
    if (!req.files?.length) return res.json({ success: false, message: "No files selected" });
    const { category = "", access = "public" } = req.body;
    const uploaded = [];
    for (const file of req.files) {
      const ext   = path.extname(file.originalname).replace(".", "");
      const title = file.originalname.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
      const detectedType = ALLOWED_TYPES[file.mimetype] || ext || "pdf";
      const pdf = await PDF.create({
        title, category, access,
        filename: file.filename, originalName: file.originalname,
        fileSize: file.size, fileType: detectedType, uploadedBy: "admin001"
      });
      uploaded.push({ id: pdf._id, title, type: detectedType });
    }
    await logActivity("bulk_upload", `Bulk: ${uploaded.length} files`, "admin001");
    res.json({ success: true, message: `${uploaded.length} files uploaded`, uploaded });
  });

  app.get(`${prefix}/categories`, adminAuth, async (req, res) => {
    const cats = await Category.find().sort({ name: 1 });
    res.json({ success: true, categories: cats });
  });
  app.post(`${prefix}/categories`, adminAuth, async (req, res) => {
    const { name, department } = req.body;
    if (!name) return res.json({ success: false, message: "Name required" });
    const cat = await Category.create({ name, department: department || name });
    res.json({ success: true, category: cat });
  });
  app.delete(`${prefix}/categories/:id`, adminAuth, async (req, res) => {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Category deleted" });
  });

  app.get(`${prefix}/users`, adminAuth, async (req, res) => {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json({ success: true, users, total: users.length });
  });
  app.put(`${prefix}/users/:id/suspend`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { status: "suspended" });
    await logActivity("suspend_user", `Suspended: ${req.params.id}`, "admin001");
    res.json({ success: true, message: "User suspended" });
  });
  app.put(`${prefix}/users/:id/activate`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { status: "active" });
    res.json({ success: true, message: "User activated" });
  });
  app.delete(`${prefix}/users/:id`, adminAuth, async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.json({ success: false, message: "Not found" });
    await logActivity("delete_user", `Deleted: ${user.email}`, "admin001");
    res.json({ success: true, message: "User deleted" });
  });
  app.put(`${prefix}/users/:id/promote`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { role: "moderator" });
    res.json({ success: true, message: "Promoted to moderator" });
  });
  app.put(`${prefix}/users/:id/resetpoints`, adminAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, {
      aiPoints: 5, aiPointsResetAt: new Date(Date.now() + 24*60*60*1000)
    });
    await logActivity("reset_points", `Points reset: ${req.params.id}`, "admin001");
    res.json({ success: true, message: "AI points reset to 5" });
  });

  app.post(`${prefix}/notifications`, adminAuth, async (req, res) => {
    const { title, message, type = "announcement", sendEmail } = req.body;
    if (!title || !message) return res.json({ success: false, message: "Required" });
    const userCount = await User.countDocuments();
    const notif = await Notification.create({ title, message, type, sentBy: "admin001", recipients: userCount });
    if (sendEmail) {
      const users = await User.find({ status: "active" }).select("email");
      users.forEach(u => transporter.sendMail({
        from: process.env.EMAIL_USER, to: u.email,
        subject: `[MASTER BIOMEDS] ${title}`,
        html: `<div style="background:#071018;padding:40px;color:white;font-family:Arial;"><h1 style="color:#00d9ff;">MASTER BIOMEDS</h1><h2>${title}</h2><p>${message}</p></div>`
      }).catch(() => {}));
    }
    await logActivity("notification", `Notif: ${title}`, "admin001");
    res.json({ success: true, notification: notif });
  });
  app.get(`${prefix}/notifications`, adminAuth, async (req, res) => {
    const notifs = await Notification.find().sort({ sentAt: -1 }).limit(50);
    res.json({ success: true, notifications: notifs });
  });

  app.get(`${prefix}/analytics`, adminAuth, async (req, res) => {
    const topDownloaded = await PDF.find().sort({ downloads: -1 }).limit(10);
    const cats          = await Category.find();
    const storageAgg    = await PDF.aggregate([{ $group: { _id: null, total: { $sum: "$fileSize" } } }]);
    const storageUsed   = storageAgg[0]?.total || 0;
    const activeUsers   = await User.countDocuments({ status: "active" });
    const totalDlAgg    = await PDF.aggregate([{ $group: { _id: null, t: { $sum: "$downloads" } } }]);
    const totalAiChats  = await AiChat.countDocuments();
    const byCategory    = await Promise.all(cats.map(async c => {
      const agg = await PDF.aggregate([
        { $match: { category: c._id.toString() } },
        { $group: { _id: null, total: { $sum: "$downloads" } } }
      ]);
      return { ...c.toObject(), downloads: agg[0]?.total || 0 };
    }));
    res.json({ success: true, analytics: {
      topDownloaded, byCategory, storageUsed,
      storageUsedMB:    (storageUsed / 1024 / 1024).toFixed(2),
      activeUsers,
      totalDownloads:   totalDlAgg[0]?.t || 0,
      totalAiQuestions: totalAiChats
    }});
  });

  app.get(`${prefix}/settings`, adminAuth, async (req, res) => {
    try {
      const settings = await Settings.find();
      const obj = {};
      settings.forEach(s => {
        obj[s.key] = (s.key === "gemini_api_key" && s.value.length > 6)
          ? "••••••••••••" + s.value.slice(-6) : s.value;
      });
      res.json({ success: true, settings: obj });
    } catch (err) { res.json({ success: false, message: err.message }); }
  });

  app.post(`${prefix}/settings/gemini-key`, adminAuth, async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || apiKey.trim().length < 10)
      return res.json({ success: false, message: "Enter a valid Gemini API key" });
    try {
      await Settings.findOneAndUpdate(
        { key: "gemini_api_key" },
        { key: "gemini_api_key", value: apiKey.trim(), updatedAt: new Date() },
        { upsert: true, new: true }
      );
      await logActivity("settings", "Gemini API key updated", "admin001");
      res.json({ success: true, message: "Gemini API key saved!" });
    } catch (err) { res.json({ success: false, message: err.message }); }
  });

  app.post(`${prefix}/settings/change-password`, adminAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.json({ success: false, message: "Both fields required" });
    if (newPassword.length < 6)
      return res.json({ success: false, message: "Min 6 characters" });
    try {
      const pwdSetting = await Settings.findOne({ key: "admin_password" });
      const currentPwd = pwdSetting?.value || process.env.ADMIN_PASSWORD || "Admin123";
      if (currentPassword !== currentPwd)
        return res.json({ success: false, message: "Current password is incorrect" });
      await Settings.findOneAndUpdate(
        { key: "admin_password" },
        { key: "admin_password", value: newPassword, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      await logActivity("settings", "Admin password changed", "admin001");
      res.json({ success: true, message: "Password changed successfully!" });
    } catch (err) { res.json({ success: false, message: err.message }); }
  });

  app.post(`${prefix}/settings/ai-points`, adminAuth, async (req, res) => {
    const { points } = req.body;
    if (!points || points < 1 || points > 100)
      return res.json({ success: false, message: "Points must be 1-100" });
    try {
      await Settings.findOneAndUpdate(
        { key: "daily_ai_points" },
        { key: "daily_ai_points", value: String(points), updatedAt: new Date() },
        { upsert: true, new: true }
      );
      res.json({ success: true, message: `Daily AI points set to ${points}` });
    } catch (err) { res.json({ success: false, message: err.message }); }
  });
}

// Register routes for BOTH prefixes
registerAdminRoutes("/api/xadmin");
registerAdminRoutes("/api/mbx9k");

// ============================
// SELF-PING (prevent Render sleep)
// ============================
function startSelfPing() {
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(async () => {
    try {
      const res = await fetch(`${SELF_URL}/ping`);
      const data = await res.json();
      console.log(`🏓 Self-ping OK — uptime: ${data.uptime}s`);
    } catch (err) {
      console.warn(`⚠️  Self-ping failed: ${err.message}`);
    }
  }, 5 * 60 * 1000); // every 5 minutes
  console.log(`✅ Self-ping started → every 5 min → ${SELF_URL}/ping`);
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
║  MongoDB: Connected ✅               ║
╚══════════════════════════════════════╝`);
    startSelfPing();
  });
});

// This line forces redeploy - ping route already exists above
