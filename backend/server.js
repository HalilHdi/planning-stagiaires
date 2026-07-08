const express = require("express");
const cors = require("cors");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;
const DB_PATH = path.join(__dirname, "planning.db");

app.use(cors());
app.use(express.json());

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
      poste TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration : les anciennes colonnes debut/fin de stagiaires deviennent une table à part (périodes multiples)
  const stagiaireCols = db.exec("PRAGMA table_info(stagiaires)");
  const hasLegacyDates = stagiaireCols.length > 0 && stagiaireCols[0].values.some(row => row[1] === "debut");
  if (hasLegacyDates) {
    db.run(`
      CREATE TABLE IF NOT EXISTS periodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stagiaire_id INTEGER NOT NULL,
        debut TEXT NOT NULL,
        fin TEXT NOT NULL
      )
    `);
    db.run("INSERT INTO periodes (stagiaire_id, debut, fin) SELECT id, debut, fin FROM stagiaires");
    db.run(`
      CREATE TABLE stagiaires_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        prenom TEXT NOT NULL,
        poste TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run("INSERT INTO stagiaires_new (id, nom, prenom, poste, created_at) SELECT id, nom, prenom, poste, created_at FROM stagiaires");
    db.run("DROP TABLE stagiaires");
    db.run("ALTER TABLE stagiaires_new RENAME TO stagiaires");
    console.log("✓ Migration : périodes multiples par stagiaire");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS periodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stagiaire_id INTEGER NOT NULL,
      debut TEXT NOT NULL,
      fin TEXT NOT NULL
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

  db.run(`
    CREATE TABLE IF NOT EXISTS desk_layout (
      desk_id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      o TEXT NOT NULL,
      cp TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS phone_layout (
      phone_id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
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

function getPeriodes(stagiaireId) {
  return getAll("SELECT id, debut, fin FROM periodes WHERE stagiaire_id = ? ORDER BY debut ASC", [stagiaireId]);
}

function getStagiairesWithPeriodes() {
  const stagiaires = getAll("SELECT * FROM stagiaires");
  const periodes = getAll("SELECT * FROM periodes");
  const parStagiaire = {};
  periodes.forEach(p => { (parStagiaire[p.stagiaire_id] ??= []).push({ id: p.id, debut: p.debut, fin: p.fin }); });
  return stagiaires
    .map(s => {
      const ps = (parStagiaire[s.id] || []).sort((a, b) => a.debut.localeCompare(b.debut));
      return { ...s, periodes: ps };
    })
    .sort((a, b) => (a.periodes[0]?.debut || "").localeCompare(b.periodes[0]?.debut || ""));
}

function validatePeriodes(periodes) {
  if (!Array.isArray(periodes) || periodes.length === 0) {
    return "Au moins une période (début/fin) est requise";
  }
  for (const p of periodes) {
    if (!p.debut || !p.fin) return "Chaque période doit avoir une date de début et de fin";
    if (new Date(p.fin) < new Date(p.debut)) return "La date de fin doit être postérieure à la date de début";
  }
  return null;
}

// ─── ROUTES : STAGIAIRES ────────────────────────────────────────

// GET tous les stagiaires
app.get("/api/stagiaires", (req, res) => {
  try {
    res.json(getStagiairesWithPeriodes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET un stagiaire par id
app.get("/api/stagiaires/:id", (req, res) => {
  try {
    const stagiaire = getOne("SELECT * FROM stagiaires WHERE id = ?", [req.params.id]);
    if (!stagiaire) return res.status(404).json({ error: "Stagiaire non trouvé" });
    res.json({ ...stagiaire, periodes: getPeriodes(stagiaire.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST créer un stagiaire
app.post("/api/stagiaires", (req, res) => {
  try {
    const { nom, prenom, poste, periodes } = req.body;

    if (!nom || !prenom) {
      return res.status(400).json({ error: "Tous les champs sont requis : nom, prenom" });
    }
    const periodesError = validatePeriodes(periodes);
    if (periodesError) return res.status(400).json({ error: periodesError });

    db.run("INSERT INTO stagiaires (nom, prenom, poste) VALUES (?, ?, ?)", [nom, prenom, poste || ""]);
    const id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
    periodes.forEach(p => db.run("INSERT INTO periodes (stagiaire_id, debut, fin) VALUES (?, ?, ?)", [id, p.debut, p.fin]));
    saveDB();

    const created = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);

    res.status(201).json({ ...created, periodes: getPeriodes(id) });
    console.log(`+ Stagiaire ajouté : ${prenom} ${nom}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT modifier un stagiaire
app.put("/api/stagiaires/:id", (req, res) => {
  try {
    const { nom, prenom, poste, periodes } = req.body;
    const { id } = req.params;

    const existing = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Stagiaire non trouvé" });

    if (periodes) {
      const periodesError = validatePeriodes(periodes);
      if (periodesError) return res.status(400).json({ error: periodesError });
    }

    db.run(
      "UPDATE stagiaires SET nom = ?, prenom = ?, poste = ? WHERE id = ?",
      [nom || existing.nom, prenom || existing.prenom, poste ?? existing.poste, id]
    );

    if (periodes) {
      db.run("DELETE FROM periodes WHERE stagiaire_id = ?", [id]);
      periodes.forEach(p => db.run("INSERT INTO periodes (stagiaire_id, debut, fin) VALUES (?, ?, ?)", [id, p.debut, p.fin]));
    }
    saveDB();

    const updated = getOne("SELECT * FROM stagiaires WHERE id = ?", [id]);
    res.json({ ...updated, periodes: getPeriodes(id) });
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
    runQuery("DELETE FROM periodes WHERE stagiaire_id = ?", [id]);
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
             s.nom, s.prenom, s.poste
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
      SELECT a.*, s.nom, s.prenom, s.poste
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

// ─── ROUTES : DISPOSITION DES BUREAUX ───────────────────────────

// GET toutes les positions personnalisées
app.get("/api/desk-layout", (req, res) => {
  try {
    res.json(getAll("SELECT * FROM desk_layout"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT positionner/pivoter un bureau
app.put("/api/desk-layout/:deskId", (req, res) => {
  try {
    const { deskId } = req.params;
    const { x, y, o, cp } = req.body;

    if (typeof x !== "number" || typeof y !== "number" || !o || !cp) {
      return res.status(400).json({ error: "x, y, o et cp sont requis" });
    }
    if (!["h", "v"].includes(o) || !["top", "bottom", "left", "right"].includes(cp)) {
      return res.status(400).json({ error: "Orientation ou position de chaise invalide" });
    }

    runQuery(
      `INSERT OR REPLACE INTO desk_layout (desk_id, x, y, o, cp, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [deskId, x, y, o, cp]
    );

    res.json({ desk_id: deskId, x, y, o, cp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE réinitialiser la disposition (tous les bureaux)
app.delete("/api/desk-layout", (req, res) => {
  try {
    runQuery("DELETE FROM desk_layout");
    res.json({ message: "Disposition réinitialisée" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES : POSTES TÉLÉPHONIQUES ───────────────────────────────

// GET positions personnalisées des postes téléphoniques
app.get("/api/phone-layout", (req, res) => {
  try {
    res.json(getAll("SELECT * FROM phone_layout"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT déplacer un poste téléphonique
app.put("/api/phone-layout/:phoneId", (req, res) => {
  try {
    const { phoneId } = req.params;
    const { x, y } = req.body;

    if (typeof x !== "number" || typeof y !== "number") {
      return res.status(400).json({ error: "x et y sont requis" });
    }

    runQuery(
      `INSERT OR REPLACE INTO phone_layout (phone_id, x, y, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [phoneId, x, y]
    );

    res.json({ phone_id: phoneId, x, y });
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
    console.log("║  GET    /api/desk-layout                 ║");
    console.log("║  PUT    /api/desk-layout/:id              ║");
    console.log("║  DELETE /api/desk-layout                 ║");
    console.log("║  GET    /api/phone-layout                ║");
    console.log("║  PUT    /api/phone-layout/:id             ║");
    console.log("║  GET    /api/stats                       ║");
    console.log("║  GET    /api/health                      ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log("");
  });
});
