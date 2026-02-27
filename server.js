import http from "http";
import { Server } from "socket.io";
import mysql from "mysql2/promise";
import app from "./db.js"; // Express app
import { uploadLearn } from "./multerLearn.js";
import dotenv from "dotenv";
dotenv.config();

// 🔹 Create DB connection ONLY for chat
const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("sendMessage", async (data) => {
    try {
      const { sender_name, sender_role, message } = data;

      await db.execute(
        "INSERT INTO community_messages (sender_name, sender_role, message) VALUES (?, ?, ?)",
        [sender_name, sender_role, message]
      );

      io.emit("receiveMessage", {
        sender_name,
        sender_role,
        message,
        created_at: new Date(),
      });
    } catch (err) {
      console.error("❌ Chat error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});


// Admin upload
app.post("/admin/learn/upload", uploadLearn.single("file"), async (req, res) => {
  if (!req.session.admin)
    return res.status(401).json({ message: "Unauthorized" });

  const { title, description, type } = req.body;
  const filePath = req.file ? req.file.filename : null;

  await db.execute(
    "INSERT INTO learn_materials (title, description, type, file_path) VALUES (?,?,?,?)",
    [title, description, type, filePath]
  );

  res.json({ message: "Material uploaded successfully" });
});


// ✅ ONLY PLACE THAT LISTENS
// server.listen(8081, () => {
//   console.log("✅ Express + Socket.IO running on port 8081");
// });

const PORT = process.env.PORT || 8081;

server.listen(PORT, () => {
  console.log(`✅ Express + Socket.IO running on port ${PORT}`);
});
