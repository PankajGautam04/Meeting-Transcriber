# 📡 API Documentation — Meeting Transcriber

Base URL: `http://localhost:3001`

---

## Authentication

The API does not require authentication. The Deepgram API key is managed per-session via the Chrome extension's Settings tab and transmitted over the WebSocket connection.

---

## REST Endpoints

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

---

### List All Transcripts

```
GET /api/transcripts
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 50 | Max number of transcripts to return |
| `offset` | number | 0 | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-string",
      "title": "Google Meet Session",
      "meeting_url": "https://meet.google.com/abc-defg-hij",
      "duration": 300,
      "speaker_count": 2,
      "created_at": "2024-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

### Get Transcript by ID

```
GET /api/transcripts/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "title": "Google Meet Session",
    "meeting_url": "https://meet.google.com/abc-defg-hij",
    "duration": 300,
    "speaker_count": 2,
    "created_at": "2024-01-15T12:00:00.000Z",
    "segments": [
      {
        "id": 1,
        "speaker_id": 0,
        "speaker_label": "You",
        "text": "Hello, can everyone hear me?",
        "start_time": 2.5,
        "end_time": 4.8
      },
      {
        "id": 2,
        "speaker_id": 1,
        "speaker_label": "Speaker 1",
        "text": "Yes, loud and clear.",
        "start_time": 5.1,
        "end_time": 6.3
      }
    ]
  }
}
```

---

### Delete Transcript

```
DELETE /api/transcripts/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Transcript deleted"
}
```

---

## WebSocket Protocol

### Connection

```
ws://localhost:3001
```

The extension connects to the WebSocket server when recording starts.

### Message Format

#### Client → Server

**1. START (JSON)**
```json
{
  "type": "START",
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "apiKey": "user's-deepgram-api-key"
}
```

**2. Audio Data (Binary)**

Binary messages contain audio data with a 1-byte prefix:
- `0x00` + audio bytes = **Tab audio** (remote participants)
- `0x01` + audio bytes = **Mic audio** (local user)

Audio format: `audio/webm;codecs=opus`

**3. STOP (JSON)**
```json
{
  "type": "STOP"
}
```

#### Server → Client

**1. Transcript Update**
```json
{
  "type": "transcript",
  "text": "Hello everyone",
  "speaker": 0,
  "speaker_label": "You",
  "start": 2.5,
  "end": 4.8,
  "is_final": true
}
```

Speaker values:
- `0` = Local user (mic audio → labeled "You")
- `1+` = Remote participants (tab audio → labeled "Speaker N")

**2. Warning**
```json
{
  "type": "warning",
  "message": "No Deepgram API key configured."
}
```

**3. Error**
```json
{
  "type": "error",
  "message": "Transcription error description"
}
```

---

## Database Schema

### transcripts

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `title` | TEXT | Auto-generated from meeting URL |
| `meeting_url` | TEXT | Original meeting URL |
| `duration` | INTEGER | Session duration in seconds |
| `speaker_count` | INTEGER | Number of unique speakers |
| `created_at` | DATETIME | Timestamp |

### segments

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-increment |
| `transcript_id` | TEXT (FK) | References `transcripts.id` |
| `speaker_id` | INTEGER | 0 = You, 1+ = remote speakers |
| `speaker_label` | TEXT | "You", "Speaker 1", etc. |
| `text` | TEXT | Transcribed text |
| `start_time` | REAL | Start timestamp (seconds) |
| `end_time` | REAL | End timestamp (seconds) |

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Error description"
}
```

| Status Code | Description |
|---|---|
| 400 | Bad request / missing parameters |
| 404 | Transcript not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
