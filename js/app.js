/* ============================================================
   app.js — メインアプリケーションロジック
   NeV 配線ルート図 要件判定チェックツール
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ─── 状態管理 ─────────────────────────────────
  const state = {
    apiKey: '',
    apiKeyVerified: false,
    selectedModel: 'gemini-2.5-flash',
    selectedType: null, // 'kiso' | 'mokutekichi'
    file: null,
  };

  // ─── DOM要素 ──────────────────────────────────
  const $ = id => document.getElementById(id);

  const els = {
    apiKeyInput:       $('apiKeyInput'),
    toggleApiKey:      $('toggleApiKey'),
    saveApiKey:        $('saveApiKey'),
    verifyApiKey:      $('verifyApiKey'),
    apiKeyStatus:      $('apiKeyStatus'),
    btnKiso:           $('btnKiso'),
    btnMokutekichi:    $('btnMokutekichi'),
    uploadArea:        $('uploadArea'),
    fileInput:         $('fileInput'),
    fileInfo:          $('fileInfo'),
    fileName:          $('fileName'),
    fileSize:          $('fileSize'),
    removeFile:        $('removeFile'),
    previewContainer:  $('previewContainer'),
    checkBtn:          $('checkBtn'),
    checkNote:         $('checkNote'),
    loadingSection:    $('loadingSection'),
    resultSection:     $('resultSection'),
    resultSummary:     $('resultSummary'),
    overallResult:     $('overallResult'),
    detectedInfo:      $('detectedInfo'),
    resultCategories:  $('resultCategories'),
    aiComment:         $('aiComment'),
    exportBtn:         $('exportBtn'),
    recheckBtn:        $('recheckBtn'),
  };

  // ─── 初期化 ───────────────────────────────────
  function init() {
    const savedKey = localStorage.getItem('nev_haisen_apikey');
    if (savedKey) {
      els.apiKeyInput.value = savedKey;
      els.saveApiKey.checked = true;
      state.apiKey = savedKey;
      state.apiKeyVerified = true;
      showApiKeyStatus('保存済み', 'success');
      verifyModels(savedKey);
    }

    bindEvents();
    updateCheckButton();
  }

  // ─── イベントバインド ─────────────────────────
  function bindEvents() {
    els.apiKeyInput.addEventListener('input', onApiKeyInput);
    els.toggleApiKey.addEventListener('click', toggleApiKeyVisibility);
    els.verifyApiKey.addEventListener('click', onVerifyApiKey);
    els.saveApiKey.addEventListener('change', onSaveApiKeyToggle);

    document.querySelectorAll('input[name="geminiModel"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.selectedModel = e.target.value;
      });
    });

    els.btnKiso.addEventListener('click', () => selectType('kiso'));
    els.btnMokutekichi.addEventListener('click', () => selectType('mokutekichi'));

    els.uploadArea.addEventListener('click', (e) => {
      if (e.target.closest('.upload-btn') || e.target === els.fileInput) return;
      els.fileInput.click();
    });
    els.fileInput.addEventListener('change', onFileSelect);
    els.removeFile.addEventListener('click', removeFile);

    els.uploadArea.addEventListener('dragover', e => {
      e.preventDefault();
      els.uploadArea.classList.add('drag-over');
    });
    els.uploadArea.addEventListener('dragleave', () => {
      els.uploadArea.classList.remove('drag-over');
    });
    els.uploadArea.addEventListener('drop', e => {
      e.preventDefault();
      els.uploadArea.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        if (files[0].type === 'application/pdf') {
          handleFile(files[0]);
        } else {
          alert('PDF ファイルのみ対応しています。\nドロップされたファイル: ' + files[0].name);
        }
      }
    });

    els.checkBtn.addEventListener('click', runCheck);
    els.exportBtn.addEventListener('click', exportResult);
    els.recheckBtn.addEventListener('click', resetForRecheck);
  }

  // ─── API キー ─────────────────────────────────
  function onApiKeyInput() {
    state.apiKey = els.apiKeyInput.value.trim();
    state.apiKeyVerified = false;
    showApiKeyStatus('', '');
    updateCheckButton();
  }

  function toggleApiKeyVisibility() {
    const input = els.apiKeyInput;
    if (input.type === 'password') {
      input.type = 'text';
      els.toggleApiKey.innerHTML = '<span class="eye-icon">&#128064;</span>';
    } else {
      input.type = 'password';
      els.toggleApiKey.innerHTML = '<span class="eye-icon">&#128065;</span>';
    }
  }

  async function onVerifyApiKey() {
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      showApiKeyStatus('キーを入力してください', 'error');
      return;
    }

    els.verifyApiKey.disabled = true;
    els.verifyApiKey.textContent = '確認中...';
    showApiKeyStatus('', '');
    clearModelStatuses();

    try {
      const ok = await DrawingChecker.verifyApiKey(key);
      if (ok) {
        state.apiKey = key;
        state.apiKeyVerified = true;
        showApiKeyStatus('接続OK', 'success');
        if (els.saveApiKey.checked) {
          localStorage.setItem('nev_haisen_apikey', key);
        } else {
          localStorage.removeItem('nev_haisen_apikey');
        }
        verifyModels(key);
      } else {
        showApiKeyStatus('無効なキーです', 'error');
      }
    } catch (e) {
      showApiKeyStatus('接続エラー', 'error');
    } finally {
      els.verifyApiKey.disabled = false;
      els.verifyApiKey.textContent = '接続テスト';
      updateCheckButton();
    }
  }

  function clearModelStatuses() {
    DrawingChecker.MODELS.forEach(model => {
      const el = document.getElementById('status-' + model.id);
      if (el) { el.textContent = ''; el.className = 'model-status'; }
    });
  }

  async function verifyModels(apiKey) {
    DrawingChecker.MODELS.forEach(model => {
      const el = document.getElementById('status-' + model.id);
      if (el) { el.textContent = '確認中...'; el.className = 'model-status checking'; }
    });

    const results = await DrawingChecker.verifyAllModels(apiKey);

    DrawingChecker.MODELS.forEach(model => {
      const el = document.getElementById('status-' + model.id);
      if (!el) return;
      const r = results[model.id];
      if (r && r.available) {
        el.textContent = '\u2713 利用可能';
        el.className = 'model-status available';
      } else {
        el.textContent = '\u2717 利用不可';
        el.className = 'model-status unavailable';
        el.title = r ? r.reason : '';
      }
    });
  }

  function showApiKeyStatus(text, type) {
    els.apiKeyStatus.textContent = text;
    els.apiKeyStatus.className = 'status-badge' + (type ? ' ' + type : '');
  }

  function onSaveApiKeyToggle() {
    if (!els.saveApiKey.checked) {
      localStorage.removeItem('nev_haisen_apikey');
    } else if (state.apiKey) {
      localStorage.setItem('nev_haisen_apikey', state.apiKey);
    }
  }

  // ─── タイプ選択 ───────────────────────────────
  function selectType(type) {
    state.selectedType = type;
    els.btnKiso.classList.toggle('selected', type === 'kiso');
    els.btnMokutekichi.classList.toggle('selected', type === 'mokutekichi');
    updateCheckButton();
  }

  // ─── ファイル処理 ─────────────────────────────
  function onFileSelect(e) {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  }

  async function handleFile(file) {
    if (file.type !== 'application/pdf') {
      alert('PDF ファイルを選択してください。');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('ファイルサイズが20MBを超えています。');
      return;
    }

    state.file = file;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatFileSize(file.size);
    els.uploadArea.style.display = 'none';
    els.fileInfo.style.display = 'block';

    els.previewContainer.innerHTML = '';
    try {
      const canvas = await DrawingChecker.pdfToPreview(file);
      els.previewContainer.appendChild(canvas);
    } catch (e) {
      els.previewContainer.innerHTML = '<p style="color:#9ca3af;font-size:13px;">プレビューを生成できませんでした</p>';
    }

    updateCheckButton();
  }

  function removeFile() {
    state.file = null;
    els.fileInput.value = '';
    els.uploadArea.style.display = '';
    els.fileInfo.style.display = 'none';
    els.previewContainer.innerHTML = '';
    updateCheckButton();
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ─── チェックボタン制御 ───────────────────────
  function updateCheckButton() {
    const ready = state.apiKey && state.selectedType && state.file;
    els.checkBtn.disabled = !ready;

    if (!state.apiKey) {
      els.checkNote.textContent = 'Gemini API キーを入力してください';
    } else if (!state.selectedType) {
      els.checkNote.textContent = '図面タイプ（基礎充電 / 目的地充電）を選択してください';
    } else if (!state.file) {
      els.checkNote.textContent = 'チェック対象の PDF ファイルをアップロードしてください';
    } else {
      els.checkNote.textContent = '準備完了 \u2014 チェックを実行できます';
    }
  }

  // ─── チェック実行 ─────────────────────────────
  let lastResult = null;
  let isChecking = false;

  function setCheckingState(checking) {
    isChecking = checking;
    els.checkBtn.disabled = checking;
    els.btnKiso.disabled = checking;
    els.btnMokutekichi.disabled = checking;
    if (els.removeFile) els.removeFile.disabled = checking;
  }

  async function runCheck() {
    if (isChecking) return;
    setCheckingState(true);
    els.resultSection.style.display = 'none';
    els.loadingSection.style.display = '';

    els.loadingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
      const result = await DrawingChecker.check(state.apiKey, state.file, state.selectedType, state.selectedModel);
      lastResult = result;
      renderResult(result);
    } catch (e) {
      els.loadingSection.style.display = 'none';
      setCheckingState(false);
      alert('チェック中にエラーが発生しました:\n\n' + e.message);
      return;
    }

    els.loadingSection.style.display = 'none';
    els.resultSection.style.display = '';
    els.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCheckingState(false);
  }

  // ─── 結果描画 ─────────────────────────────────
  function renderResult(result) {
    const overallLabels = {
      pass: { icon: '&#9989;', text: '合格', desc: '全ての必須要件を満たしています' },
      warn: { icon: '&#9888;&#65039;', text: '要確認', desc: '一部の必須要件に不備の可能性があります' },
      fail: { icon: '&#10060;', text: '不合格', desc: '複数の必須要件が満たされていません' },
    };
    const ov = overallLabels[result.overall];

    els.overallResult.className = 'overall-result ' + result.overall;
    els.overallResult.innerHTML = `
      <span class="overall-icon">${ov.icon}</span>
      <div class="overall-label">${ov.text}</div>
      <div class="overall-score">
        合格 ${result.totalPass} / ${result.totalItems} 項目
        （必須: ${result.requiredPass} / ${result.requiredTotal}）
      </div>
      <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">${ov.desc}</div>
    `;

    const typeLabel = state.selectedType === 'kiso' ? '基礎充電' : '目的地充電';
    const modelInfo = DrawingChecker.MODELS.find(m => m.id === state.selectedModel);
    const modelLabel = modelInfo ? modelInfo.name : state.selectedModel;
    els.resultSummary.textContent = `${typeLabel} | ${modelLabel} | ${result.analyzedPages}\u30DA\u30FC\u30B8\u89E3\u6790`;

    renderDetectedInfo(result.detectedInfo);

    els.resultCategories.innerHTML = '';
    const categories = DrawingChecker.CATEGORIES;

    const sortedCats = Object.keys(result.categoryResults).sort((a, b) => {
      return (categories[a]?.order || 99) - (categories[b]?.order || 99);
    });

    sortedCats.forEach(catKey => {
      const catData = result.categoryResults[catKey];
      const catMeta = categories[catKey] || { title: catKey, icon: '&#128203;' };

      let badgeClass, badgeText;
      if (catData.fail === 0 && catData.warn === 0) {
        badgeClass = 'pass'; badgeText = '全て合格';
      } else if (catData.fail === 0) {
        badgeClass = 'warn'; badgeText = `${catData.warn}件 要確認`;
      } else {
        badgeClass = 'fail'; badgeText = `${catData.fail}件 不合格`;
      }

      const catEl = document.createElement('div');
      catEl.className = 'result-category';
      catEl.innerHTML = `
        <div class="category-header">
          <span class="category-icon">${catMeta.icon}</span>
          <span class="category-title">${catMeta.title}</span>
          <span class="category-badge ${badgeClass}">${badgeText}</span>
        </div>
        <ul class="category-items">
          ${catData.items.map(item => renderCheckItem(item)).join('')}
        </ul>
      `;
      els.resultCategories.appendChild(catEl);
    });

    els.aiComment.textContent = result.overallComment || '（コメントなし）';
  }

  function renderDetectedInfo(info) {
    if (!info || Object.keys(info).length === 0) {
      els.detectedInfo.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">読み取り情報なし</p>';
      return;
    }

    const fields = [
      { key: 'facility_name',        label: '施設名' },
      { key: 'drawing_title',        label: '図面名称' },
      { key: 'project_name',         label: '工事名' },
      { key: 'creator',              label: '作成者' },
      { key: 'scale',                label: '縮尺' },
      { key: 'creation_date',        label: '作成日' },
      { key: 'wire_type',            label: '電線種類' },
      { key: 'total_length',         label: '配線全長' },
      { key: 'length_breakdown',     label: '配線内訳' },
      { key: 'wiring_methods',       label: '配線方法' },
      { key: 'conduit_types',        label: '配管種類' },
      { key: 'power_source',         label: '電源元' },
      { key: 'equipment_count',      label: 'EV充電設備数' },
      { key: 'surface_material',     label: '路面状況' },
      { key: 'ancillary_equipment',  label: '付帯設備' },
      { key: 'existing_equipment_info', label: '既設設備' },
    ];

    const items = fields
      .filter(f => info[f.key] && info[f.key].toString().trim() !== '')
      .map(f => `
        <div class="detected-info-item">
          <span class="detected-info-label">${f.label}</span>
          <span class="detected-info-value">${escapeHtml(info[f.key].toString())}</span>
        </div>
      `).join('');

    els.detectedInfo.innerHTML = items
      ? `<div class="detected-info-grid">${items}</div>`
      : '<p style="color:var(--gray-400);font-size:13px;">読み取り情報なし</p>';
  }

  function renderCheckItem(item) {
    const icons = { pass: '&#10003;', fail: '&#10007;', warn: '!' };
    const statusLabels = { pass: '合格', fail: '不合格', warn: '要確認' };
    const requiredBadge = item.required ? '' : '<span style="font-size:11px;color:var(--gray-400);margin-left:4px;">[任意]</span>';

    let detailHtml = '';
    if (item.found_text) {
      const detailClass = item.status === 'pass' ? 'found' : item.status === 'fail' ? 'not-found' : '';
      detailHtml += `<div class="check-detail ${detailClass}">検出: ${escapeHtml(item.found_text)}</div>`;
    }
    if (item.detail) {
      detailHtml += `<div class="check-detail">${escapeHtml(item.detail)}</div>`;
    }

    return `
      <li class="check-item">
        <span class="check-icon ${item.status}" title="${statusLabels[item.status]}">${icons[item.status]}</span>
        <div class="check-content">
          <div class="check-label">${escapeHtml(item.label)}${requiredBadge}</div>
          ${detailHtml}
        </div>
      </li>
    `;
  }

  // ─── ユーティリティ ───────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── 結果エクスポート ─────────────────────────
  function exportResult() {
    if (!lastResult) return;
    const text = DrawingChecker.resultToText(lastResult, state.selectedType);
    navigator.clipboard.writeText(text).then(() => {
      const orig = els.exportBtn.textContent;
      els.exportBtn.textContent = '\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F!';
      setTimeout(() => { els.exportBtn.innerHTML = '&#128196; 結果をコピー'; }, 2000);
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      els.exportBtn.textContent = '\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F!';
      setTimeout(() => { els.exportBtn.innerHTML = '&#128196; 結果をコピー'; }, 2000);
    });
  }

  // ─── 再チェック ───────────────────────────────
  function resetForRecheck() {
    lastResult = null;
    els.resultSection.style.display = 'none';
    removeFile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── 起動 ─────────────────────────────────────
  init();

});
