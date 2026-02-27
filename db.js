import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import session from "express-session";
import cookieParser from "cookie-parser";
import bcrypt from "bcrypt";
import axios from "axios";
import { uploadProfile } from "./multerLearn.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.use("/learn-files", express.static("uploads/learn"));    //learn multer
app.use("/profile-images", express.static("uploads/profile"));   //profile multer


app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: "lax",
    },
  })
);

/* ================= DATABASE CONNECTION ================= */
const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

console.log("✅ MySQL connected");

//achieve
function calculateRankDetails(score) {
  const tiers = [
    "Bronze",
    "Silver",
    "Gold",
    "Platinum",
    "Diamond",
    "Heroic",
    "Crystal",
    "Master",
    "Champion",
    "Grandmaster",
    "Mythic",
    "Immortal"
  ];

  const tierIndex = Math.min(Math.floor(score / 250), tiers.length - 1);
  const tier = tiers[tierIndex];

  const level = 5 - Math.floor((score % 250) / 50);

  const xpInTier = score % 250;
  const progressPercent = (xpInTier / 250) * 100;

  const xpForNextRank = 250 - xpInTier;

  return {
    tier,
    level,
    progressPercent,
    xpInTier,
    xpForNextRank,
    nextTier: tiers[tierIndex + 1] || null,
    tierIndex
  };
}




/* ================= ROUTES ================= */

/* -------- ADMIN -------- */
app.get("/admin", (req, res) => {
  if (req.session.admin) return res.json({ valid: true, name: req.session.admin });
  return res.json({ valid: false });
});

app.post("/admin/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = "INSERT INTO admin_users (name,email,password) VALUES (?, ?, ?)";
    await db.execute(sql, [name, email, hashedPassword]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.execute("SELECT * FROM admin_users WHERE email = ?", [email]);

    if (rows.length === 0) return res.json({ Login: false });

    const match = await bcrypt.compare(password, rows[0].password);
    if (match) {
      req.session.admin = rows[0].name;
      return res.json({ Login: true });
    }
    res.json({ Login: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ Login: false });
  }
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/* -------- STUDENT -------- */
app.get("/student", (req, res) => {
  if (req.session.student) return res.json({ valid: true, name: req.session.student });
  res.json({ valid: false });
});

app.post("/student/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = "INSERT INTO student_users (name,email,password) VALUES (?, ?, ?)";
    await db.execute(sql, [name, email, hashedPassword]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/student/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.execute(
      "SELECT * FROM student_users WHERE email = ?",
      [email]
    );

    if (rows.length === 0) return res.json({ Login: false });

    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return res.json({ Login: false });

    const today = new Date();
    const lastLogin = rows[0].last_login
      ? new Date(rows[0].last_login)
      : null;

    let streak = rows[0].streak || 0;

    if (lastLogin) {
      const diffDays = Math.floor(
        (today - lastLogin) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        streak += 1; // continue streak
      } else if (diffDays > 1) {
        streak = 1; // reset streak
      }
      // if diffDays === 0 → same day login → keep streak
    } else {
      streak = 1; // first login
    }

    await db.execute(
      "UPDATE student_users SET last_login = ?, streak = ? WHERE email = ?",
      [today, streak, email]
    );

    req.session.student = rows[0].name;

    res.json({ Login: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ Login: false });
  }
});


