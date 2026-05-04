const pages = document.querySelectorAll('[data-page-panel]');
const navTabs = document.querySelectorAll('.nav-tab');
const musicForm = document.querySelector('#music-form');
const voiceForm = document.querySelector('#voice-form');
const speechForm = document.querySelector('#speech-form');
const imageForm = document.querySelector('#image-form');
const settingsForm = document.querySelector('#settings-form');
const generateLyricsButton = document.querySelector('#generate-lyrics');
const refreshRecordsButton = document.querySelector('#refresh-records');
const musicResult = document.querySelector('#music-result');
const voiceResult = document.querySelector('#voice-result');
const speechResult = document.querySelector('#speech-result');
const imageResult = document.querySelector('#image-result');
const imagePreviewGrid = document.querySelector('#image-preview-grid');
const lyricsResult = document.querySelector('#lyrics-result');
const settingsResult = document.querySelector('#settings-result');
const settingsStatus = document.querySelector('#settings-status');
const recordsList = document.querySelector('#records-list');
const recordStats = document.querySelector('#record-stats');
const batchCarouselState = new Map();
const speechTokenButtons = document.querySelector('#speech-token-buttons');
const voiceTokenButtons = document.querySelector('#voice-token-buttons');
const voiceDemoContainer = document.querySelector('#voice-demo-container');
const voiceDemoAudio = document.querySelector('#voice-demo-audio');
const voiceDemoPlay = document.querySelector('#voice-demo-play');
const musicCoverForm = document.querySelector('#music-cover-form');
const musicCoverResult = document.querySelector('#music-cover-result');
const extractFeaturesButton = document.querySelector('#extract-features');
const coverLyricsSection = document.querySelector('#cover-lyrics-section');
const coverModeRadios = document.querySelectorAll('input[name="cover_mode"]');
const audioInputModeRadios = document.querySelectorAll('input[name="audio_input_mode"]');
const audioUrlInput = document.querySelector('#audio-url-input');
const audioFileInput = document.querySelector('#audio-file-input');
const imageModeRadios = document.querySelectorAll('input[name="image_mode"]');
const imageReference = document.querySelector('#image-reference');
const imageModelSelect = document.querySelector('#image-form select[name="model"]');
const imageStyleSection = document.querySelector('#image-style-section');

const speechTokens = [
  { label: '笑声', token: '(laughs)' },
  { label: '轻笑', token: '(chuckle)' },
  { label: '咳嗽', token: '(coughs)' },
  { label: '清嗓子', token: '(clear-throat)' },
  { label: '呻吟', token: '(groans)' },
  { label: '正常换气', token: '(breath)' },
  { label: '喘气', token: '(pant)' },
  { label: '吸气', token: '(inhale)' },
  { label: '呼气', token: '(exhale)' },
  { label: '倒吸气', token: '(gasps)' },
  { label: '吸鼻子', token: '(sniffs)' },
  { label: '叹气', token: '(sighs)' },
  { label: '喷鼻息', token: '(snorts)' },
  { label: '打嗝', token: '(burps)' },
  { label: '咂嘴', token: '(lip-smacking)' },
  { label: '哼唱', token: '(humming)' },
  { label: '嘶嘶声', token: '(hissing)' },
  { label: '嗯', token: '(emm)' },
  { label: '口哨', token: '(whistles)' },
  { label: '喷嚏', token: '(sneezes)' },
  { label: '抽泣', token: '(crying)' },
  { label: '鼓掌', token: '(applause)' },
];

function setBusy(form, busy) {
  form.querySelector('button[type="submit"]').disabled = busy;
}

function setButtonBusy(button, busy) {
  button.disabled = busy;
}

function formToObject(form) {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
    data[checkbox.name] = checkbox.checked;
  }
  return data;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.details?.base_resp?.status_msg || '请求失败');
  }
  if (payload.base_resp && payload.base_resp.status_code !== 0) {
    throw new Error(payload.base_resp.status_msg || `MiniMax 错误码：${payload.base_resp.status_code}`);
  }
  return payload;
}

