// === Meeting Transcriber - Offscreen Audio Processor ===
// Captures TAB audio only (remote participants).
// Microphone is captured separately via content script in the meeting page.

let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let isCapturing = false;

// === Message Handler ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'offscreen') return;

    switch (msg.type) {
        case 'START_CAPTURE':
            startCapture(msg.streamId);
            break;

        case 'STOP_CAPTURE':
            stopCapture();
            break;
    }
});

// === Start Audio Capture ===
async function startCapture(streamId) {
    try {
        if (isCapturing) {
            stopCapture();
        }

        // Get TAB audio stream (remote participants only)
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            }
        });

        isCapturing = true;

        // === IMPORTANT: Play tab audio back through speakers ===
        // tabCapture intercepts audio, so we must route it back to output
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(audioContext.destination);

        // Record tab audio in chunks
        mediaRecorder = new MediaRecorder(mediaStream, {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 64000
        });

        let chunkCount = 0;
        mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0 && isCapturing) {
                try {
                    chunkCount++;
                    const buffer = await event.data.arrayBuffer();
                    const uint8 = new Uint8Array(buffer);
                    const base64 = uint8ToBase64(uint8);

                    chrome.runtime.sendMessage({
                        type: 'AUDIO_DATA',
                        data: base64
                    });
                } catch (err) {
                    console.error('[Offscreen] Error sending audio chunk:', err);
                }
            }
        };

        mediaRecorder.onerror = (event) => {
            console.error('[Offscreen] MediaRecorder error:', event.error);
            stopCapture();
        };

        // 250ms chunks for low-latency streaming
        mediaRecorder.start(250);

        console.log('[Offscreen] Tab audio capture started (with speaker playback)');
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_STARTED' });
    } catch (err) {
        console.error('[Offscreen] Error starting capture:', err);
    }
}

// === Stop Audio Capture ===
function stopCapture() {
    isCapturing = false;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    mediaRecorder = null;
    console.log('[Offscreen] Tab audio capture stopped');
}

// === Helpers ===
function uint8ToBase64(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
}
