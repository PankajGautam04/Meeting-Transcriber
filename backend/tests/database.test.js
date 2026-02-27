// === Database Service Unit Tests ===

const path = require('path');
const fs = require('fs');

// Use a temp DB for testing
const TEST_DB_DIR = path.join(__dirname, '..', 'data');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'transcripts.db');

// Clean up before tests
beforeAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
    }
});

const db = require('../src/services/database');

describe('Database Service', () => {
    beforeAll(() => {
        db.initialize();
    });

    afterAll(() => {
        db.close();
        // Cleanup test DB
        try {
            if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
            const walPath = TEST_DB_PATH + '-wal';
            const shmPath = TEST_DB_PATH + '-shm';
            if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
            if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe('createTranscript()', () => {
        it('should create a new transcript', () => {
            const result = db.createTranscript('test-1', 'Test Meeting', 'https://meet.google.com/abc');
            expect(result).toEqual({
                id: 'test-1',
                title: 'Test Meeting',
                meetingUrl: 'https://meet.google.com/abc'
            });
        });

        it('should use default title when none provided', () => {
            const result = db.createTranscript('test-2', null, 'https://zoom.us/j/123');
            expect(result.title).toBe('Untitled Meeting');
        });

        it('should throw on duplicate ID', () => {
            expect(() => {
                db.createTranscript('test-1', 'Duplicate', 'https://example.com');
            }).toThrow();
        });
    });

    describe('getTranscripts()', () => {
        it('should return all transcripts', () => {
            const transcripts = db.getTranscripts();
            expect(transcripts.length).toBeGreaterThanOrEqual(2);
            expect(transcripts[0]).toHaveProperty('id');
            expect(transcripts[0]).toHaveProperty('title');
            expect(transcripts[0]).toHaveProperty('created_at');
        });

        it('should respect the limit parameter', () => {
            const transcripts = db.getTranscripts(1);
            expect(transcripts.length).toBe(1);
        });
    });

    describe('addSegment()', () => {
        it('should add a transcript segment', () => {
            const segId = db.addSegment('test-1', 0, 'Speaker 1', 'Hello world', 0.5, 2.3);
            expect(segId).toBeDefined();
        });

        it('should add multiple segments', () => {
            db.addSegment('test-1', 1, 'Speaker 2', 'Good morning', 2.5, 4.0);
            db.addSegment('test-1', 0, 'Speaker 1', 'How are you?', 4.5, 6.0);

            const transcript = db.getTranscriptById('test-1');
            expect(transcript.segments.length).toBe(3);
        });
    });

    describe('getTranscriptById()', () => {
        it('should return transcript with segments', () => {
            const transcript = db.getTranscriptById('test-1');
            expect(transcript).not.toBeNull();
            expect(transcript.id).toBe('test-1');
            expect(transcript.title).toBe('Test Meeting');
            expect(Array.isArray(transcript.segments)).toBe(true);
            expect(transcript.segments.length).toBe(3);
        });

        it('should return segments ordered by start_time', () => {
            const transcript = db.getTranscriptById('test-1');
            const times = transcript.segments.map((s) => s.start_time);
            expect(times).toEqual([...times].sort((a, b) => a - b));
        });

        it('should return null for non-existent ID', () => {
            const result = db.getTranscriptById('does-not-exist');
            expect(result).toBeNull();
        });
    });

    describe('updateTranscriptMeta()', () => {
        it('should update duration and speaker count', () => {
            db.updateTranscriptMeta('test-1', 120, 2);
            const transcript = db.getTranscriptById('test-1');
            expect(transcript.duration).toBe(120);
            expect(transcript.speaker_count).toBe(2);
        });
    });

    describe('getStats()', () => {
        it('should return transcript count', () => {
            const stats = db.getStats();
            expect(stats.totalTranscripts).toBeGreaterThanOrEqual(2);
        });
    });

    describe('deleteTranscript()', () => {
        it('should delete a transcript and its segments', () => {
            const deleted = db.deleteTranscript('test-1');
            expect(deleted).toBe(true);

            const result = db.getTranscriptById('test-1');
            expect(result).toBeNull();
        });

        it('should return false for non-existent ID', () => {
            const deleted = db.deleteTranscript('does-not-exist');
            expect(deleted).toBe(false);
        });
    });
});