function renderError(target, error) {
  target.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function recordTypeName(type) {
  const names = {
    music: '音乐生成',
    music_cover: '翻唱生成',
    image: '图片生成',
    speech: '语音合成',
    voice_clone: '音色克隆',
  };
  return names[type] || type;
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.setRangeText(text, start, end, 'end');
  textarea.focus();
}

function showPage(pageName) {
  for (const page of pages) page.classList.toggle('active', page.dataset.pagePanel === pageName);
  for (const tab of navTabs) tab.classList.toggle('active', tab.dataset.page === pageName);
  window.location.hash = pageName;
  if (pageName === 'records') loadRecords();
  if (pageName === 'settings') loadSettings();
}

function renderSavedRecord(target, payload, doneText) {
  const records = payload.records || (payload.record ? [payload.record] : []);

  if (records.length === 0) {
    target.innerHTML = `<strong>${doneText}</strong><br />接口未返回可保存文件。`;
    return;
  }

  target.innerHTML = `<strong>${doneText}</strong><br />已自动保存到 SQLite：${records.length} 张图片<br />`;

  const imageGrid = document.createElement('div');
  imageGrid.className = 'image-grid';

  for (const record of records) {
    const url = `/api/records/${record.id}/download`;
    const wrapper = document.createElement('div');
    wrapper.className = 'image-grid-item';

    if (record.mimeType?.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      wrapper.append(audio);
    }

    if (record.mimeType?.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = record.title || '生成图片';
      image.style.maxWidth = '100%';
      image.style.borderRadius = '10px';
      wrapper.append(image);
    }

    const link = document.createElement('a');
    link.href = url;
    link.textContent = '下载';
    link.className = 'secondary-button small-button';
    wrapper.append(link);

    imageGrid.append(wrapper);
  }

  target.append(imageGrid);
}

async function loadSettings() {
  try {
    const settings = await requestJson('/api/settings');
    settingsStatus.textContent = settings.hasApiKey
      ? `已保存 API Key：${settings.maskedApiKey}`
      : '尚未保存 API Key。保存后所有功能都会自动使用该 Key。';
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

let currentFilter = null;

function updateFilterUI() {
  for (const card of recordStats.querySelectorAll('.stat-card[data-filter-type]')) {
    card.classList.toggle('active', card.dataset.filterType === currentFilter);
  }
  
  const typeLabel = currentFilter ? ` [${recordTypeName(currentFilter)}]` : '';
  refreshRecordsButton.textContent = currentFilter ? `清除筛选${typeLabel}` : '刷新记录';
}

async function loadRecords() {
  try {
    recordsList.textContent = '正在读取记录。';
    const url = currentFilter ? `/api/records?type=${encodeURIComponent(currentFilter)}` : '/api/records';
    const payload = await requestJson(url);
    renderStats(payload.stats || []);
    updateFilterUI();
    renderRecords(payload.records || []);
  } catch (error) {
    renderError(recordsList, error);
  }
}

function renderStats(stats) {
  if (!stats.length) {
    recordStats.innerHTML = '<div class="stat-card"><strong>0</strong><span>暂无生成记录</span></div>';
    return;
  }
  recordStats.innerHTML = stats.map((item) => `
    <div class="stat-card" data-filter-type="${item.type}" tabindex="0" role="button" aria-label="筛选 ${recordTypeName(item.type)} 记录">
      <strong>${item.count}</strong>
      <span>${recordTypeName(item.type)} · ${formatBytes(item.sizeBytes)}</span>
    </div>
  `).join('');
  
  for (const card of recordStats.querySelectorAll('.stat-card[data-filter-type]')) {
    card.addEventListener('click', () => {
      const type = card.dataset.filterType;
      if (currentFilter === type) {
        currentFilter = null;
      } else {
        currentFilter = type;
      }
      updateFilterUI();
      loadRecords();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  }
}

function renderRecords(records) {
  if (!records.length) {
    recordsList.innerHTML = '<div class="empty-state">还没有生成文件。完成音乐生成、语音合成或音色克隆后会自动出现在这里。</div>';
    return;
  }

  // 按 batchId 分组
  const batches = [];
  const unbatched = [];

  for (const record of records) {
    if (record.batchId) {
      let batch = batches.find(b => b.batchId === record.batchId);
      if (!batch) {
        batch = { batchId: record.batchId, records: [], type: record.type, title: record.title, createdAt: record.createdAt };
        batches.push(batch);
      }
      batch.records.push(record);
    } else {
      unbatched.push(record);
    }
  }

  let html = '';

  // 渲染批次记录
  for (const batch of batches) {
    const isImage = batch.records[0]?.mimeType?.startsWith('image/');
    const isAudio = batch.records[0]?.mimeType?.startsWith('audio/');

    html += `<article class="record-card batch-card" data-batch-id="${batch.batchId}">
      <div class="batch-header">
        <span class="record-type">${recordTypeName(batch.type)}</span>
        <h3>${escapeHtml(batch.title)}</h3>
        <p>${batch.records.length} 个文件 · ${formatBytes(batch.records.reduce((sum, r) => sum + r.sizeBytes, 0))} · ${new Date(batch.createdAt).toLocaleString()}</p>
      </div>
      <div class="batch-content">`;

    if (isImage && batch.records.length > 1) {
      // 图片批次：左侧轮播，右侧操作按钮
      html += `<div class="batch-carousel-wrapper">
        <div class="batch-carousel">
          <div class="batch-carousel-track" data-batch-track="${batch.batchId}">`;

      for (const record of batch.records) {
        html += `<div class="batch-slide" data-record-id="${record.id}">
          <img src="/api/records/${record.id}/download" alt="${escapeHtml(record.filename)}" />
        </div>`;
      }

      html += `</div>
        </div>
        <button class="batch-preview-btn" data-batch-preview="${batch.batchId}" title="预览大图">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <div class="batch-carousel-nav">
          <button class="batch-carousel-btn" data-batch-prev="${batch.batchId}" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button class="batch-carousel-btn" data-batch-next="${batch.batchId}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
        <span class="batch-carousel-indicator" data-batch-indicator="${batch.batchId}">1 / ${batch.records.length}</span>
      </div>
      <div class="batch-actions" data-batch-actions="${batch.batchId}">
        <button class="secondary-button small-button" type="button" data-batch-download="${batch.batchId}">下载当前</button>
        <button class="danger-button small-button" type="button" data-batch-delete="${batch.batchId}">删除当前</button>
        ${batch.records.length > 1 ? `<button class="secondary-button small-button" type="button" data-batch-download-all="${batch.batchId}">批量下载 (${batch.records.length})</button>` : ''}
      </div>`;
    } else if (isImage) {
      // 单张图片批次
      const record = batch.records[0];
      html += `<div class="batch-carousel-wrapper">
        <div class="batch-preview-single">
          <img src="/api/records/${record.id}/download" alt="${escapeHtml(record.filename)}" />
        </div>
      </div>
      <div class="batch-actions">
        <a class="secondary-button small-button" href="/api/records/${record.id}/download">下载</a>
        <button class="danger-button small-button" type="button" data-delete-record="${record.id}">删除</button>
      </div>`;
    } else {
      // 音频或非图片批次
      html += `<div class="batch-list" style="width: 100%;">`;
      for (const record of batch.records) {
        html += `<div class="batch-item" data-record-id="${record.id}">
          <div class="batch-item-info">
            <span>${escapeHtml(record.filename)}</span>
            <span class="muted">${formatBytes(record.sizeBytes)}</span>
          </div>
          <div class="batch-item-actions">
            ${isAudio ? `<audio controls src="/api/records/${record.id}/download"></audio>` : ''}
            <a class="secondary-button small-button" href="/api/records/${record.id}/download">下载</a>
            <button class="danger-button small-button" type="button" data-delete-record="${record.id}">删除</button>
          </div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div></article>`;
  }

  // 渲染无批次记录
  for (const record of unbatched) {
    html += `<article class="record-card" data-record-id="${record.id}">
      <div>
        <span class="record-type">${recordTypeName(record.type)}</span>
        <h3>${escapeHtml(record.title)}</h3>
        <p>${escapeHtml(record.filename)} · ${formatBytes(record.sizeBytes)} · ${new Date(record.createdAt).toLocaleString()}</p>
      </div>
      <div class="record-actions">
        ${record.mimeType?.startsWith('audio/') ? `<audio controls src="/api/records/${record.id}/download"></audio>` : ''}
        ${record.mimeType?.startsWith('image/') ? `<img src="/api/records/${record.id}/download" alt="${escapeHtml(record.title || '图片')}" style="max-width:180px;border-radius:10px;" />` : ''}
        <a class="secondary-button small-button" href="/api/records/${record.id}/download">下载</a>
        <button class="danger-button small-button" type="button" data-delete-record="${record.id}">删除</button>
      </div>
    </article>`;
  }

  recordsList.innerHTML = html;

  // 绑定轮播事件
  initBatchCarousels();
  initBatchActions();
}

function initBatchCarousels() {
  batchCarouselState.clear();

  for (const btn of document.querySelectorAll('[data-batch-prev], [data-batch-next]')) {
    btn.addEventListener('click', () => {
      const batchId = btn.dataset.batchPrev || btn.dataset.batchNext;
      if (!batchId) return;

      const track = document.querySelector(`[data-batch-track="${batchId}"]`);
      if (!track) return;

      const slides = track.querySelectorAll('.batch-slide');
      const count = slides.length;
      if (count <= 1) return;

      let current = batchCarouselState.get(batchId) || 0;

      if (btn.dataset.batchPrev) {
        current = Math.max(0, current - 1);
      } else {
        current = Math.min(count - 1, current + 1);
      }

      batchCarouselState.set(batchId, current);
      track.style.transform = `translateX(-${current * 100}%)`;

      const indicator = document.querySelector(`[data-batch-indicator="${batchId}"]`);
      if (indicator) indicator.textContent = `${current + 1} / ${count}`;

      const prevBtn = btn.parentElement.querySelector('[data-batch-prev]');
      const nextBtn = btn.parentElement.querySelector('[data-batch-next]');
      if (prevBtn) prevBtn.disabled = current === 0;
      if (nextBtn) nextBtn.disabled = current === count - 1;
    });
  }
}

function initBatchActions() {
  for (const btn of document.querySelectorAll('[data-batch-download]')) {
    btn.addEventListener('click', () => {
      const batchId = btn.dataset.batchDownload;
      const track = document.querySelector(`[data-batch-track="${batchId}"]`);
      if (!track) return;
      const slides = track.querySelectorAll('.batch-slide');
      const currentIndex = batchCarouselState.get(batchId) || 0;
      const currentSlideAlt = slides[currentIndex];
      const recordId = currentSlideAlt?.dataset.recordId;
      if (recordId) {
        window.location.href = `/api/records/${recordId}/download`;
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-batch-delete]')) {
    btn.addEventListener('click', async () => {
      const batchId = btn.dataset.batchDelete;
      const track = document.querySelector(`[data-batch-track="${batchId}"]`);
      if (!track) return;
      const slides = track.querySelectorAll('.batch-slide');
      const currentIndex = batchCarouselState.get(batchId) || 0;
      const recordId = slides[currentIndex]?.dataset.recordId;
      if (recordId && confirm('确定要删除当前图片吗？')) {
        await deleteRecord(recordId);
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-batch-download-all]')) {
    btn.addEventListener('click', () => {
      const batchId = btn.dataset.batchDownloadAll;
      const track = document.querySelector(`[data-batch-track="${batchId}"]`);
      if (!track) return;
      const slides = track.querySelectorAll('.batch-slide');
      slides.forEach(slide => {
        const recordId = slide.dataset.recordId;
        if (recordId) {
          window.open(`/api/records/${recordId}/download`, '_blank');
        }
      });
    });
  }

  for (const btn of document.querySelectorAll('[data-batch-preview]')) {
    btn.addEventListener('click', () => {
      const batchId = btn.dataset.batchPreview;
      const track = document.querySelector(`[data-batch-track="${batchId}"]`);
      if (!track) return;
      const slides = track.querySelectorAll('.batch-slide');
      const current = batchCarouselState.get(batchId) || 0;

      const imageList = Array.from(slides).map(slide => `/api/records/${slide.dataset.recordId}/download`);
      openImageModal(imageList[current], imageList, current);
    });
  }
}

async function deleteRecord(id) {
  try {
    await requestJson(`/api/records/${id}`, { method: 'DELETE' });
    loadRecords();
  } catch (error) {
    alert('删除失败：' + error.message);
  }
}

for (const tab of navTabs) {
  tab.addEventListener('click', () => showPage(tab.dataset.page));
}

speechTokenButtons.innerHTML = speechTokens.map((item) => `
  <button class="token-button" type="button" data-token="${escapeHtml(item.token)}">${escapeHtml(item.label)}</button>
`).join('');

speechTokenButtons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-token]');
  if (!button) return;
  insertAtCursor(speechForm.elements.text, button.dataset.token);
});

// 音色克隆语气词按钮
if (voiceTokenButtons) {
  voiceTokenButtons.innerHTML = speechTokens.map((item) => `
    <button class="token-button" type="button" data-token="${escapeHtml(item.token)}">${escapeHtml(item.label)}</button>
  `).join('');

  voiceTokenButtons.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token]');
    if (!button) return;
    insertAtCursor(voiceForm.elements.text, button.dataset.token);
  });
}

// 试听播放按钮
if (voiceDemoPlay) {
  voiceDemoPlay.addEventListener('click', () => {
    if (voiceDemoAudio) {
      voiceDemoAudio.play();
    }
  });
}

window.addEventListener('hashchange', () => showPage(window.location.hash.slice(1) || 'music'));
showPage(window.location.hash.slice(1) || 'music');

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(settingsForm, true);
  settingsResult.textContent = '正在保存 API Key。';
  try {
    const data = formToObject(settingsForm);
    const payload = await requestJson('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: data.apiKey }),
    });
    settingsForm.reset();
    settingsStatus.textContent = `已保存 API Key：${payload.maskedApiKey}`;
    settingsResult.innerHTML = '<strong>保存成功。</strong><br />后续请求会自动使用数据库中的 API Key。';
  } catch (error) {
    renderError(settingsResult, error);
  } finally {
    setBusy(settingsForm, false);
  }
});

generateLyricsButton.addEventListener('click', async () => {
  setButtonBusy(generateLyricsButton, true);
  lyricsResult.textContent = '正在生成歌词。';
  try {
    // 验证歌词创作指令是否填写（必填项）
    const lyricsPrompt = musicForm.elements.lyrics_prompt.value.trim();
    if (!lyricsPrompt) {
      throw new Error('请填写歌词创作指令后再点击生成歌词');
    }
    
    const prompt = lyricsPrompt;
    const lyrics = musicForm.elements.lyrics.value.trim();
    const payload = await requestJson('/api/lyrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: musicForm.elements.lyrics_mode.value,
        title: musicForm.elements.lyrics_title.value.trim(),
        prompt,
        lyrics,
      }),
    });
    if (!payload.lyrics) throw new Error('歌词生成成功但未返回歌词内容。');
    
    // 填入生成的歌词
    musicForm.elements.lyrics.value = payload.lyrics;
    
    // 自动填入生成的歌名（如果歌名框为空）
    if (payload.song_title) {
      const currentTitle = musicForm.elements.lyrics_title.value.trim();
      if (!currentTitle) {
        musicForm.elements.lyrics_title.value = payload.song_title;
      }
    }
    
    if (payload.style_tags && !musicForm.elements.prompt.value.trim()) musicForm.elements.prompt.value = payload.style_tags;
    lyricsResult.innerHTML = `<strong>${escapeHtml(payload.song_title || '歌词已生成')}</strong><br />风格：${escapeHtml(payload.style_tags || '未返回')}<br />已填入下方歌词框。`;
  } catch (error) {
    renderError(lyricsResult, error);
  } finally {
    setButtonBusy(generateLyricsButton, false);
  }
});

musicForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(musicForm, true);
  musicResult.textContent = '正在生成音乐并保存到 SQLite。';
  try {
    // 如果不是纯音乐，验证歌词创作指令是否填写
    const isInstrumental = musicForm.elements.is_instrumental.checked;
    const lyricsPrompt = musicForm.elements.lyrics_prompt.value.trim();
    const lyrics = musicForm.elements.lyrics.value.trim();
    
    if (!isInstrumental && !lyrics && !lyricsPrompt) {
      throw new Error('请填写歌词创作指令或直接填写歌词（纯音乐模式可不填）');
    }
    
    // 如果没有歌词但有歌词创作指令，提示用户先点击生成歌词
    if (!isInstrumental && !lyrics && lyricsPrompt) {
      throw new Error('请先点击"生成歌词"按钮生成歌词，或者直接将歌词填入下方歌词框');
    }
    
    const data = formToObject(musicForm);
    const payload = await requestJson('/api/music', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    renderSavedRecord(musicResult, payload, '音乐生成完成');
  } catch (error) {
    renderError(musicResult, error);
  } finally {
    setBusy(musicForm, false);
  }
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

if (imageModeRadios.length) {
  for (const radio of imageModeRadios) {
    radio.addEventListener('change', () => {
      const isI2I = imageForm.elements.image_mode.value === 'i2i';
      imageReference.style.display = isI2I ? 'block' : 'none';
      imageForm.elements.reference_file.required = isI2I;
    });
  }
}

if (imageModelSelect) {
  imageModelSelect.addEventListener('change', () => {
    const isLive = imageModelSelect.value === 'image-01-live';
    imageStyleSection.style.display = isLive ? 'block' : 'none';
  });
}

if (imageForm) {
  imageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(imageForm, true);
    imageResult.textContent = '正在生成图片并保存到 SQLite。';
    const count = Number(formToObject(imageForm).n || 1);
    showImagePreviewLoading(count);
    try {
      const data = formToObject(imageForm);
      const requestBody = {
        mode: data.image_mode,
        prompt: data.prompt,
        model: data.model,
        aspect_ratio: data.aspect_ratio,
        n: Number(data.n || 1),
        aigc_watermark: Boolean(data.aigc_watermark),
      };

      if (data.model === 'image-01-live' && data.style_type) {
        requestBody.style = {
          style_type: data.style_type,
          style_weight: parseFloat(data.style_weight || '0.8'),
        };
      }

      if (data.image_mode === 'i2i') {
        const file = imageForm.elements.reference_file.files[0];
        if (!file) throw new Error('图生图模式请先上传参考图片');
        if (file.size > 10 * 1024 * 1024) throw new Error('参考图片不能超过 10MB');
        requestBody.reference_image_data_url = await fileToDataUrl(file);
      }

      const payload = await requestJson('/api/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const recordCount = payload.records?.length || (payload.record ? 1 : 0);
      imageResult.innerHTML = `<strong>图片生成完成</strong><br />已自动保存到 SQLite：${recordCount} 张图片<br />图片已显示在右侧预览面板。`;
      renderImagePreview(payload);
    } catch (error) {
      renderError(imageResult, error);
    } finally {
      setBusy(imageForm, false);
    }
  });
}

