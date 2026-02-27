// === Transcription Service Unit Tests ===

const { groupWordsBySpeaker } = require('../src/services/transcription');

describe('Transcription Service', () => {
    describe('groupWordsBySpeaker()', () => {
        it('should return empty array for no words', () => {
            expect(groupWordsBySpeaker([])).toEqual([]);
            expect(groupWordsBySpeaker(null)).toEqual([]);
            expect(groupWordsBySpeaker(undefined)).toEqual([]);
        });

        it('should group consecutive words by same speaker', () => {
            const words = [
                { word: 'Hello', speaker: 0, start: 0.0, end: 0.5, confidence: 0.9 },
                { word: 'world', speaker: 0, start: 0.6, end: 1.0, confidence: 0.95 }
            ];

            const result = groupWordsBySpeaker(words);
            expect(result).toHaveLength(1);
            expect(result[0].speaker).toBe(0);
            expect(result[0].text).toBe('Hello world');
            expect(result[0].start).toBe(0.0);
            expect(result[0].end).toBe(1.0);
        });

        it('should split at speaker changes', () => {
            const words = [
                { word: 'Hello', speaker: 0, start: 0.0, end: 0.5, confidence: 0.9 },
                { word: 'Hi', speaker: 1, start: 1.0, end: 1.3, confidence: 0.88 },
                { word: 'there', speaker: 1, start: 1.4, end: 1.8, confidence: 0.92 }
            ];

            const result = groupWordsBySpeaker(words);
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ speaker: 0, text: 'Hello' });
            expect(result[1]).toMatchObject({ speaker: 1, text: 'Hi there' });
        });

        it('should handle same speaker returning after another', () => {
            const words = [
                { word: 'A', speaker: 0, start: 0, end: 0.5, confidence: 0.9 },
                { word: 'B', speaker: 1, start: 1, end: 1.5, confidence: 0.9 },
                { word: 'C', speaker: 0, start: 2, end: 2.5, confidence: 0.9 }
            ];

            const result = groupWordsBySpeaker(words);
            expect(result).toHaveLength(3);
            expect(result[0].speaker).toBe(0);
            expect(result[1].speaker).toBe(1);
            expect(result[2].speaker).toBe(0);
        });

        it('should use punctuated_word when available', () => {
            const words = [
                { word: 'hello', punctuated_word: 'Hello,', speaker: 0, start: 0, end: 0.5, confidence: 0.9 },
                { word: 'world', punctuated_word: 'world.', speaker: 0, start: 0.6, end: 1, confidence: 0.95 }
            ];

            const result = groupWordsBySpeaker(words);
            expect(result[0].text).toBe('Hello, world.');
        });

        it('should handle multiple speakers (5+) for scalability', () => {
            const words = [];
            for (let i = 0; i < 10; i++) {
                words.push({
                    word: `Speaker${i}`,
                    speaker: i % 5,
                    start: i * 2,
                    end: i * 2 + 1,
                    confidence: 0.9
                });
            }

            const result = groupWordsBySpeaker(words);
            // Each speaker change creates a new segment
            expect(result.length).toBeGreaterThanOrEqual(5);
        });

        it('should default speaker to 0 when undefined', () => {
            const words = [
                { word: 'test', start: 0, end: 0.5, confidence: 0.9 }
            ];

            const result = groupWordsBySpeaker(words);
            expect(result[0].speaker).toBe(0);
        });

        it('should calculate average confidence', () => {
            const words = [
                { word: 'a', speaker: 0, start: 0, end: 0.5, confidence: 0.8 },
                { word: 'b', speaker: 0, start: 0.6, end: 1, confidence: 1.0 }
            ];

            const result = groupWordsBySpeaker(words);
            expect(result[0].confidence).toBe(0.9);
        });
    });
});
