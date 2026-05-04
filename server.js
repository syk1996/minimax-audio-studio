import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 5173);
const API_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com';
const API_KEY = process.env.MINIMAX_API_KEY || '';
const PUBLIC_DIR = new URL('./public/', import.meta.url);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const DB_PATH = new URL('./minimax-studio.sqlite', import.meta.url).pathname;

const db = new DatabaseSync(DB_PATH);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    content BLOB,
    metadata TEXT NOT NULL DEFAULT '{}',
    batch_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendBuffer(res, statusCode, buffer, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(buffer);
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

function getApiKey(req) {
  const headerApiKey = req.headers['x-minimax-api-key'];
  return String(headerApiKey || getSetting('minimax_api_key') || API_KEY).trim();
}

function requireApiKey(req, res) {
  if (getApiKey(req)) return true;
  sendJson(res, 500, {
    error: '缺少 MiniMax API Key。请到设置页保存 API Key 后重试。',
  });
  return false;
}

function getMimeType(format) {
  const normalized = String(format || 'mp3').toLowerCase();
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'flac') return 'audio/flac';
  if (normalized === 'pcm') return 'audio/pcm';
  return 'audio/mpeg';
}

function getImageExtFromMime(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  return 'jpg';
}

function parseDataUrl(value) {
  const match = String(value || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function extractFirstLine(lyrics) {
  if (!lyrics) return '';
  const lines = lyrics.split('\n').filter(line => line.trim());
  if (lines.length === 0) return '';
  const firstLine = lines[0].trim();
  // 跳过可能的前缀标记如 [Verse], [Chorus] 等
  if (firstLine.startsWith('[') && firstLine.includes(']')) {
    return lines.length > 1 ? lines[1].trim().slice(0, 80) : '';
  }
  return firstLine.slice(0, 80);
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 120);
}

function hexToBuffer(hex) {
  return Buffer.from(hex, 'hex');
}

function insertRecord({ type, title, filename, mimeType, content, metadata, batchId }) {
  const buffer = content ? Buffer.from(content) : null;
  const result = db.prepare(`
    INSERT INTO records (type, title, filename, mime_type, size_bytes, content, metadata, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    title,
    filename,
    mimeType || null,
    buffer?.length || 0,
    buffer,
    JSON.stringify(metadata || {}),
    batchId || null,
  );

  return getRecordSummary(result.lastInsertRowid);
}

function getRecordSummary(id) {
  return db.prepare(`
    SELECT id, type, title, filename, mime_type AS mimeType, size_bytes AS sizeBytes, metadata, batch_id AS batchId, created_at AS createdAt
    FROM records
    WHERE id = ?
  `).get(id);
}

function getRecords(typeFilter = null) {
  const whereClause = typeFilter ? `WHERE type = ?` : '';
  const params = typeFilter ? [typeFilter] : [];
  
  const records = db.prepare(`
    SELECT id, type, title, filename, mime_type AS mimeType, size_bytes AS sizeBytes, metadata, batch_id AS batchId, created_at AS createdAt
    FROM records
    ${whereClause}
    ORDER BY created_at DESC, id DESC
  `).all(...params);
  
  const stats = db.prepare(`
    SELECT type, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS sizeBytes
    FROM records
    GROUP BY type
  `).all();
  
  return { records, stats };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function readLimitedBinary(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      const error = new Error('上传文件不能超过 20MB。');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function minimaxFetch(req, path, init) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${getApiKey(req)}`,
      ...(init.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof body === 'string' ? body : body?.base_resp?.status_msg;
    const error = new Error(message || `MiniMax 请求失败：${response.status}`);
    error.statusCode = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

function assertMinimaxSuccess(result) {
  if (result?.base_resp && result.base_resp.status_code !== 0) {
    const error = new Error(result.base_resp.status_msg || `MiniMax 错误码：${result.base_resp.status_code}`);
    error.statusCode = 400;
    error.details = result;
    throw error;
  }
}

async function handleMusic(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);
  const format = payload.format || 'mp3';
  const result = await minimaxFetch(req, '/v1/music_generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
      model: payload.model || 'music-2.6-free',
      prompt: payload.prompt,
      lyrics: payload.lyrics,
      output_format: 'hex',
      stream: false,
      is_instrumental: Boolean(payload.is_instrumental),
      aigc_watermark: Boolean(payload.aigc_watermark),
      audio_setting: {
        sample_rate: Number(payload.sample_rate || 44100),
        bitrate: Number(payload.bitrate || 256000),
        format,
      },
    }),
  });
  assertMinimaxSuccess(result);

  if (result.data?.audio) {
    // 直接使用用户填写的歌名，如果没有填写则使用 API 返回的歌名或默认值
    const musicTitle = payload.lyrics_title?.trim() 
      || result.extra_info?.song_title 
      || result.data?.song_title
      || '音乐生成';
    const safeTitle = sanitizeFilename(musicTitle) || '音乐生成';
    
    result.record = insertRecord({
      type: 'music',
      title: musicTitle,
      filename: `${safeTitle}.${format}`,
      mimeType: getMimeType(format),
      content: hexToBuffer(result.data.audio),
      metadata: { prompt: payload.prompt, lyrics: payload.lyrics, model: payload.model, extraInfo: result.extra_info },
    });
  }

  sendJson(res, 200, result);
}