// 音色克隆 Voice ID 实时验证
const voiceIdInput = voiceForm.querySelector('[name="voice_id"]');
if (voiceIdInput) {
  const validateVoiceId = (value) => {
    if (!value) return null;
    if (value.length < 8 || value.length > 256) {
      return `Voice ID 长度必须在 8-256 之间，当前长度：${value.length}`;
    }
    if (!/^[A-Za-z]/.test(value)) {
      return 'Voice ID 首字符必须是英文字母';
    }
    if (!/[A-Za-z0-9]$/.test(value)) {
      return 'Voice ID 末位字符不能是 - 或 _';
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*[A-Za-z0-9]$/.test(value)) {
      return 'Voice ID 只能包含字母、数字、- 和 _';
    }
    return null;
  };

  voiceIdInput.addEventListener('change', () => {
    const error = validateVoiceId(voiceIdInput.value);
    if (error) {
      showFieldError(voiceIdInput, error);
    } else {
      clearFieldError(voiceIdInput);
    }
  });

  voiceIdInput.addEventListener('blur', () => {
    const error = validateVoiceId(voiceIdInput.value);
    if (error) {
      showFieldError(voiceIdInput, error);
    } else {
      clearFieldError(voiceIdInput);
    }
  });

  voiceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    // 提交前验证 Voice ID
    const voiceIdError = validateVoiceId(voiceIdInput.value);
    if (voiceIdError) {
      showFieldError(voiceIdInput, voiceIdError);
      voiceResult.innerHTML = `<div class="error-card"><strong>⚠️ 参数错误</strong><br/>请修正 Voice ID 错误后再提交</div>`;
      return;
    }
    
    setBusy(voiceForm, true);
    voiceResult.textContent = '正在上传音频并创建克隆音色。';
    try {
      const data = formToObject(voiceForm);
      const file = voiceForm.elements.file.files[0];
      if (!file) throw new Error('请选择用于复刻的音频文件。');
      if (file.size > 20 * 1024 * 1024) throw new Error('复刻音频不能超过 20MB。');

      // 1. 上传复刻音频
      const upload = await requestJson('/api/voice/upload', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'x-file-type': file.type || 'application/octet-stream',
        },
        body: await file.arrayBuffer(),
      });
      const fileId = upload.file?.file_id;
      if (!fileId) throw new Error('上传成功但未返回 file_id。');

      // 2. 调用音色克隆接口
      const clone = await requestJson('/api/voice/clone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, file_id: fileId }),
      });
      
      console.log('克隆返回结果:', clone);
      console.log('demo_audio:', clone.demo_audio);
      
      // 隐藏试听区域
      voiceDemoContainer.style.display = 'none';
      voiceDemoAudio.style.display = 'none';
      voiceDemoPlay.style.display = 'none';
      
      // 如果有试听音频（输入了试听文本）
      if (clone.demo_audio) {
        voiceDemoContainer.style.display = 'block';
        voiceDemoAudio.style.display = 'block';
        voiceDemoAudio.src = clone.demo_audio;
        voiceDemoPlay.style.display = 'inline-flex';
        renderSavedRecord(voiceResult, clone, `音色克隆完成，Voice ID：${data.voice_id}`);
      } else {
        renderSavedRecord(voiceResult, clone, `音色克隆完成，Voice ID：${data.voice_id}（未输入试听文本）`);
      }
    } catch (error) {
      renderError(voiceResult, error);
    } finally {
      setBusy(voiceForm, false);
    }
  });
}

