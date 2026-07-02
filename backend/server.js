require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;
const DB_PATH = path.join(__dirname, "planning.db");

const APP_PASSWORD = process.env.APP_PASSWORD || "changeme";
if (!process.env.APP_PASSWORD) {
  console.warn("⚠ APP_PASSWORD non défini, mot de passe par défaut 'changeme' utilisé. Définissez APP_PASSWORD dans backend/.env");
}
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const sessions = new Map(); // token -> expiry timestamp

app.use(cors());
app.use(express.json());

// ─── AUTHENTIFICATION ───────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.json({ token });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/login" || req.path === "/health") return next();
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Non authentifié" });
  }
  next();
});

let db;

// ─── DATABASE INIT ───────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log("✓ Base de données chargée depuis", DB_PATH);
  } else {
    db = new SQL.Database();
    console.log("✓ Nouvelle base de données créée");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS stagiaires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      debut TEXT NOT NULL,
      fin TEXT NOT NULL,
      poste TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assignments (
      desk_id TEXT PRIMARY KEY,
      stagiaire_id INTEGER,
      unavailable INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (stagiaire_id) REFERENCES stagiaires(id) ON DELETE CASCADE
    )
  `);

  saveDB();
  console.log("✓ Tables initialisées");
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ─── HELPERS ─────────────────────────────────────────────────────
function getAll(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getOne(query, params = []) {
  const rows = getAll(query, params);
  return rows.length > 0 ? rows[0] : null;
}

function runQuery(query, params = []) {
  db.run(query, params);
  saveDB();
}

// ─── ROUTES : STAGIAIRES ────────────────────────────────────────

// GET tous les stagiaires
app.get("/api/stagiaires", (req, res) => {
  try {
    const stagiaires = getAll("SELECT * FROM stagiaires ORDER BY debut ASC");
    res.json(stagiaires);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET un stagiaire par id
app.get("/api/stagiaires/:id", (req, res) => {
  try {
    const stagiaire = getOne("SELECT * FROM stagiaires WHERE id = ?", [req.params.id]);
    if (!stagiaire) return res.status(404).json({ error: "Stagiaire non trouvé" });
    res.json(stagiaire);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST créer un stagiaire
app.post("/api/stagiaires", (req, res) => {
  try {
    const { nom, prenom, debut, fin, poste } = req.body;

    if (!nom || !prenom || !debut || !fin) {
      return res.status(400).json({ error: "Tous les champs sont requis : nom, prenom, debut, fin" });
    }

    if (new Date(fin) < new Date(debut)) {
      return res.status(400).json({ error: "La date de fin doit être postérieure à la date de début" });
    }

    runQuery(
      "INSERT INTO stagiaires (nom, prenom, debut, fin, poste) VALUES (?, ?, ?, ?, ?)",
      [nom, prenom, debut, fin, poste || ""]
    );

    const id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
    const created = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);

    res.status(201).json(created);
    console.log(`+ Stagiaire ajouté : ${prenom} ${nom}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT modifier un stagiaire
app.put("/api/stagiaires/:id", (req, res) => {
  try {
    const { nom, prenom, debut, fin, poste } = req.body;
    const { id } = req.params;

    const existing = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Stagiaire non trouvé" });

    if (fin && debut && new Date(fin) < new Date(debut)) {
      return res.status(400).json({ error: "La date de fin doit être postérieure à la date de début" });
    }

    runQuery(
      "UPDATE stagiaires SET nom = ?, prenom = ?, debut = ?, fin = ?, poste = ? WHERE id = ?",
      [
        nom || existing.nom,
        prenom || existing.prenom,
        debut || existing.debut,
        fin || existing.fin,
        poste || existing.poste,
        id,
      ]
    );

    const updated = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);
    res.json(updated);
    console.log(`~ Stagiaire modifié : ${updated.prenom} ${updated.nom}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE supprimer un stagiaire
app.delete("/api/stagiaires/:id", (req, res) => {
  try {
    const { id } = req.params;
    const existing = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Stagiaire non trouvé" });

    // Libérer les bureaux assignés à ce stagiaire
    runQuery("DELETE FROM assignments WHERE stagiaire_id = ?", [id]);
    runQuery("DELETE FROM stagiaires WHERE id = ?", [id]);

    res.json({ message: "Stagiaire supprimé", id: Number(id) });
    console.log(`- Stagiaire supprimé : ${existing.prenom} ${existing.nom}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES : ASSIGNMENTS ───────────────────────────────────────

// GET toutes les affectations
app.get("/api/assignments", (req, res) => {
  try {
    const assignments = getAll(`
      SELECT a.desk_id, a.stagiaire_id, a.unavailable, a.updated_at,
             s.nom, s.prenom, s.poste, s.debut, s.fin
      FROM assignments a
      LEFT JOIN stagiaires s ON a.stagiaire_id = s.id
    `);
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST affecter un stagiaire à un bureau
app.post("/api/assignments", (req, res) => {
  try {
    const { desk_id, stagiaire_id } = req.body;

    if (!desk_id) {
      return res.status(400).json({ error: "desk_id est requis" });
    }

    if (stagiaire_id) {
      // Vérifier que le stagiaire existe
      const stag = getOne("SELECT * FROM stagiaires WHERE id = ?", [stagiaire_id]);
      if (!stag) return res.status(404).json({ error: "Stagiaire non trouvé" });

      // Vérifier que le stagiaire n'est pas déjà affecté ailleurs
      const existing = getOne("SELECT * FROM assignments WHERE stagiaire_id = ? AND desk_id != ?", [stagiaire_id, desk_id]);
      if (existing) {
        return res.status(409).json({ error: `Ce stagiaire est déjà affecté au bureau ${existing.desk_id}` });
      }

      runQuery(
        `INSERT OR REPLACE INTO assignments (desk_id, stagiaire_id, unavailable, updated_at) 
         VALUES (?, ?, 0, datetime('now'))`,
        [desk_id, stagiaire_id]
      );
      console.log(`→ Bureau ${desk_id} affecté à stagiaire #${stagiaire_id}`);
    }

    const result = getOne(`
      SELECT a.*, s.nom, s.prenom, s.poste, s.debut, s.fin
      FROM assignments a
      LEFT JOIN stagiaires s ON a.stagiaire_id = s.id
      WHERE a.desk_id = ?
    `, [desk_id]);

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT marquer un bureau indisponible
app.put("/api/assignments/:deskId/unavailable", (req, res) => {
  try {
    const { deskId } = req.params;

    runQuery(
      `INSERT OR REPLACE INTO assignments (desk_id, stagiaire_id, unavailable, updated_at)
       VALUES (?, NULL, 1, datetime('now'))`,
      [deskId]
    );

    res.json({ desk_id: deskId, unavailable: 1 });
    console.log(`⊘ Bureau ${deskId} marqué indisponible`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE libérer un bureau
app.delete("/api/assignments/:deskId", (req, res) => {
  try {
    const { deskId } = req.params;
    runQuery("DELETE FROM assignments WHERE desk_id = ?", [deskId]);
    res.json({ message: "Bureau libéré", desk_id: deskId });
    console.log(`○ Bureau ${deskId} libéré`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES : STATISTIQUES ──────────────────────────────────────

app.get("/api/stats", (req, res) => {
  try {
    const total = getOne("SELECT COUNT(*) as count FROM stagiaires");
    const byPoste = getAll(
      "SELECT poste, COUNT(*) as count FROM stagiaires GROUP BY poste ORDER BY count DESC"
    );
    const totalDesks = 11; // 5 grande + 6 petite
    const occupied = getOne(
      "SELECT COUNT(*) as count FROM assignments WHERE stagiaire_id IS NOT NULL AND unavailable = 0"
    );
    const unavailable = getOne(
      "SELECT COUNT(*) as count FROM assignments WHERE unavailable = 1"
    );

    res.json({
      stagiaires: {
        total: total.count,
        parPoste: byPoste,
      },
      bureaux: {
        total: totalDesks,
        occupes: occupied.count,
        indisponibles: unavailable.count,
        libres: totalDesks - occupied.count - unavailable.count,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH CHECK ───────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── START ──────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(PORT, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════╗");
    console.log("║   StagiairePlan — Backend API            ║");
    console.log(`║   http://localhost:${PORT}                  ║`);
    console.log("╠══════════════════════════════════════════╣");
    console.log("║  GET    /api/stagiaires                  ║");
    console.log("║  POST   /api/stagiaires                  ║");
    console.log("║  PUT    /api/stagiaires/:id               ║");
    console.log("║  DELETE /api/stagiaires/:id               ║");
    console.log("║  GET    /api/assignments                 ║");
    console.log("║  POST   /api/assignments                 ║");
    console.log("║  PUT    /api/assignments/:id/unavailable  ║");
    console.log("║  DELETE /api/assignments/:id              ║");
    console.log("║  GET    /api/stats                       ║");
    console.log("║  GET    /api/health                      ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log("");
  });
});