async function handleLyrics(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);
  const result = await minimaxFetch(req, '/v1/lyrics_generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: payload.mode || 'write_full_song',
      prompt: payload.prompt || '',
      lyrics: payload.lyrics || '',
      title: payload.title || '',
    }),
  });
  assertMinimaxSuccess(result);
  sendJson(res, 200, result);
}

async function handleSpeech(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);
  const format = payload.format || 'mp3';
  const result = await minimaxFetch(req, '/v1/t2a_v2', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: payload.model || 'speech-2.8-hd',
      text: payload.text,
      stream: false,
      output_format: 'hex',
      subtitle_enable: Boolean(payload.subtitle_enable),
      aigc_watermark: Boolean(payload.aigc_watermark),
      language_boost: payload.language_boost || undefined,
      voice_setting: {
        voice_id: payload.voice_id || 'Chinese (Mandarin)_Lyrical_Voice',
        speed: Number(payload.speed || 1),
        vol: Number(payload.vol || 1),
        pitch: Number(payload.pitch || 0),
        emotion: payload.emotion || undefined,
      },
      audio_setting: {
        sample_rate: Number(payload.sample_rate || 32000),
        bitrate: Number(payload.bitrate || 128000),
        format,
        channel: Number(payload.channel || 1),
      },
    }),
  });
  assertMinimaxSuccess(result);

  if (result.data?.audio) {
    result.record = insertRecord({
      type: 'speech',
      title: payload.text?.slice(0, 80) || '语音合成',
      filename: `speech-${Date.now()}.${format}`,
      mimeType: getMimeType(format),
      content: hexToBuffer(result.data.audio),
      metadata: { text: payload.text, model: payload.model, voiceId: payload.voice_id, extraInfo: result.extra_info },
    });
  }

  sendJson(res, 200, result);
}

async function handleImage(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);

  const requestBody = {
    model: payload.model || 'image-01',
    prompt: payload.prompt,
    aspect_ratio: payload.aspect_ratio || '1:1',
    n: Math.max(1, Math.min(9, Number(payload.n || 1))),
    aigc_watermark: Boolean(payload.aigc_watermark),
    response_format: 'url',
  };

  if (payload.style?.style_type) {
    requestBody.style = {
      style_type: payload.style.style_type,
      style_weight: Math.max(0.01, Math.min(1, Number(payload.style.style_weight || 0.8))),
    };
  }

  if (payload.mode === 'i2i') {
    if (!payload.reference_image_data_url) {
      sendJson(res, 400, { error: '图生图模式必须提供参考图片。' });
      return;
    }
    requestBody.subject_reference = [{
      type: 'character',
      image_file: payload.reference_image_data_url,
    }];
  }

  const result = await minimaxFetch(req, '/v1/image_generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  assertMinimaxSuccess(result);

  const imageUrls = result.data?.image_urls || [];
  const imageBase64s = result.data?.image_base64 || [];

  if (imageUrls.length > 0 || imageBase64s.length > 0) {
    const title = (payload.prompt || '图片生成').slice(0, 80);
    const safeTitle = sanitizeFilename(title) || '图片生成';
    const records = [];
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    for (let i = 0; i < Math.max(imageUrls.length, imageBase64s.length); i++) {
      let buffer;
      let mimeType = 'image/jpeg';

      if (imageUrls[i]) {
        const response = await fetch(imageUrls[i]);
        if (!response.ok) continue;
        buffer = Buffer.from(await response.arrayBuffer());
        mimeType = response.headers.get('content-type') || mimeType;
      } else if (imageBase64s[i]) {
        const parsed = parseDataUrl(imageBase64s[i]);
        if (parsed) {
          buffer = Buffer.from(parsed.base64, 'base64');
          mimeType = parsed.mimeType || mimeType;
        } else {
          buffer = Buffer.from(imageBase64s[i], 'base64');
        }
      }

      if (!buffer) continue;

      const ext = getImageExtFromMime(mimeType);
      const filename = imageUrls.length > 1 || imageBase64s.length > 1
        ? `${safeTitle}_${i + 1}.${ext}`
        : `${safeTitle}.${ext}`;

      const record = insertRecord({
        type: 'image',
        title,
        filename,
        mimeType,
        content: buffer,
        batchId,
        metadata: {
          model: requestBody.model,
          prompt: payload.prompt,
          mode: payload.mode || 't2i',
          aspectRatio: requestBody.aspect_ratio,
          count: requestBody.n,
          imageUrls: result.data?.image_urls || [],
          index: i + 1,
        },
      });
      records.push(record);
    }

    result.records = records;
  }

  sendJson(res, 200, result);
}