// 语音合成表单实时验证函数
function validateSpeechField(name, value) {
  let num;
  if (name === 'speed') {
    num = parseFloat(value || '1');
    if (isNaN(num)) return '语速必须是有效数字';
    if (num < 0.5 || num > 2) return `语速必须在 0.5-2 之间，当前值：${num}`;
  } else if (name === 'vol') {
    num = parseFloat(value || '1');
    if (isNaN(num)) return '音量必须是有效数字';
    if (num <= 0 || num > 10) return `音量必须在 0.1-10 之间，当前值：${num}`;
  } else if (name === 'pitch') {
    num = parseInt(value || '0');
    if (isNaN(num)) return '语调必须是有效数字';
    if (num < -12 || num > 12) return `语调必须在 -12 到 12 之间，当前值：${num}`;
  }
  return null;
}

function showFieldError(input, message) {
  const label = input.closest('label');
  let errorEl = label.querySelector('.field-error');
  if (!errorEl) {
    errorEl = document.createElement('span');
    errorEl.className = 'field-error';
    label.appendChild(errorEl);
  }
  errorEl.textContent = message;
  input.style.borderColor = 'var(--danger)';
}

function clearFieldError(input) {
  const label = input.closest('label');
  const errorEl = label.querySelector('.field-error');
  if (errorEl) errorEl.remove();
  input.style.borderColor = '';
}

