// === Database Service ===

const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'transcripts.db');

let db;

/**
 * Initialize the database connection and create tables
 */
function initialize() {
    try {
        // Ensure data directory exists
        const fs = require('fs');
        const dataDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        // Create tables
        db.exec(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Untitled Meeting',
        meeting_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        duration INTEGER DEFAULT 0,
        speaker_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transcript_id TEXT NOT NULL,
        speaker_id INTEGER NOT NULL,
        speaker_label TEXT NOT NULL,
        text TEXT NOT NULL,
        start_time REAL,
        end_time REAL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_segments_transcript
        ON segments(transcript_id);
      CREATE INDEX IF NOT EXISTS idx_segments_time
        ON segments(transcript_id, start_time);
    `);

        logger.info('Database initialized', { path: DB_PATH });
        return db;
    } catch (err) {
        logger.error('Database initialization failed', { error: err.message });
        throw err;
    }
}

// === Prepared Statements (lazy init) ===
let stmts = null;

function getStmts() {
    if (!stmts) {
        stmts = {
            createTranscript: db.prepare(
                'INSERT INTO transcripts (id, title, meeting_url) VALUES (?, ?, ?)'
            ),
            updateDuration: db.prepare(
                'UPDATE transcripts SET duration = ?, speaker_count = ? WHERE id = ?'
            ),
            addSegment: db.prepare(
                'INSERT INTO segments (transcript_id, speaker_id, speaker_label, text, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)'
            ),
            getTranscripts: db.prepare(
                'SELECT * FROM transcripts ORDER BY created_at DESC LIMIT ?'
            ),
            getTranscriptById: db.prepare(
                'SELECT * FROM transcripts WHERE id = ?'
            ),
            getSegmentsByTranscript: db.prepare(
                'SELECT * FROM segments WHERE transcript_id = ? ORDER BY start_time ASC'
            ),
            deleteTranscript: db.prepare(
                'DELETE FROM transcripts WHERE id = ?'
            ),
            getTranscriptCount: db.prepare(
                'SELECT COUNT(*) as count FROM transcripts'
            )
        };
    }
    return stmts;
}

// === CRUD Operations ===

function createTranscript(id, title, meetingUrl) {
    try {
        const resolvedTitle = title || 'Untitled Meeting';
        getStmts().createTranscript.run(id, resolvedTitle, meetingUrl);
        logger.info('Transcript created', { id, title: resolvedTitle });
        return { id, title: resolvedTitle, meetingUrl };
    } catch (err) {
        logger.error('Failed to create transcript', { id, error: err.message });
        throw err;
    }
}

function updateTranscriptMeta(id, duration, speakerCount) {
    try {
        getStmts().updateDuration.run(duration, speakerCount, id);
        logger.debug('Transcript updated', { id, duration, speakerCount });
    } catch (err) {
        logger.error('Failed to update transcript', { id, error: err.message });
        throw err;
    }
}

function addSegment(transcriptId, speakerId, speakerLabel, text, startTime, endTime) {
    try {
        const result = getStmts().addSegment.run(
            transcriptId, speakerId, speakerLabel, text, startTime, endTime
        );
        return result.lastInsertRowid;
    } catch (err) {
        logger.error('Failed to add segment', { transcriptId, error: err.message });
        throw err;
    }
}

function getTranscripts(limit = 50) {
    return getStmts().getTranscripts.all(limit);
}

function getTranscriptById(id) {
    const transcript = getStmts().getTranscriptById.get(id);
    if (!transcript) return null;

    const segments = getStmts().getSegmentsByTranscript.all(id);
    return { ...transcript, segments };
}

function deleteTranscript(id) {
    // Foreign key cascade handles segments
    const result = getStmts().deleteTranscript.run(id);
    logger.info('Transcript deleted', { id });
    return result.changes > 0;
}

function getStats() {
    const { count } = getStmts().getTranscriptCount.get();
    return { totalTranscripts: count };
}

/**
 * Close the database connection gracefully
 */
function close() {
    if (db) {
        db.close();
        logger.info('Database connection closed');
    }
}

module.exports = {
    initialize,
    createTranscript,
    updateTranscriptMeta,
    addSegment,
    getTranscripts,
    getTranscriptById,
    deleteTranscript,
    getStats,
    close
};