async function handleVoiceUpload(req, res) {
  if (!requireApiKey(req, res)) return;
  const fileName = decodeURIComponent(req.headers['x-file-name'] || 'voice-sample.wav');
  const fileType = req.headers['x-file-type'] || 'application/octet-stream';
  const body = await readLimitedBinary(req, MAX_UPLOAD_BYTES);
  const formData = new FormData();
  formData.append('purpose', 'voice_clone');
  formData.append('file', new Blob([body], { type: fileType }), String(fileName));

  const result = await minimaxFetch(req, '/v1/files/upload', {
    method: 'POST',
    body: formData,
  });
  assertMinimaxSuccess(result);
  sendJson(res, 200, result);
}

async function handleVoiceClone(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);
  const requestBody = {
    file_id: Number(payload.file_id),
    voice_id: payload.voice_id,
    need_noise_reduction: Boolean(payload.need_noise_reduction),
    need_volume_normalization: Boolean(payload.need_volume_normalization),
    aigc_watermark: Boolean(payload.aigc_watermark),
  };

  if (payload.text?.trim()) {
    requestBody.text = payload.text.trim();
    requestBody.model = payload.model || 'speech-2.8-hd';
  }

  if (payload.language_boost) requestBody.language_boost = payload.language_boost;

  const result = await minimaxFetch(req, '/v1/voice_clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  assertMinimaxSuccess(result);

  let demoBuffer = null;
  if (result.demo_audio) {
    const demoResponse = await fetch(result.demo_audio);
    if (demoResponse.ok) demoBuffer = Buffer.from(await demoResponse.arrayBuffer());
  }

  result.record = insertRecord({
    type: 'voice_clone',
    title: payload.voice_id || '音色克隆',
    filename: demoBuffer ? `voice-clone-${payload.voice_id}-${Date.now()}.mp3` : `voice-clone-${payload.voice_id}.json`,
    mimeType: demoBuffer ? 'audio/mpeg' : 'application/json',
    content: demoBuffer || Buffer.from(JSON.stringify(result, null, 2)),
    metadata: { voiceId: payload.voice_id, fileId: payload.file_id, hasDemoAudio: Boolean(demoBuffer), demoAudio: result.demo_audio },
  });

  sendJson(res, 200, result);
}

async function handleMusicCoverPreprocess(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);
  
  // 构建请求体，支持 audio_url 和 audio_base64 两种方式
  const requestBody = {
    model: 'music-cover',
  };
  
  if (payload.audio_url) {
    requestBody.audio_url = payload.audio_url;
  } else if (payload.audio_base64) {
    requestBody.audio_base64 = payload.audio_base64;
  } else {
    sendJson(res, 400, { error: '必须提供 audio_url 或 audio_base64 参数' });
    return;
  }
  
  const result = await minimaxFetch(req, '/v1/music_cover_preprocess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  assertMinimaxSuccess(result);
  sendJson(res, 200, result);
}

