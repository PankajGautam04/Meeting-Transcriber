// === Meeting Transcriber - Background Service Worker ===

let BACKEND_WS_URL = 'ws://localhost:3001';
const MEETING_PATTERNS = [
    'meet.google.com',
    'zoom.us/wc/',
    'zoom.us/j/',
    'teams.microsoft.com',
    'webex.com/meet',
    'whereby.com'
];

let state = {
    isRecording: false,
    meetingTabId: null,
    meetingUrl: null,
    ws: null,
    startTime: null,
    offscreenCreated: false,
    contentScriptReady: false
};

// === Message Handler ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case 'CHECK_MEETING':
            checkForMeetingTab().then((result) => {
                sendResponse(result);
            });
            return true;

        case 'GET_STATE':
            sendResponse({
                isRecording: state.isRecording,
                elapsed: state.startTime
                    ? Math.floor((Date.now() - state.startTime) / 1000)
                    : 0
            });
            return false;

        case 'START_RECORDING':
            startRecording().then((result) => {
                sendResponse(result);
            });
            return true;

        case 'STOP_RECORDING':
            stopRecording().then((result) => {
                sendResponse(result);
            });
            return true;

        case 'AUDIO_DATA':
            // Tab audio from offscreen document (base64)
            // Prefix with 0x00 to identify as tab audio
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                try {
                    const binaryStr = atob(msg.data);
                    const bytes = new Uint8Array(binaryStr.length + 1);
                    bytes[0] = 0x00; // tab audio marker
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i + 1] = binaryStr.charCodeAt(i);
                    }
                    state.ws.send(bytes.buffer);
                } catch (e) {
                    console.error('Error decoding tab audio:', e);
                }
            }
            return false;

        case 'MIC_AUDIO_DATA':
            // Microphone audio from content script (base64)
            // Prefix with 0x01 to identify as mic audio
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                try {
                    const binaryStr = atob(msg.data);
                    const bytes = new Uint8Array(binaryStr.length + 1);
                    bytes[0] = 0x01; // mic audio marker
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i + 1] = binaryStr.charCodeAt(i);
                    }
                    state.ws.send(bytes.buffer);
                } catch (e) {
                    console.error('Error decoding mic audio:', e);
                }
            }
            return false;

        case 'CONTENT_SCRIPT_READY':
            state.contentScriptReady = true;
            console.log('Content script ready in meeting page');
            return false;

        case 'MIC_CAPTURE_STATUS':
            console.log('Mic capture status:', msg.status, msg.error || '');
            return false;

        case 'UPDATE_API_KEY':
            console.log('API key updated by user');
            return false;

        case 'UPDATE_BACKEND_URL':
            BACKEND_WS_URL = msg.backendUrl.replace('http', 'ws');
            console.log('Backend URL updated:', BACKEND_WS_URL);
            return false;

        case 'OFFSCREEN_STARTED':
            sendResponse({ success: true });
            return false;

        default:
            return false;
    }
});

// === Check for Meeting Tab ===
async function checkForMeetingTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];

        if (activeTab && activeTab.url) {
            const isMeeting = MEETING_PATTERNS.some((pattern) =>
                activeTab.url.includes(pattern)
            );

            if (isMeeting) {
                state.meetingTabId = activeTab.id;
                state.meetingUrl = activeTab.url;
                return {
                    meetingDetected: true,
                    meetingUrl: truncateUrl(activeTab.url),
                    tabId: activeTab.id
                };
            }
        }

        // Also check all tabs for meetings
        const allTabs = await chrome.tabs.query({});
        for (const tab of allTabs) {
            if (tab.url) {
                const isMeeting = MEETING_PATTERNS.some((p) => tab.url.includes(p));
                if (isMeeting) {
                    state.meetingTabId = tab.id;
                    state.meetingUrl = tab.url;
                    return {
                        meetingDetected: true,
                        meetingUrl: truncateUrl(tab.url),
                        tabId: tab.id
                    };
                }
            }
        }

        return { meetingDetected: false };
    } catch (err) {
        console.error('Error checking meeting tab:', err);
        return { meetingDetected: false };
    }
}

function truncateUrl(url) {
    try {
        const u = new URL(url);
        return u.hostname + u.pathname.slice(0, 30);
    } catch {
        return url.slice(0, 50);
    }
}