// 为语音合成表单添加实时验证
['speed', 'vol', 'pitch'].forEach(fieldName => {
  const input = speechForm.querySelector(`[name="${fieldName}"]`);
  if (!input) return;
  
  input.addEventListener('change', () => {
    const error = validateSpeechField(fieldName, input.value);
    if (error) {
      showFieldError(input, error);
    } else {
      clearFieldError(input);
    }
  });
  
  input.addEventListener('blur', () => {
    const error = validateSpeechField(fieldName, input.value);
    if (error) {
      showFieldError(input, error);
    } else {
      clearFieldError(input);
    }
  });
});

speechForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  
  // 提交前验证所有字段
  let hasError = false;
  const formData = new FormData(speechForm);
  
  ['speed', 'vol', 'pitch'].forEach(fieldName => {
    const input = speechForm.querySelector(`[name="${fieldName}"]`);
    const error = validateSpeechField(fieldName, input.value);
    if (error) {
      showFieldError(input, error);
      hasError = true;
    }
  });
  
  if (hasError) {
    speechResult.innerHTML = `<div class="error-card"><strong>⚠️ 参数错误</strong><br/>请修正上方标注的错误后再提交</div>`;
    return;
  }
  
  setBusy(speechForm, true);
  speechResult.textContent = '正在合成语音并保存到 SQLite。';
  try {
    const data = formToObject(speechForm);
    const payload = await requestJson('/api/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    renderSavedRecord(speechResult, payload, '语音合成完成');
  } catch (error) {
    renderError(speechResult, error);
  } finally {
    setBusy(speechForm, false);
  }
});

refreshRecordsButton.addEventListener('click', () => {
  if (currentFilter) {
    currentFilter = null;
  }
  loadRecords();
});

recordsList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-record]');
  if (!button) return;
  const id = button.dataset.deleteRecord;
  button.disabled = true;
  try {
    await requestJson(`/api/records/${id}`, { method: 'DELETE' });
    await loadRecords();
  } catch (error) {
    renderError(recordsList, error);
  } finally {
    button.disabled = false;
  }
});

// ============ 翻唱生成功能 ============

// 监听音频输入模式切换
audioInputModeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const isFileMode = radio.value === 'file';
    audioUrlInput.style.display = isFileMode ? 'none' : 'block';
    audioFileInput.style.display = isFileMode ? 'block' : 'none';
    
    const urlInput = musicCoverForm.querySelector('input[name="audio_url"]');
    const fileInput = musicCoverForm.querySelector('input[name="audio_file"]');
    
    if (isFileMode) {
      urlInput.required = false;
      fileInput.required = true;
    } else {
      urlInput.required = true;
      fileInput.required = false;
    }
  });
});

// 监听翻唱模式切换
coverModeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const isTwoStep = radio.value === 'two-step';
    coverLyricsSection.style.display = isTwoStep ? 'block' : 'none';
    if (isTwoStep) {
      document.querySelector('input[name="cover_lyrics"]').required = true;
    } else {
      document.querySelector('input[name="cover_lyrics"]').required = false;
    }
  });
});