async function handleMusicCoverGenerate(req, res) {
  if (!requireApiKey(req, res)) return;
  const payload = await readJsonBody(req);
  const format = payload.cover_format || 'mp3';
  
  // 构建请求体
  const requestBody = {
    model: 'music-cover',
    prompt: payload.cover_prompt,
    output_format: 'hex',
    stream: false,
    aigc_watermark: Boolean(payload.cover_aigc_watermark),
    audio_setting: {
      sample_rate: Number(payload.cover_sample_rate || 44100),
      bitrate: Number(payload.cover_bitrate || 256000),
      format,
    },
  };
  
  // 根据模式选择不同的参数
  if (payload.is_two_step && payload.cover_feature_id) {
    // 两步模式：使用 cover_feature_id 和编辑后的歌词
    requestBody.cover_feature_id = payload.cover_feature_id;
    requestBody.lyrics = payload.cover_lyrics;
  } else if (payload.audio_base64) {
    // 一步模式（Base64 文件上传）
    requestBody.audio_base64 = payload.audio_base64;
  } else if (payload.audio_url) {
    // 一步模式（URL 方式）
    requestBody.audio_url = payload.audio_url;
  } else {
    sendJson(res, 400, { error: '必须提供 audio_url、audio_base64 或 cover_feature_id 参数' });
    return;
  }
  
  const result = await minimaxFetch(req, '/v1/music_generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  assertMinimaxSuccess(result);
  
  if (result.data?.audio) {
    const musicTitle = payload.cover_prompt?.slice(0, 80) || '翻唱生成';
    const safeTitle = sanitizeFilename(musicTitle) || '翻唱生成';
    
    result.record = insertRecord({
      type: 'music_cover',
      title: musicTitle,
      filename: `${safeTitle}.${format}`,
      mimeType: getMimeType(format),
      content: hexToBuffer(result.data.audio),
      metadata: { 
        prompt: payload.cover_prompt,
        model: 'music-cover',
        coverFeatureId: payload.cover_feature_id,
        audioUrl: payload.audio_url,
        audioBase64: payload.audio_base64 ? '[base64]' : null,
        extraInfo: result.extra_info,
      },
    });
  }
  
  sendJson(res, 200, result);
}

async function handleSettings(req, res) {
  if (req.method === 'GET') {
    const apiKey = getSetting('minimax_api_key');
    sendJson(res, 200, { hasApiKey: Boolean(apiKey), maskedApiKey: apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : '' });
    return;
  }

  const payload = await readJsonBody(req);
  const apiKey = String(payload.apiKey || '').trim();
  if (!apiKey) {
    sendJson(res, 400, { error: 'API Key 不能为空。' });
    return;
  }
  setSetting('minimax_api_key', apiKey);
  sendJson(res, 200, { ok: true, hasApiKey: true, maskedApiKey: `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` });
}

function handleRecords(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const typeFilter = url.searchParams.get('type') || null;
  sendJson(res, 200, getRecords(typeFilter));
}

function handleRecordDownload(req, res, id) {
  const record = db.prepare('SELECT type, title, filename, mime_type, content FROM records WHERE id = ?').get(id);
  if (!record || !record.content) {
    sendJson(res, 404, { error: '记录不存在或没有可下载内容。' });
    return;
  }

  const extension = extname(record.filename || '') || '.bin';
  const downloadName = record.type === 'music' && record.title
    ? `${sanitizeFilename(record.title) || '音乐生成'}${extension}`
    : record.filename;

  sendBuffer(res, 200, record.content, {
    'content-type': record.mime_type || 'application/octet-stream',
    'content-disposition': `attachment; filename="${encodeURIComponent(downloadName)}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
  });
}

function handleRecordDelete(res, id) {
  const result = db.prepare('DELETE FROM records WHERE id = ?').run(id);
  sendJson(res, result.changes ? 200 : 404, result.changes ? { ok: true } : { error: '记录不存在。' });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname === '/' ? '/index.html' : url.pathname;
  const allowedFiles = new Set(['/index.html', '/styles.css', '/app.js']);

  if (!allowedFiles.has(route)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const filePath = join(PUBLIC_DIR.pathname, route.slice(1));
  const content = await readFile(filePath);
  res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
  res.end(content);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const downloadMatch = url.pathname.match(/^\/api\/records\/(\d+)\/download$/);
    const deleteMatch = url.pathname.match(/^\/api\/records\/(\d+)$/);

    if (req.method === 'POST' && url.pathname === '/api/music') return await handleMusic(req, res);
    if (req.method === 'POST' && url.pathname === '/api/image') return await handleImage(req, res);
    if (req.method === 'POST' && url.pathname === '/api/lyrics') return await handleLyrics(req, res);
    if (req.method === 'POST' && url.pathname === '/api/speech') return await handleSpeech(req, res);
    if (req.method === 'POST' && url.pathname === '/api/voice/upload') return await handleVoiceUpload(req, res);
    if (req.method === 'POST' && url.pathname === '/api/voice/clone') return await handleVoiceClone(req, res);
    if (req.method === 'POST' && url.pathname === '/api/music-cover/preprocess') return await handleMusicCoverPreprocess(req, res);
    if (req.method === 'POST' && url.pathname === '/api/music-cover/generate') return await handleMusicCoverGenerate(req, res);
    if (url.pathname === '/api/settings') return await handleSettings(req, res);
    if (req.method === 'GET' && url.pathname === '/api/records') return handleRecords(req, res);
    if (req.method === 'GET' && downloadMatch) return handleRecordDownload(req, res, Number(downloadMatch[1]));
    if (req.method === 'DELETE' && deleteMatch) return handleRecordDelete(res, Number(deleteMatch[1]));
    if (req.method === 'GET') return await serveStatic(req, res);

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || '服务器错误',
      details: error.details,
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MiniMax Audio Studio running on http://localhost:${PORT}`);
});