// === Start Recording ===
async function startRecording() {
    try {
        if (state.isRecording) {
            return { success: false, error: 'Already recording' };
        }

        // Ensure we have a meeting tab
        if (!state.meetingTabId) {
            const check = await checkForMeetingTab();
            if (!check.meetingDetected) {
                return { success: false, error: 'No meeting tab found' };
            }
        }

        // Get tab capture stream ID
        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: state.meetingTabId
        });

        // Set up WebSocket connection to backend
        await connectWebSocket();

        // Create offscreen document for tab audio processing
        await setupOffscreen();

        // Send stream ID to offscreen doc (for tab audio capture)
        chrome.runtime.sendMessage({
            type: 'START_CAPTURE',
            target: 'offscreen',
            streamId: streamId,
            meetingUrl: state.meetingUrl
        });

        // Programmatically inject content scripts into the meeting tab
        // (Manifest-declared content scripts only work for NEW page loads)
        try {
            // Inject bridge first (ISOLATED world, can use chrome.runtime)
            await chrome.scripting.executeScript({
                target: { tabId: state.meetingTabId },
                files: ['content_bridge.js'],
                world: 'ISOLATED'
            });
            console.log('Injected content_bridge.js into meeting tab');

            // Inject mic capture script (MAIN world, uses page's mic permission)
            await chrome.scripting.executeScript({
                target: { tabId: state.meetingTabId },
                files: ['content_script.js'],
                world: 'MAIN'
            });
            console.log('Injected content_script.js into meeting tab');

            // Give scripts a moment to set up listeners, then trigger mic capture
            await new Promise(r => setTimeout(r, 500));

            await chrome.tabs.sendMessage(state.meetingTabId, {
                type: 'START_MIC_CAPTURE'
            });
            console.log('Sent START_MIC_CAPTURE to meeting tab');
        } catch (err) {
            console.warn('Could not inject/start mic capture:', err.message);
            console.warn('Recording will continue with tab audio only');
        }

        state.isRecording = true;
        state.startTime = Date.now();

        return { success: true };
    } catch (err) {
        console.error('Error starting recording:', err);
        return { success: false, error: err.message };
    }
}

// === Stop Recording ===
async function stopRecording() {
    try {
        // Tell offscreen to stop tab audio capture
        chrome.runtime.sendMessage({
            type: 'STOP_CAPTURE',
            target: 'offscreen'
        });

        // Tell content script to stop mic capture
        if (state.meetingTabId) {
            try {
                await chrome.tabs.sendMessage(state.meetingTabId, {
                    type: 'STOP_MIC_CAPTURE'
                });
            } catch (e) {
                // Tab may be closed
            }
        }

        // Tell backend we're done
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: 'STOP' }));
        }

        // Small delay to let final transcripts come in
        await new Promise((r) => setTimeout(r, 1000));

        // Close WebSocket
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }

        state.isRecording = false;
        state.startTime = null;

        // Notify popup
        chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' });

        // Close offscreen doc
        try {
            await chrome.offscreen.closeDocument();
            state.offscreenCreated = false;
        } catch (e) {
            // May already be closed
        }

        return { success: true };
    } catch (err) {
        console.error('Error stopping recording:', err);
        return { success: false, error: err.message };
    }
}

// === WebSocket Connection ===
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        try {
            // Load user's API key and backend URL from storage
            chrome.storage.sync.get(['deepgramApiKey', 'backendUrl'], (data) => {
                const wsUrl = data.backendUrl
                    ? data.backendUrl.replace('http', 'ws')
                    : BACKEND_WS_URL;

                state.ws = new WebSocket(wsUrl);

                state.ws.onopen = () => {
                    console.log('WebSocket connected to backend');
                    // Send initial metadata with API key
                    state.ws.send(JSON.stringify({
                        type: 'START',
                        meetingUrl: state.meetingUrl,
                        apiKey: data.deepgramApiKey || ''
                    }));
                    resolve();
                };

                state.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.type === 'transcript') {
                            // Forward transcript to popup
                            chrome.runtime.sendMessage({
                                type: 'TRANSCRIPT_UPDATE',
                                data: {
                                    speaker: data.speaker || 0,
                                    text: data.text,
                                    timestamp: data.start,
                                    isFinal: data.is_final
                                }
                            });
                        }
                    } catch (err) {
                        console.error('Error parsing WS message:', err);
                    }
                };

                state.ws.onerror = (err) => {
                    console.error('WebSocket error:', err);
                    reject(new Error('Failed to connect to backend server'));
                };

                state.ws.onclose = () => {
                    console.log('WebSocket closed');
                };

                // Timeout
                setTimeout(() => {
                    if (state.ws && state.ws.readyState !== WebSocket.OPEN) {
                        reject(new Error('WebSocket connection timeout'));
                    }
                }, 5000);
            });
        } catch (err) {
            reject(err);
        }
    });
}

// === Offscreen Document ===
async function setupOffscreen() {
    if (state.offscreenCreated) return;

    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
            justification: 'Capture tab audio for meeting transcription'
        });
        state.offscreenCreated = true;
    } catch (err) {
        if (!err.message.includes('single offscreen')) {
            throw err;
        }
        // Document already exists
        state.offscreenCreated = true;
    }
}