// 将文件转换为 Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // 移除 data:image/jpeg;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 提取音频特征（两步翻唱模式）
extractFeaturesButton.addEventListener('click', async () => {
  const resultDiv = document.querySelector('#extract-result');
  const isFileMode = document.querySelector('input[name="audio_input_mode"]:checked').value === 'file';
  
  let audioData;
  
  if (isFileMode) {
    const fileInput = musicCoverForm.querySelector('input[name="audio_file"]');
    const file = fileInput.files[0];
    
    if (!file) {
      resultDiv.innerHTML = '<span class="error">请先选择音频文件</span>';
      return;
    }
    
    // 验证文件大小（50MB）
    if (file.size > 50 * 1024 * 1024) {
      resultDiv.innerHTML = '<span class="error">文件大小不能超过 50MB</span>';
      return;
    }
    
    try {
      resultDiv.textContent = '正在读取文件...';
      const base64 = await fileToBase64(file);
      audioData = { audio_base64: base64 };
    } catch (error) {
      resultDiv.innerHTML = `<span class="error">文件读取失败：${escapeHtml(error.message)}</span>`;
      return;
    }
  } else {
    const audioUrl = musicCoverForm.querySelector('input[name="audio_url"]').value;
    
    if (!audioUrl) {
      resultDiv.innerHTML = '<span class="error">请先填写音频 URL</span>';
      return;
    }
    
    audioData = { audio_url: audioUrl };
  }
  
  setButtonBusy(extractFeaturesButton, true);
  resultDiv.textContent = '正在提取音频特征和歌词...';
  
  try {
    const response = await fetch('/api/music-cover/preprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(audioData),
    });
    
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '提取失败');
    }
    
    // 保存 cover_feature_id
    musicCoverForm.querySelector('input[name="cover_feature_id"]').value = payload.cover_feature_id;
    
    // 填充歌词到文本框
    const lyricsTextarea = musicCoverForm.querySelector('textarea[name="cover_lyrics"]');
    lyricsTextarea.value = payload.formatted_lyrics;
    
    // 显示提取结果
    resultDiv.innerHTML = `
      <strong>提取成功！</strong><br/>
      特征 ID: <code>${escapeHtml(payload.cover_feature_id.substring(0, 20))}...</code><br/>
      音频时长：${payload.audio_duration?.toFixed(2) || 'N/A'} 秒<br/>
      <details>
        <summary>查看提取的歌词</summary>
        <pre style="white-space: pre-wrap; margin-top: 8px;">${escapeHtml(payload.formatted_lyrics)}</pre>
      </details>
    `;
  } catch (error) {
    resultDiv.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    setButtonBusy(extractFeaturesButton, false);
  }
});

// 翻唱表单提交
musicCoverForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  
  setBusy(musicCoverForm, true);
  musicCoverResult.textContent = '正在生成翻唱...';
  
  try {
    const data = formToObject(musicCoverForm);
    const isTwoStep = data.cover_mode === 'two-step';
    const isFileMode = data.audio_input_mode === 'file';
    
    const payload = {
      ...data,
      is_two_step: isTwoStep,
    };
    
    // 处理文件上传模式
    if (isFileMode) {
      const fileInput = musicCoverForm.querySelector('input[name="audio_file"]');
      const file = fileInput.files[0];
      
      if (!file) {
        throw new Error('请选择音频文件');
      }
      
      const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/flac'];
      const allowedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      
      if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(ext)) {
        throw new Error('不支持的音频格式，请使用 MP3、WAV、OGG、M4A、AAC 或 FLAC 格式');
      }
      
      if (file.size > 50 * 1024 * 1024) {
        throw new Error('文件大小不能超过 50MB');
      }
      
      const base64 = await fileToBase64(file);
      payload.audio_base64 = base64;
      delete payload.audio_url;
    }
    
    const result = await requestJson('/api/music-cover/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const record = result.record;
    if (!record) {
      musicCoverResult.innerHTML = '<span class="error">生成完成但未返回可保存文件</span>';
      return;
    }
    
    const url = `/api/records/${record.id}/download`;
    musicCoverResult.innerHTML = `
      <strong>翻唱生成完成！</strong><br/>
      已自动保存到 SQLite：${escapeHtml(record.filename)}<br/>
      文件大小：${formatBytes(record.sizeBytes)}<br/>
      <audio controls src="${url}"></audio><br/>
      <a class="secondary-button" href="${url}">下载文件到本地</a>
    `;
  } catch (error) {
    renderError(musicCoverResult, error);
  } finally {
    setBusy(musicCoverForm, false);
  }
});

function clearImagePreview() {
  if (!imagePreviewGrid) return;
  imagePreviewGrid.innerHTML = '';
}

function renderImagePreview(payload) {
  if (!imagePreviewGrid) return;
  
  const records = (payload.records || (payload.record ? [payload.record] : []))
    .filter(r => r.mimeType?.startsWith('image/'));
  
  if (records.length === 0) {
    imagePreviewGrid.innerHTML = `
      <div class="preview-placeholder">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        <span>生成失败，请重试</span>
      </div>
    `;
    return;
  }
  
  clearImagePreview();
  
  const carousel = document.createElement('div');
  carousel.className = 'preview-carousel';
  
  const container = document.createElement('div');
  container.className = 'carousel-container';
  
  const track = document.createElement('div');
  track.className = 'carousel-track';
  
  for (const record of records) {
    const url = `/api/records/${record.id}/download`;
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    
    const img = document.createElement('img');
    img.src = url;
    img.alt = record.title || '生成图片';
    img.loading = 'lazy';
    
    slide.append(img);
    track.append(slide);
  }
  
  container.append(track);
  
  const nav = document.createElement('div');
  nav.className = 'carousel-nav';
  
  const prevBtn = document.createElement('button');
  prevBtn.className = 'carousel-btn';
  prevBtn.disabled = true;
  prevBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  
  const indicators = document.createElement('div');
  indicators.className = 'carousel-indicators';
  
  for (let i = 0; i < records.length; i++) {
    const dot = document.createElement('button');
    dot.className = `carousel-dot${i === 0 ? ' active' : ''}`;
    dot.addEventListener('click', () => goToSlide(i));
    indicators.append(dot);
  }
  
  const nextBtn = document.createElement('button');
  nextBtn.className = 'carousel-btn';
  nextBtn.disabled = records.length <= 1;
  nextBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  
  nav.append(prevBtn, indicators, nextBtn);
  
  const actions = document.createElement('div');
  actions.className = 'carousel-actions';
  
  if (records.length > 0) {
    const downloadLink = document.createElement('a');
    downloadLink.href = `/api/records/${records[0].id}/download`;
    downloadLink.textContent = '下载当前图片';
    downloadLink.className = 'secondary-button small-button';
    actions.append(downloadLink);
  }
  
  let currentIndex = 0;
  
  function goToSlide(index) {
    if (index < 0 || index >= records.length) return;
    currentIndex = index;
    track.style.transform = `translateX(-${index * 100}%)`;
    
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === records.length - 1;
    
    indicators.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
    
    if (actions.querySelector('a')) {
      actions.querySelector('a').href = `/api/records/${records[index].id}/download`;
    }
  }
  
  prevBtn.addEventListener('click', () => goToSlide(currentIndex - 1));
  nextBtn.addEventListener('click', () => goToSlide(currentIndex + 1));
  
  carousel.append(container, nav, actions);
  imagePreviewGrid.append(carousel);
}

