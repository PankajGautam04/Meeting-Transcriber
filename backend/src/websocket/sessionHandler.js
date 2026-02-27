// === WebSocket Session Handler ===
// Handles dual audio streams: tab audio (remote) + mic audio (local user)
// Each gets its own Deepgram connection for proper speaker identification

const { v4: uuidv4 } = require('uuid');
const { WebSocket } = require('ws');
const db = require('../services/database');
const { createTranscriptionStream } = require('../services/transcription');
const logger = require('../utils/logger');

/**
 * Generate a meeting title from URL
 */
function generateTitle(meetingUrl) {
    try {
        const url = new URL(meetingUrl);
        const host = url.hostname.replace('www.', '');

        const titles = {
            'meet.google.com': 'Google Meet Session',
            'zoom.us': 'Zoom Meeting',
            'teams.microsoft.com': 'Teams Meeting',
            'webex.com': 'Webex Meeting',
            'whereby.com': 'Whereby Meeting'
        };

        for (const [domain, title] of Object.entries(titles)) {
            if (host.includes(domain)) return title;
        }
        return `Meeting on ${host}`;
    } catch {
        return 'Meeting Transcript';
    }
}

/**
 * Handle a single WebSocket client connection
 * Supports dual audio streams: tab (0x00 prefix) and mic (0x01 prefix)
 */
