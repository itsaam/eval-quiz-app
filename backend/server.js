import express from "express";
import cors from "cors";
import pg from "pg";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 3007;

// Trust proxy (Nginx) pour que express-rate-limit identifie correctement les IPs
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());

// Health probes should not consume the API rate limit.
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Rate limiting - general (100 requests per 15 min)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Trop de requêtes, veuillez réessayer plus tard" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting - strict for registration (5 per 15 min per IP)
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: "Trop de tentatives d'inscription, veuillez réessayer plus tard",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting - for results submission (10 per 15 min per IP)
const resultsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Trop de soumissions, veuillez réessayer plus tard" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Max connections per backend instance
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Admin config
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN, FROM_EMAIL, RESULT_EMAIL_RECIPIENT } = process.env;

if (process.env.NODE_ENV === "production" && (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET)) {
  throw new Error("Set ADMIN_PASSWORD and JWT_SECRET before starting the production server.");
}

function csvText(value) {
  const text = String(value ?? "");
  const safe = /^\s*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token required" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ isAdmin: true, username }, JWT_SECRET, {
    expiresIn: "24h",
  });

  res.json({ token });
});

// Get all results (admin) - grouped by email
app.get("/api/admin/results", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      "SELECT COUNT(DISTINCT u.email) FROM quiz_results qr JOIN users u ON qr.user_id = u.id"
    );
    const total = parseInt(countResult.rows[0].count);

    const results = await pool.query(
      `SELECT
        u.email,
        MAX(u.firstname) as firstname,
        COUNT(*) as attempts,
        (ARRAY_AGG(qr.score ORDER BY qr.score::numeric / NULLIF(qr.total_questions, 0) DESC NULLS LAST, qr.completed_at DESC, qr.id DESC))[1] as best_score,
        (ARRAY_AGG(qr.total_questions ORDER BY qr.score::numeric / NULLIF(qr.total_questions, 0) DESC NULLS LAST, qr.completed_at DESC, qr.id DESC))[1] as total_questions,
        ROUND(AVG(qr.score::numeric / NULLIF(qr.total_questions, 0)) * 100, 1) as avg_percentage,
        MAX(qr.completed_at) as last_attempt
      FROM quiz_results qr
      JOIN users u ON qr.user_id = u.id
      GROUP BY u.email
      ORDER BY last_attempt DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      results: results.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching results:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Export results as CSV (admin) - grouped by email
app.get("/api/admin/results/export", authenticateAdmin, async (req, res) => {
  try {
    const results = await pool.query(
      `SELECT
        u.email,
        MAX(u.firstname) as firstname,
        COUNT(*) as attempts,
        (ARRAY_AGG(qr.score ORDER BY qr.score::numeric / NULLIF(qr.total_questions, 0) DESC NULLS LAST, qr.completed_at DESC, qr.id DESC))[1] as best_score,
        (ARRAY_AGG(qr.total_questions ORDER BY qr.score::numeric / NULLIF(qr.total_questions, 0) DESC NULLS LAST, qr.completed_at DESC, qr.id DESC))[1] as total_questions,
        ROUND(AVG(qr.score::numeric / NULLIF(qr.total_questions, 0)) * 100, 1) as avg_percentage,
        ROUND(MAX(qr.score::numeric / NULLIF(qr.total_questions, 0)) * 100, 1) as best_percentage,
        MAX(qr.completed_at) as last_attempt
      FROM quiz_results qr
      JOIN users u ON qr.user_id = u.id
      GROUP BY u.email
      ORDER BY last_attempt DESC`
    );

    const csv = [
      "Prénom,Email,Tentatives,Meilleur Score,Total Questions,Moyenne %,Meilleur %,Dernière Tentative",
      ...results.rows.map(
        (r) =>
          `${csvText(r.firstname)},${csvText(r.email)},${r.attempts},${r.best_score},${r.total_questions},${r.avg_percentage}%,${r.best_percentage}%,${csvText(r.last_attempt)}`
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=quiz-results.csv"
    );
    res.send("\uFEFF" + csv); // BOM for Excel UTF-8
  } catch (error) {
    console.error("Error exporting results:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete old results (admin)
app.delete("/api/admin/results/old", authenticateAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const days = parseInt(req.query.days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    await client.query("BEGIN");

    // Get quiz_result IDs to delete
    const resultsToDelete = await client.query(
      "SELECT id FROM quiz_results WHERE completed_at < $1",
      [cutoffDate]
    );
    const ids = resultsToDelete.rows.map((r) => r.id);

    if (ids.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ deleted: 0, message: "No old results to delete" });
    }

    // Delete answers first (foreign key)
    await client.query("DELETE FROM answers WHERE quiz_result_id = ANY($1)", [
      ids,
    ]);

    // Delete quiz results
    const deleteResult = await client.query(
      "DELETE FROM quiz_results WHERE id = ANY($1)",
      [ids]
    );

    // Delete orphan users (users with no quiz results)
    await client.query(
      `DELETE FROM users WHERE id NOT IN (SELECT DISTINCT user_id FROM quiz_results)`
    );

    await client.query("COMMIT");

    res.json({
      deleted: deleteResult.rowCount,
      message: `Deleted ${deleteResult.rowCount} results older than ${days} days`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting old results:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// Delete ALL results (admin)
app.delete("/api/admin/results/all", authenticateAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Delete all answers
    await client.query("DELETE FROM answers");

    // Delete all quiz results
    const deleteResult = await client.query("DELETE FROM quiz_results");

    // Delete all users
    await client.query("DELETE FROM users");

    await client.query("COMMIT");

    res.json({
      deleted: deleteResult.rowCount,
      message: `${deleteResult.rowCount} résultat(s) supprimé(s)`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting all results:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// Create user (with honeypot check and rate limiting)
app.post("/api/users", registrationLimiter, async (req, res) => {
  try {
    const { firstname, email, website } = req.body;

    // Honeypot check - if 'website' field is filled, it's a bot
    if (website) {
      // Silently reject but return success to confuse bots
      return res.status(201).json({ id: 0, firstname, email });
    }

    if (typeof firstname !== "string" || !firstname.trim() || firstname.length > 100 ||
        typeof email !== "string" || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res
        .status(400)
        .json({ error: "Firstname and email are required" });
    }

    const result = await pool.query(
      "INSERT INTO users (firstname, email) VALUES ($1, $2) RETURNING id, firstname, email",
      [firstname.trim(), email]
    );

    const user = result.rows[0];
    const submissionToken = jwt.sign({ quizUserId: user.id }, JWT_SECRET, {
      audience: "stacklab-quiz",
      expiresIn: "2h",
    });
    res.status(201).json({ ...user, submissionToken });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Save quiz results and send email (with rate limiting)
app.post("/api/results", resultsLimiter, async (req, res) => {
  const { userId, score, totalQuestions, answers, submissionToken } = req.body;
  if (!Number.isInteger(userId) || userId < 1 ||
      !Number.isInteger(totalQuestions) || totalQuestions < 1 || totalQuestions > 50 ||
      !Number.isInteger(score) || score < 0 || score > totalQuestions ||
      !Array.isArray(answers) || answers.length !== totalQuestions ||
      !answers.every((answer, index) => answer && answer.questionIndex === index &&
        typeof answer.questionText === "string" && typeof answer.correctAnswer === "string" &&
        (answer.userAnswer === null || typeof answer.userAnswer === "string") &&
        answer.isCorrect === (answer.userAnswer === answer.correctAnswer) &&
        Number.isInteger(answer.timeSpentMs) && answer.timeSpentMs >= 0) ||
      score !== answers.filter((answer) => answer.isCorrect).length) {
    return res.status(400).json({ error: "Invalid quiz result" });
  }

  try {
    const claim = jwt.verify(submissionToken, JWT_SECRET, { audience: "stacklab-quiz" });
    if (claim.quizUserId !== userId) {
      return res.status(403).json({ error: "Invalid submission token" });
    }
  } catch {
    return res.status(403).json({ error: "Invalid submission token" });
  }

  let client;
  let quizResultId;
  let user;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const registered = await client.query("SELECT email FROM users WHERE id = $1 FOR UPDATE", [userId]);
    user = registered.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unknown registration" });
    }
    const previous = await client.query("SELECT 1 FROM quiz_results WHERE user_id = $1", [userId]);
    if (previous.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Result already saved" });
    }

    // Insert quiz result
    const resultQuery = await client.query(
      "INSERT INTO quiz_results (user_id, score, total_questions) VALUES ($1, $2, $3) RETURNING id",
      [userId, score, totalQuestions]
    );
    quizResultId = resultQuery.rows[0].id;

    // Insert each answer
    for (const answer of answers) {
      await client.query(
        `INSERT INTO answers (quiz_result_id, question_index, question_text, user_answer, correct_answer, is_correct, time_spent_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          quizResultId,
          answer.questionIndex,
          answer.questionText,
          answer.userAnswer ?? "",
          answer.correctAnswer,
          answer.isCorrect,
          answer.timeSpentMs,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    console.error("Error saving results:", error);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client?.release();
  }

  let emailAccepted = false;
  try {
    emailAccepted = await sendResultEmail(user, score, totalQuestions);
  } catch (error) {
    console.error("Cloudflare email request failed", error.name);
  }
  res.status(201).json({ message: "Results saved", quizResultId, emailAccepted });
});

async function sendResultEmail(user, score, totalQuestions) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_EMAIL_API_TOKEN || !FROM_EMAIL ||
      (RESULT_EMAIL_RECIPIENT && user.email.toLowerCase() !== RESULT_EMAIL_RECIPIENT.toLowerCase())) {
    return false;
  }

  const percentage = Math.round((score / totalQuestions) * 100);

  const account = encodeURIComponent(CLOUDFLARE_ACCOUNT_ID);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_EMAIL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: user.email,
        subject: `Résultats Stacklab - ${score}/${totalQuestions}`,
        text: `Ton score est de ${score}/${totalQuestions} (${percentage} %).`,
      }),
      signal: AbortSignal.timeout(8000),
    }
  );
  const { success, result } = await response.json();
  if (response.ok && success && (result?.queued?.length || result?.delivered?.length)) {
    return true;
  }
  console.error("Cloudflare did not accept the result email", response.status);
  return false;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