function showImagePreviewLoading(count = 1) {
  if (!imagePreviewGrid) return;
  clearImagePreview();
  
  const container = document.createElement('div');
  container.className = 'preview-placeholder';
  container.innerHTML = `
    <div class="spinner"></div>
    <span>正在生成 ${count} 张图片，请稍候...</span>
  `;
  imagePreviewGrid.append(container);
}

// 图片预览加载状态
const style = document.createElement('style');
style.textContent = `
  .preview-item img {
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .preview-item img.loaded {
    opacity: 1;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.append(style);

// 图片加载完成后显示
if (imagePreviewGrid) {
  const observer = new MutationObserver(() => {
    const images = imagePreviewGrid.querySelectorAll('img:not(.loaded)');
    images.forEach(img => {
      if (img.complete) {
        img.classList.add('loaded');
      } else {
        img.addEventListener('load', () => img.classList.add('loaded'));
      }
    });
  });
  observer.observe(imagePreviewGrid, { childList: true, subtree: true });
}

// 全屏图片预览模态框
const imageModal = document.createElement('div');
imageModal.id = 'image-preview-modal';
imageModal.className = 'image-modal';
imageModal.innerHTML = `
  <div class="image-modal-content">
    <button class="image-modal-close" title="关闭">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
    <button class="image-modal-nav image-modal-prev" title="上一张">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <img class="image-modal-img" src="" alt="预览" />
    <div class="image-modal-counter"></div>
    <button class="image-modal-nav image-modal-next" title="下一张">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  </div>
`;
document.body.appendChild(imageModal);

let modalImageList = [];
let modalCurrentIndex = 0;

const modalClose = imageModal.querySelector('.image-modal-close');
const modalPrev = imageModal.querySelector('.image-modal-prev');
const modalNext = imageModal.querySelector('.image-modal-next');

modalClose.addEventListener('click', closeImageModal);
modalPrev.addEventListener('click', () => navigateModal(-1));
modalNext.addEventListener('click', () => navigateModal(1));
imageModal.addEventListener('click', (e) => {
  if (e.target === imageModal) closeImageModal();
});
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('image-preview-modal');
  if (!modal?.classList.contains('active')) return;
  if (e.key === 'Escape') {
    closeImageModal();
  } else if (e.key === 'ArrowLeft') {
    navigateModal(-1);
  } else if (e.key === 'ArrowRight') {
    navigateModal(1);
  }
});

function closeImageModal() {
  const modal = document.getElementById('image-preview-modal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
  modalImageList = [];
  modalCurrentIndex = 0;
}

function openImageModal(src, imageList = [], currentIndex = 0) {
  const modal = document.getElementById('image-preview-modal');
  const modalImg = modal?.querySelector('.image-modal-img');
  const modalCounter = modal?.querySelector('.image-modal-counter');
  const modalPrev = modal?.querySelector('.image-modal-prev');
  const modalNext = modal?.querySelector('.image-modal-next');

  modalImageList = imageList.length > 0 ? imageList : [src];
  modalCurrentIndex = imageList.length > 0 ? currentIndex : 0;

  if (modalImg) modalImg.src = src;

  if (modalCounter) {
    modalCounter.textContent = imageList.length > 1 ? `${modalCurrentIndex + 1} / ${modalImageList.length}` : '';
  }

  if (modalPrev) modalPrev.style.display = imageList.length > 1 ? 'flex' : 'none';
  if (modalNext) modalNext.style.display = imageList.length > 1 ? 'flex' : 'none';

  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function navigateModal(direction) {
  if (modalImageList.length <= 1) return;

  modalCurrentIndex = (modalCurrentIndex + direction + modalImageList.length) % modalImageList.length;
  const modal = document.getElementById('image-preview-modal');
  const modalImg = modal?.querySelector('.image-modal-img');
  const modalCounter = modal?.querySelector('.image-modal-counter');

  if (modalImg) modalImg.src = modalImageList[modalCurrentIndex];
  if (modalCounter) modalCounter.textContent = `${modalCurrentIndex + 1} / ${modalImageList.length}`;
}
