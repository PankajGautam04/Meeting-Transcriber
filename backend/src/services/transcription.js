// === Transcription Service (Deepgram Integration) ===

const WebSocket = require('ws');
const logger = require('../utils/logger');

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

/**
 * Deepgram streaming configuration
 * - nova-2: Latest model with best accuracy
 * - diarize: Speaker separation
 * - smart_format: Auto-punctuation and formatting
 * - filler_words: Detect "um", "uh" etc. (helps with speaker tracking)
 * - utterance_end_ms: Time to determine utterance boundaries
 */
const DEFAULT_CONFIG = {
    model: 'nova-2',
    language: 'en',
    smart_format: 'true',
    punctuate: 'true',
    diarize: 'true',
    interim_results: 'true',
    utterance_end_ms: '1000',
    vad_events: 'true',
    // Do NOT specify encoding/sample_rate/channels
    // Deepgram auto-detects WebM/Opus container format from MediaRecorder
    filler_words: 'false',
    redact: 'false'
};

/**
 * Create a Deepgram real-time transcription stream
 *
 * @param {string} apiKey - Deepgram API key
 * @param {object} callbacks
 * @param {function} callbacks.onTranscript - (data) => void
 * @param {function} callbacks.onError - (error) => void
 * @param {function} callbacks.onClose - () => void
 * @param {object} [configOverrides] - Override default config params
 * @returns {{ send: function, close: function, isConnected: function }}
 */
function createTranscriptionStream(apiKey, callbacks, configOverrides = {}) {
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    const params = new URLSearchParams(config);
    const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;

    logger.info('Creating Deepgram stream', {
        model: config.model,
        diarize: config.diarize,
        language: config.language
    });

    const ws = new WebSocket(url, {
        headers: { Authorization: `Token ${apiKey}` }
    });

    let isOpen = false;
    let keepAliveInterval = null;
    let speakerSet = new Set();

    ws.on('open', () => {
        logger.info('Deepgram WebSocket connected');
        isOpen = true;

        // Notify caller that Deepgram is ready to receive audio
        callbacks.onReady?.();

        // Keep-alive every 10 seconds to prevent timeout
        keepAliveInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'KeepAlive' }));
            }
        }, 10000);
    });

    ws.on('message', (rawData) => {
        try {
            const response = JSON.parse(rawData.toString());

            if (response.type === 'Results') {
                const alt = response.channel?.alternatives?.[0];
                if (!alt || !alt.transcript) return;

                const words = alt.words || [];
                const isFinal = response.is_final;
                const segments = groupWordsBySpeaker(words);

                // Track unique speakers
                segments.forEach((seg) => speakerSet.add(seg.speaker));

                segments.forEach((segment) => {
                    callbacks.onTranscript?.({
                        type: 'transcript',
                        speaker: segment.speaker,
                        text: segment.text,
                        start: segment.start,
                        end: segment.end,
                        confidence: segment.confidence,
                        is_final: isFinal,
                        speaker_count: speakerSet.size
                    });
                });
            }

            if (response.type === 'Metadata') {
                logger.debug('Deepgram metadata', {
                    request_id: response.request_id,
                    model: response.model_info?.name
                });
            }
        } catch (err) {
            logger.error('Error parsing Deepgram message', { error: err.message });
        }
    });

    ws.on('error', (err) => {
        logger.error('Deepgram WebSocket error', { error: err.message });
        callbacks.onError?.(err);
    });

    ws.on('close', (code, reason) => {
        logger.info('Deepgram connection closed', { code, reason: reason?.toString() });
        isOpen = false;
        clearInterval(keepAliveInterval);
        callbacks.onClose?.();
    });

    return {
        send(audioData) {
            if (isOpen && ws.readyState === WebSocket.OPEN) {
                ws.send(audioData);
            }
        },

        close() {
            clearInterval(keepAliveInterval);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'CloseStream' }));
            }
            setTimeout(() => ws.close(), 500);
        },

        isConnected() {
            return isOpen && ws.readyState === WebSocket.OPEN;
        },

        getSpeakerCount() {
            return speakerSet.size;
        }
    };
}

/**
 * Group transcribed words by speaker ID
 * @param {Array} words - Array of word objects from Deepgram
 * @returns {Array} Speaker-grouped segments
 */
function groupWordsBySpeaker(words) {
    if (!words || words.length === 0) return [];

    const segments = [];
    let current = null;

    for (const word of words) {
        const speaker = word.speaker ?? 0;
        const text = word.punctuated_word || word.word;
        const confidence = word.confidence || 0;

        if (!current || current.speaker !== speaker) {
            if (current) segments.push(current);
            current = {
                speaker,
                text,
                start: word.start,
                end: word.end,
                confidence
            };
        } else {
            current.text += ` ${text}`;
            current.end = word.end;
            current.confidence = (current.confidence + confidence) / 2;
        }
    }

    if (current) segments.push(current);
    return segments;
}

module.exports = { createTranscriptionStream, groupWordsBySpeaker };
