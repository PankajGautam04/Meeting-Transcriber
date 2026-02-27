// === Meeting Transcriber - Content Bridge Script (ISOLATED world) ===
// Bridges messages between the MAIN world content script and the
// extension's background service worker using chrome.runtime

(function () {
    'use strict';

    // Prevent duplicate injection
    if (window.__meetingTranscriberBridgeLoaded) return;
    window.__meetingTranscriberBridgeLoaded = true;
    // Listen for messages from the MAIN world content script
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'meeting-transcriber-main') return;

        const { type, data, error } = event.data;

        switch (type) {
            case 'MIC_AUDIO_DATA':
                // Forward mic audio chunk to background
                chrome.runtime.sendMessage({
                    type: 'MIC_AUDIO_DATA',
                    data: data
                });
                break;

            case 'MIC_CAPTURE_STARTED':
                console.log('[Transcriber Bridge] Mic capture started via page context');
                chrome.runtime.sendMessage({ type: 'MIC_CAPTURE_STATUS', status: 'started' });
                break;

            case 'MIC_CAPTURE_FAILED':
                console.warn('[Transcriber Bridge] Mic capture failed:', error);
                chrome.runtime.sendMessage({ type: 'MIC_CAPTURE_STATUS', status: 'failed', error });
                break;

            case 'CONTENT_SCRIPT_READY':
                console.log('[Transcriber Bridge] Content script ready in page context');
                chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
                break;
        }
    });

    // Listen for commands from the background and forward to MAIN world
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'START_MIC_CAPTURE' || msg.type === 'STOP_MIC_CAPTURE') {
            window.postMessage({
                source: 'meeting-transcriber-bridge',
                type: msg.type
            }, '*');
            sendResponse({ success: true });
        }
        return false;
    });

    console.log('[Transcriber Bridge] Bridge content script loaded');
})();