function handleSession(clientWs, apiKey) {
    const sessionId = uuidv4().slice(0, 8);
    let transcriptId = null;
    let tabDeepgram = null;    // Deepgram stream for tab audio (remote participants)
    let micDeepgram = null;    // Deepgram stream for mic audio (local user)
    let startTime = Date.now();
    let speakerCount = 0;
    let sessionApiKey = apiKey; // Can be overridden by client

    // Buffering for audio that arrives before Deepgram connects
    let tabBuffer = [];
    let micBuffer = [];
    let tabReady = false;
    let micReady = false;

    let tabChunkCount = 0;
    let micChunkCount = 0;

    logger.info('Client connected', { sessionId });

    clientWs.on('message', (data, isBinary) => {
        try {
            if (!isBinary && isJsonMessage(data)) {
                const msg = JSON.parse(data.toString());
                handleControlMessage(msg);
            } else if (isBinary || Buffer.isBuffer(data)) {
                // Binary audio data — check prefix byte
                const buf = Buffer.from(data);
                if (buf.length < 2) return;

                const streamType = buf[0]; // 0x00 = tab, 0x01 = mic
                const audioData = buf.slice(1); // actual audio data (without prefix)

                if (streamType === 0x00) {
                    // Tab audio (remote participants)
                    tabChunkCount++;
                    if (tabChunkCount <= 3 || tabChunkCount % 100 === 0) {
                        logger.info('Tab audio chunk', {
                            sessionId,
                            chunk: tabChunkCount,
                            size: audioData.length,
                            deepgramReady: tabReady
                        });
                    }

                    if (tabReady && tabDeepgram?.isConnected()) {
                        tabDeepgram.send(audioData);
                    } else {
                        tabBuffer.push(Buffer.from(audioData));
                    }
                } else if (streamType === 0x01) {
                    // Mic audio (local user)
                    micChunkCount++;
                    if (micChunkCount <= 3 || micChunkCount % 100 === 0) {
                        logger.info('Mic audio chunk', {
                            sessionId,
                            chunk: micChunkCount,
                            size: audioData.length,
                            deepgramReady: micReady
                        });
                    }

                    if (micReady && micDeepgram?.isConnected()) {
                        micDeepgram.send(audioData);
                    } else {
                        micBuffer.push(Buffer.from(audioData));
                    }
                }
            }
        } catch (err) {
            logger.error('Error processing message', { sessionId, error: err.message });
        }
    });

    clientWs.on('close', () => {
        logger.info('Client disconnected', { sessionId });
        cleanup();
    });

    clientWs.on('error', (err) => {
        logger.error('Client WebSocket error', { sessionId, error: err.message });
    });

    /**
     * Handle JSON control messages (START/STOP)
     */
    function handleControlMessage(msg) {
        switch (msg.type) {
            case 'START':
                // If client sends an API key, use it instead of server default
                if (msg.apiKey) {
                    sessionApiKey = msg.apiKey;
                    logger.info('Using client-provided API key', { sessionId });
                }
                startTranscription(msg.meetingUrl);
                break;
            case 'STOP':
                stopTranscription();
                break;
            default:
                logger.warn('Unknown message type', { sessionId, type: msg.type });
        }
    }

    /**
     * Start a new transcription session with dual Deepgram streams
     */
    function startTranscription(meetingUrl) {
        transcriptId = uuidv4();
        startTime = Date.now();
        const title = generateTitle(meetingUrl || '');

        db.createTranscript(transcriptId, title, meetingUrl);
        logger.info('Transcription started', { sessionId, transcriptId, title });

        if (!sessionApiKey || sessionApiKey === 'your_deepgram_api_key_here') {
            logger.warn('No Deepgram API key configured', { sessionId });
            sendToClient({
                type: 'warning',
                message: 'No Deepgram API key configured. Go to extension Settings and set your API key.'
            });
            return;
        }

        // === Tab audio Deepgram stream (Remote participants) ===
        tabDeepgram = createTranscriptionStream(sessionApiKey, {
            onReady: () => {
                logger.info('Tab Deepgram ready — flushing buffer', {
                    sessionId,
                    buffered: tabBuffer.length
                });
                for (const chunk of tabBuffer) {
                    tabDeepgram.send(chunk);
                }
                tabBuffer = [];
                tabReady = true;
            },
            onTranscript: (transcript) => {
                // Tag as remote speaker
                if (transcript.is_final && transcript.text.trim()) {
                    const speakerLabel = `Speaker ${(transcript.speaker || 0) + 1}`;
                    db.addSegment(
                        transcriptId,
                        transcript.speaker || 0,
                        speakerLabel,
                        transcript.text,
                        transcript.start,
                        transcript.end
                    );
                    speakerCount = Math.max(speakerCount, (transcript.speaker || 0) + 1);
                }
                // Forward to extension UI
                sendToClient({
                    ...transcript,
                    speaker: (transcript.speaker || 0) + 1  // offset by 1 (0 = You)
                });
            },
            onError: (err) => {
                sendToClient({
                    type: 'error',
                    message: `Tab transcription error: ${err.message}`
                });
            },
            onClose: () => {
                logger.info('Tab Deepgram stream ended', { sessionId });
            }
        });

        // === Mic audio Deepgram stream (Local user = "You") ===
        micDeepgram = createTranscriptionStream(sessionApiKey, {
            onReady: () => {
                logger.info('Mic Deepgram ready — flushing buffer', {
                    sessionId,
                    buffered: micBuffer.length
                });
                for (const chunk of micBuffer) {
                    micDeepgram.send(chunk);
                }
                micBuffer = [];
                micReady = true;
            },
            onTranscript: (transcript) => {
                // Tag as local speaker (You = speaker 0)
                if (transcript.is_final && transcript.text.trim()) {
                    db.addSegment(
                        transcriptId,
                        0,           // speaker 0 = You
                        'You',
                        transcript.text,
                        transcript.start,
                        transcript.end
                    );
                    speakerCount = Math.max(speakerCount, 1);
                }
                // Forward to extension UI with speaker=0 (You)
                sendToClient({
                    ...transcript,
                    speaker: 0,
                    speaker_label: 'You'
                });
            },
            onError: (err) => {
                sendToClient({
                    type: 'error',
                    message: `Mic transcription error: ${err.message}`
                });
            },
            onClose: () => {
                logger.info('Mic Deepgram stream ended', { sessionId });
            }
        });
    }

    /**
     * Stop the current transcription
     */
    function stopTranscription() {
        logger.info('Transcription stopping', { sessionId, transcriptId });

        if (tabDeepgram) {
            tabDeepgram.close();
            tabDeepgram = null;
        }
        if (micDeepgram) {
            micDeepgram.close();
            micDeepgram = null;
        }

        if (transcriptId) {
            const duration = Math.floor((Date.now() - startTime) / 1000);
            db.updateTranscriptMeta(transcriptId, duration, speakerCount);
            logger.info('Transcript saved', { transcriptId, duration, speakerCount });
        }
    }

    /**
     * Send JSON message to the client
     */
    function sendToClient(data) {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(data));
        }
    }

    /**
     * Cleanup on disconnect
     */
    function cleanup() {
        if (tabDeepgram) {
            tabDeepgram.close();
            tabDeepgram = null;
        }
        if (micDeepgram) {
            micDeepgram.close();
            micDeepgram = null;
        }

        if (transcriptId) {
            const duration = Math.floor((Date.now() - startTime) / 1000);
            db.updateTranscriptMeta(transcriptId, duration, speakerCount);
        }
    }
}

/**
 * Check if a WebSocket message is a JSON control message
 */
function isJsonMessage(data) {
    try {
        const str = data.toString();
        if (str.startsWith('{') || str.startsWith('[')) {
            JSON.parse(str);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

module.exports = { handleSession };