app.get("/student/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/* -------- QUIZ MANAGEMENT -------- */

// Create quiz
app.post("/admin/quiz", async (req, res) => {
  try {
    if (!req.session.admin) return res.status(401).json({ message: "Unauthorized" });

    const { quiz_id, title, subject, difficulty } = req.body;
    const sql =
      "INSERT INTO quizzes (quiz_id, title, subject, difficulty, created_by) VALUES (?, ?, ?, ?, ?)";

    await db.execute(sql, [quiz_id, title, subject, difficulty, req.session.admin]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add question
app.post("/admin/question", async (req, res) => {
  try {
    if (!req.session.admin) return res.status(401).json({ message: "Unauthorized" });

    const { quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, topic } = req.body;

    const sql = `INSERT INTO questions 
      (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, topic) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    await db.execute(sql, [quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, topic]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get quizzes
app.get("/quizzes", async (req, res) => {
  try {
    const [quizzes] = await db.execute("SELECT * FROM quizzes");
    res.json({ success: true, quizzes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message }); 
  }
});

// Get quiz questions
app.get("/quiz/:quiz_id/questions", async (req, res) => {
  try {
    const { quiz_id } = req.params;
    const [questions] = await db.execute("SELECT * FROM questions WHERE quiz_id = ?", [quiz_id]);
    res.json({ success: true, questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Submit quiz
app.post("/quiz/submit", async (req, res) => {
  try {
    if (!req.session.student) return res.status(401).json({ message: "Unauthorized" });

    const { quiz_id, score, time_taken } = req.body;

    const [existing] = await db.execute(
      "SELECT 1 FROM quiz_results WHERE student_name = ? AND quiz_id = ?",
      [req.session.student, quiz_id]
    );

    if (existing.length > 0) return res.status(400).json({ message: "Quiz already completed" });

    await db.execute(
      "INSERT INTO quiz_results (student_name, quiz_id, score, time_taken) VALUES (?, ?, ?, ?)",
      [req.session.student, quiz_id, score, time_taken]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check quiz status
app.get("/quiz/:quiz_id/status", async (req, res) => {
  try {
    if (!req.session.student) return res.status(401).json({ message: "Unauthorized" });

    const { quiz_id } = req.params;
    const [rows] = await db.execute(
      "SELECT result_id FROM quiz_results WHERE student_name = ? AND quiz_id = ?",
      [req.session.student, quiz_id]
    );

    res.json({ completed: rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  }
});

// Get student completed quizzes
app.get("/student/completed-quizzes", async (req, res) => {
  try {
    if (!req.session.student) return res.json([]);

    const [rows] = await db.execute(
      "SELECT quiz_id FROM quiz_results WHERE student_name = ?",
      [req.session.student]
    );

    res.json(rows.map(r => r.quiz_id));
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// Get quiz result
app.get("/quiz/result/:quiz_id", async (req, res) => {
  try {
    if (!req.session.student) return res.status(401).json({ message: "Unauthorized" });

    const { quiz_id } = req.params;
    const [rows] = await db.execute(
      "SELECT * FROM quiz_results WHERE quiz_id = ? AND student_name = ? ORDER BY created_at DESC LIMIT 1",
      [quiz_id, req.session.student]
    );

    res.json({ success: true, result: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const currentUser = req.session.student || null;

    const [rows] = await db.execute(`
      SELECT
        student_name,
        COUNT(*) AS total_games_played,
        SUM(score) AS total_score
      FROM (
        SELECT student_name, score FROM quiz_results
        UNION ALL
        SELECT student_name, score FROM fill_game_results
        UNION ALL
        SELECT student_name, score FROM coding_results
        UNION ALL
        SELECT student_name, marks FROM paragraph_results
      ) AS combined_results
      GROUP BY student_name
      ORDER BY total_score DESC
    `);

    if (!rows.length) {
      return res.json({ success: true, leaderboard: [] });
    }

    // Add rank manually
    const ranked = rows.map((row, index) => ({
      rank: index + 1,
      ...row,
    }));

    // Top 20
    let top20 = ranked.slice(0, 20);

    // If logged user not in top 20, add them at bottom
    if (currentUser) {
      const userData = ranked.find(r => r.student_name === currentUser);

      if (userData && userData.rank > 20) {
        top20.push(userData);
      }
    }

    res.json({ success: true, leaderboard: top20 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});




// ---------------- AI ENDPOINTS ----------------
app.post("/ai/analyze", async (req, res) => {
  try {
    if (!req.session.student) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const response = await axios.post(
      `${process.env.AI_URL}/analyze`,
      { student_name: req.session.student },   // body
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(
      "FULL AI ERROR:",
      err.response?.data || "No response body",
      err.message
    );

    res.status(500).json(
      err.response?.data || { error: "AI crash" }
    );
  }
});



app.post("/ai/recommend-quiz", async (req, res) => {
  try {
    if (!req.session.student) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const response = await axios.post(
      `${process.env.AI_URL}/recommend-quiz`,
      { student_name: req.session.student },   // body
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(
      "AI recommend error FULL:",
      err.response?.data || err.message
    );

    res.status(500).json({ error: "AI service error" });
  }
});


//community group chat
// -------- COMMUNITY CHAT --------

// identify logged-in user (student/admin)
app.get("/community/user", (req, res) => {
  if (req.session.student) {
    return res.json({ name: req.session.student, role: "student" });
  }

  if (req.session.admin) {
    return res.json({ name: req.session.admin, role: "admin" });
  }

  res.status(401).json({ error: "Not logged in" });
});

// get messages
app.get("/community/messages", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM community_messages ORDER BY created_at ASC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load messages" });
  }
});


//profile
app.get("/student/profile", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    const [user] = await db.execute(
      "SELECT name, email, college, place, district, state, profile_image FROM student_users WHERE name = ?",
      [req.session.student]
    );

    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) AS total_games_played,
        AVG(score) AS avg_score
      FROM (
        SELECT score FROM quiz_results WHERE student_name = ?
        UNION ALL
        SELECT score FROM fill_game_results WHERE student_name = ?
        UNION ALL
        SELECT score FROM coding_results WHERE student_name = ?
        UNION ALL
        SELECT marks FROM paragraph_results WHERE student_name = ?
      ) AS combined_results
    `, [
      req.session.student,
      req.session.student,
      req.session.student,
      req.session.student
    ]);

    res.json({
      ...user[0],
      total_games_played: stats[0].total_games_played || 0,
      avg_score: Math.round(stats[0].avg_score || 0),
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//updated profile
app.post("/student/update-profile",
  uploadProfile.single("profile_image"),
  async (req, res) => {
    if (!req.session.student)
      return res.status(401).json({ message: "Unauthorized" });

    const { college, place, district, state } = req.body;

    try {
      let imagePath = null;

      if (req.file) {
        imagePath = req.file.filename;
      }

      await db.execute(
        `UPDATE student_users 
         SET college=?, place=?, district=?, state=?, 
         profile_image = COALESCE(?, profile_image)
         WHERE name=?`,
        [college, place, district, state, imagePath, req.session.student]
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);



//learn page on student
app.get("/student/learn", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const [materials] = await db.execute(
    "SELECT * FROM learn_materials ORDER BY created_at DESC"
  );

  res.json(materials);
});

//fill in game admin
app.post("/admin/games/fill/create", async (req, res) => {
  if (!req.session.admin)
    return res.status(401).json({ message: "Unauthorized" });

  const { title, topic, difficulty } = req.body;

  try {
    const [result] = await db.execute(
      "INSERT INTO fill_games (title, topic, difficulty, created_by) VALUES (?, ?, ?, ?)",
      [title, topic, difficulty, req.session.admin]
    );

    res.json({
      success: true,
      game_id: result.insertId   // ✅ RETURN ID
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/admin/games/fill-question", async (req, res) => {
  if (!req.session.admin)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id, question, answer } = req.body;

  await db.execute(
    "INSERT INTO fill_questions (game_id, question, answer) VALUES (?, ?, ?)",
    [game_id, question, answer]
  );

  res.json({ success: true });
});


//fill in std
app.get("/games/fill", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT game_id, title, topic, difficulty FROM fill_games"
  );
  res.json(rows);
});


app.get("/games/fill/:game_id", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id } = req.params;

  const [rows] = await db.execute(
    "SELECT question_id, question, answer FROM fill_questions WHERE game_id = ?",
    [game_id]
  );

  res.json(rows);
});

app.post("/games/fill/submit", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id, score, total } = req.body;

  try {
    await db.execute(
      "INSERT INTO fill_game_results (student_name, game_id, score, total) VALUES (?, ?, ?, ?)",
      [req.session.student, game_id, score, total]
    );

    res.json({ success: true });
  } catch (err) {
    // already played
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Game already completed" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/games/fill/:game_id/status", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id } = req.params;

  const [rows] = await db.execute(
    "SELECT result_id FROM fill_game_results WHERE student_name = ? AND game_id = ?",
    [req.session.student, game_id]
  );

  res.json({ completed: rows.length > 0 });
});

app.get("/games/fill/:game_id/result", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id } = req.params;

  const [rows] = await db.execute(
    "SELECT score, total FROM fill_game_results WHERE student_name = ? AND game_id = ?",
    [req.session.student, game_id]
  );

  res.json(rows[0]);
});

// Get student completed fill games
app.get("/student/completed-fill-games", async (req, res) => {
  try {
    if (!req.session.student) return res.json([]);

    const [rows] = await db.execute(
      "SELECT game_id FROM fill_game_results WHERE student_name = ?",
      [req.session.student]
    );

    res.json(rows.map(r => r.game_id));
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

//coding debug
app.post("/admin/games/coding/create", async (req, res) => {
  if (!req.session.admin)
    return res.status(401).json({ message: "Unauthorized" });

  const { title, topic, difficulty } = req.body;

  try {
    const [result] = await db.execute(
      "INSERT INTO coding_games (title, topic, difficulty, created_by) VALUES (?, ?, ?, ?)",
      [title, topic, difficulty, req.session.admin]
    );

    res.json({
      success: true,
      game_id: result.insertId  // ✅ SEND BACK GAME ID
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/admin/games/coding-question", async (req, res) => {
  if (!req.session.admin)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id, buggy_code, correct_code } = req.body;

  await db.execute(
    "INSERT INTO coding_questions (game_id, buggy_code, correct_code) VALUES (?, ?, ?)",
    [game_id, buggy_code, correct_code]
  );

  res.json({ success: true });
});

//student coding debug
app.get("/games/coding", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const [rows] = await db.execute(
    "SELECT game_id, title, topic, difficulty FROM coding_games"
  );

  res.json(rows);
});

app.get("/games/coding/:game_id", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id } = req.params;

  const [rows] = await db.execute(
    "SELECT question_id, buggy_code FROM coding_questions WHERE game_id = ?",
    [game_id]
  );

  res.json(rows[0]);
});

app.post("/games/coding/submit", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id, student_code } = req.body;

  try {
    const [rows] = await db.execute(
      "SELECT correct_code FROM coding_questions WHERE game_id = ?",
      [game_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Question not found" });
    }

    const normalize = (code) => {
      return code
        .replace(/\s+/g, "")   // REMOVE ALL WHITESPACE
        .trim();
    };

    const correct = normalize(rows[0].correct_code);
    const student = normalize(student_code);

    const score = correct === student ? 10 : 0;

    await db.execute(
      "INSERT INTO coding_results (student_name, game_id, score) VALUES (?, ?, ?)",
      [req.session.student, game_id, score]
    );

    res.json({ success: true, score });

  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Already completed" });
    }

    res.status(500).json({ error: err.message });
  }
});


app.get("/student/completed-coding-games", async (req, res) => {
  if (!req.session.student) return res.json([]);

  const [rows] = await db.execute(
    "SELECT game_id FROM coding_results WHERE student_name = ?",
    [req.session.student]
  );

  res.json(rows.map(r => r.game_id));
});


//achievement

app.get("/student/achievement", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    const [rows] = await db.execute(`
      SELECT SUM(score) AS total_score
      FROM (
        SELECT score FROM quiz_results WHERE student_name = ?
        UNION ALL
        SELECT score FROM fill_game_results WHERE student_name = ?
        UNION ALL
        SELECT score FROM coding_results WHERE student_name = ?
        UNION ALL
        SELECT marks FROM paragraph_results WHERE student_name = ?
      ) AS combined
    `, [
      req.session.student,
      req.session.student,
      req.session.student,
      req.session.student
    ]);

    const totalScore = rows[0].total_score || 0;

    const rankData = calculateRankDetails(totalScore);

res.json({
  success: true,
  totalScore,
  ...rankData,
});


  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//streak
app.get("/student/streak", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    const [rows] = await db.execute(
      "SELECT streak FROM student_users WHERE name = ?",
      [req.session.student]
    );

    res.json({ streak: rows[0]?.streak || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//admin stats
// ================= ADMIN DASHBOARD STATS =================
app.get("/admin/stats", async (req, res) => {
  if (!req.session.admin)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    const [[students]] = await db.execute(
      "SELECT COUNT(*) AS total_students FROM student_users"
    );

    const [[quizzes]] = await db.execute(
      "SELECT COUNT(*) AS total_quizzes FROM quizzes"
    );

    const [[fillGames]] = await db.execute(
      "SELECT COUNT(*) AS total_fill_games FROM fill_games"
    );

    const [[codingGames]] = await db.execute(
      "SELECT COUNT(*) AS total_coding_games FROM coding_games"
    );

    const [[paragraphGame]] = await db.execute(
      "SELECT COUNT(*) AS total_paragraph_games FROM paragraph_games"
    );

    res.json({
      totalStudents: students.total_students,
      totalQuizzes: quizzes.total_quizzes,
      totalFillGames: fillGames.total_fill_games,
      totalCodingGames: codingGames.total_coding_games,
      totalParagraphGames: paragraphGame.total_paragraph_games
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//chart
app.get("/student/chart-data", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    const student = req.session.student;

    const [[quizCount]] = await db.execute(
      "SELECT COUNT(*) AS count FROM quiz_results WHERE student_name = ?",
      [student]
    );

    const [[fillCount]] = await db.execute(
      "SELECT COUNT(*) AS count FROM fill_game_results WHERE student_name = ?",
      [student]
    );

    const [[codingCount]] = await db.execute(
      "SELECT COUNT(*) AS count FROM coding_results WHERE student_name = ?",
      [student]
    );

    const [[paraCount]] = await db.execute(
      "SELECT COUNT(*) AS count FROM paragraph_results WHERE student_name = ?",
      [student]
    );

    res.json({
      quiz: quizCount.count,
      fill: fillCount.count,
      coding: codingCount.count,
      para: paraCount.count,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//para
app.post("/games/paragraph/submit", async (req, res) => {
  if (!req.session.student)
  return res.status(401).json({ message: "Unauthorized" });

const { game_id, answer } = req.body;
const student_name = req.session.student;


  if (!answer || answer.trim().length === 0) {
    return res.json({ marks: 0, message: "Answer required" });
  }

  try {
    const [game] = await db.query(
      "SELECT topic, max_marks FROM paragraph_games WHERE game_id = ?",
      [game_id]
    );

    if (game.length === 0)
      return res.status(404).json({ message: "Game not found" });

    const topic = game[0].topic.toLowerCase();
    const maxMarks = game[0].max_marks;

    const letterCount = answer.length;

    // 🔹 Base Marks
    let marks = 2;

    if (letterCount >= 1000) marks = 10;
    else if (letterCount >= 750) marks = 7;
    else if (letterCount >= 500) marks = 5;

    // 🔹 Keyword Check
    const regex = new RegExp(topic, "gi");
    const keywordMatches = (answer.match(regex) || []).length;

    if (keywordMatches >= 5) marks += 2;
    else if (keywordMatches >= 3) marks += 1;

    if (marks > maxMarks) marks = maxMarks;

    await db.query(
      `INSERT INTO paragraph_results
       (student_name, game_id, answer, marks, letter_count)
       VALUES (?, ?, ?, ?, ?)`,
      [student_name, game_id, answer, marks, letterCount]
    );

    res.json({
      marks,
      letterCount,
      keywordMatches
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


//para create
app.post("/admin/paragraph/create", async (req, res) => {
  const { title, question, topic, difficulty, max_marks } = req.body;

  if (!title || !question || !topic || !difficulty || !max_marks) {
    return res.status(400).json({ message: "All fields required" });
  }

  try {
    await db.query(
      `INSERT INTO paragraph_games 
       (title, question, topic, difficulty, max_marks) 
       VALUES (?, ?, ?, ?, ?)`,
      [title, question, topic, difficulty, max_marks]
    );

    res.json({ message: "Paragraph game created successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/games/paragraph", async (req, res) => {
  try {
    const [games] = await db.query(
      "SELECT * FROM paragraph_games ORDER BY game_id DESC"
    );
    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/games/paragraph/:game_id", async (req, res) => {
  if (!req.session.student)
    return res.status(401).json({ message: "Unauthorized" });

  const { game_id } = req.params;

  try {
    const [rows] = await db.query(
      "SELECT * FROM paragraph_games WHERE game_id = ?",
      [game_id]
    );

    if (!rows.length)
      return res.status(404).json({ message: "Game not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/student/completed-paragraph-games", async (req, res) => {
  if (!req.session.student)
    return res.json([]);

  try {
    const [rows] = await db.query(
      "SELECT game_id FROM paragraph_results WHERE student_name = ?",
      [req.session.student]
    );

    res.json(rows.map(r => r.game_id));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});



/* ================= START SERVER ================= */ 
// app.listen(8081, () => {
//   console.log("✅ Server running on port 8081");
// });

export default app;

