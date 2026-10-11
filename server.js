import "dotenv/config";
import crypto from "crypto";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";

// If JWT_SECRET isn't set, a random one is used (everyone is logged out when the server restarts).
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

const Employee = mongoose.model(
  "Employee",
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true, unique: true },
      department: { type: String, required: true, trim: true },
      position: { type: String, required: true, trim: true },
      salary: { type: Number, required: true, min: 0 },
      role: { type: String, enum: ["admin", "employee"], default: "employee" },
      password: { type: String, select: false }, // stored hashed, never returned by queries
    },
    { timestamps: true }
  )
);

// Wraps an async route so any error becomes a clean JSON response.
const handle = (fn) => (req, res, next) =>
  fn(req, res, next).catch((e) => {
    if (e.code === 11000) return res.status(409).json({ error: "An account with this email already exists." });
    const bad = e.name === "ValidationError" || e.name === "CastError";
    if (!bad) console.error(e);
    res.status(bad ? 400 : 500).json({ error: bad ? "Please check the details and try again." : "Server error." });
  });

// Checks the login token. Pass "admin" to restrict a route to admins only.
const auth = (role) =>
  handle(async (req, res, next) => {
    let id;
    try {
      id = jwt.verify((req.headers.authorization || "").slice(7), SECRET).id;
    } catch {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    req.user = await Employee.findById(id);
    if (!req.user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    if (role && req.user.role !== role) return res.status(403).json({ error: "Only admins can do this." });
    next();
  });

const session = (u) => ({
  token: jwt.sign({ id: u._id }, SECRET, { expiresIn: "7d" }),
  user: { _id: u._id, name: u.name, role: u.role },
});

const app = express();
app.use(express.json());

app.post("/api/login", handle(async (req, res) => {
  const { email, password, role } = req.body;
  const user = await Employee.findOne({ email: String(email).toLowerCase().trim() }).select("+password");
  if (!user?.password || !(await bcrypt.compare(String(password), user.password)))
    return res.status(401).json({ error: "Incorrect email or password." });
  if (user.role !== role)
    return res.status(403).json({
      error: role === "admin" ? "This account doesn't have admin access." : "This is an admin account. Use the Admin tab to sign in.",
    });
  res.json(session(user));
}));

// Anyone can create an employee account. An admin account can only be created while no admin exists yet.
app.post("/api/signup", handle(async (req, res) => {
  const { name = "", email = "", password = "", role } = req.body;
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const admin = role === "admin";
  if (admin && (await Employee.exists({ role: "admin" })))
    return res.status(403).json({ error: "An admin account already exists. Ask your admin to create one for you." });
  const user = await Employee.create({
    name, email, salary: 0,
    role: admin ? "admin" : "employee",
    department: admin ? "Management" : "Unassigned",
    position: admin ? "Administrator" : "New hire",
    password: await bcrypt.hash(String(password), 10),
  });
  res.status(201).json(session(user));
}));

app.get("/api/employees", auth(), handle(async (req, res) => {
  const list = await Employee.find().sort({ createdAt: -1 }).lean();
  // Employees can only see their own salary.
  res.json(list.map((e) => (req.user.role === "admin" || e._id.equals(req.user._id) ? e : { ...e, salary: undefined })));
}));

app.post("/api/employees", auth("admin"), handle(async (req, res) => {
  const { password = "", ...data } = req.body;
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  await Employee.create({ ...data, password: await bcrypt.hash(String(password), 10) });
  res.status(201).json({ ok: true });
}));

app.put("/api/employees/:id", auth("admin"), handle(async (req, res) => {
  const { password, ...data } = req.body;
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    data.password = await bcrypt.hash(String(password), 10);
  }
  if (req.params.id === String(req.user._id)) delete data.role; // admins can't remove their own admin access
  const emp = await Employee.findByIdAndUpdate(req.params.id, data, { runValidators: true });
  emp ? res.json({ ok: true }) : res.status(404).json({ error: "Employee not found." });
}));

app.delete("/api/employees/:id", auth("admin"), handle(async (req, res) => {
  if (req.params.id === String(req.user._id)) return res.status(400).json({ error: "You can't delete your own account." });
  await Employee.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

// Serve the built React app (created by `npm run build`).
const dist = path.resolve("dist");
app.use(express.static(dist));
app.use((_, res) => res.sendFile(path.join(dist, "index.html")));

async function start() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/employee-management");

  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

start().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});