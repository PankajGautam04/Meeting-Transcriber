// === Meeting Transcriber - Content Script (MAIN world) ===
// Runs in the meeting page context (meet.google.com, zoom.us, etc.)
// Can access getUserMedia using the PAGE's origin, which already has mic permission!

(function () {
    'use strict';

    // Prevent duplicate injection
    if (window.__meetingTranscriberLoaded) return;
    window.__meetingTranscriberLoaded = true;
    let micStream = null;
    let micRecorder = null;
    let isCapturing = false;

    // Listen for commands from the bridge content script
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'meeting-transcriber-bridge') return;

        switch (event.data.type) {
            case 'START_MIC_CAPTURE':
                startMicCapture();
                break;
            case 'STOP_MIC_CAPTURE':
                stopMicCapture();
                break;
        }
    });

    async function startMicCapture() {
        if (isCapturing) return;

        try {
            // This uses the PAGE's origin (e.g., meet.google.com)
            // which already has microphone permission from the meeting!
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            isCapturing = true;
            console.log('[Meeting Transcriber] Microphone captured via page context');

            // Record mic audio in chunks and send to bridge
            micRecorder = new MediaRecorder(micStream, {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 32000
            });

            micRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0 && isCapturing) {
                    try {
                        const buffer = await event.data.arrayBuffer();
                        const uint8 = new Uint8Array(buffer);
                        // Convert to base64 for message passing
                        let binary = '';
                        for (let i = 0; i < uint8.length; i++) {
                            binary += String.fromCharCode(uint8[i]);
                        }
                        const base64 = btoa(binary);

                        window.postMessage({
                            source: 'meeting-transcriber-main',
                            type: 'MIC_AUDIO_DATA',
                            data: base64
                        }, '*');
                    } catch (err) {
                        console.error('[Meeting Transcriber] Error encoding mic data:', err);
                    }
                }
            };

            micRecorder.start(250); // 250ms chunks to match tab audio

            window.postMessage({
                source: 'meeting-transcriber-main',
                type: 'MIC_CAPTURE_STARTED'
            }, '*');

        } catch (err) {
            console.error('[Meeting Transcriber] Mic capture failed:', err.message);
            window.postMessage({
                source: 'meeting-transcriber-main',
                type: 'MIC_CAPTURE_FAILED',
                error: err.message
            }, '*');
        }
    }

    function stopMicCapture() {
        isCapturing = false;

        if (micRecorder && micRecorder.state !== 'inactive') {
            micRecorder.stop();
        }
        micRecorder = null;

        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            micStream = null;
        }

        console.log('[Meeting Transcriber] Mic capture stopped');
    }

    // Signal that the content script is ready
    window.postMessage({
        source: 'meeting-transcriber-main',
        type: 'CONTENT_SCRIPT_READY'
    }, '*');

    console.log('[Meeting Transcriber] Content script loaded in page context');
})();
