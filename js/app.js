/* ============================================================
   app.js — メインアプリケーションロジック
   NeV 配線ルート図 要件判定チェックツール
   機能: NeV要件判定 / 作図センターマニュアル判定 / 配線・配管集計
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ─── 状態管理 ─────────────────────────────────
  const state = {
    apiKey: '',
    apiKeyVerified: false,
    selectedModel: 'gemini-2.5-flash',
    selectedType: null,
    file: null,
    roughWireData: null,     // ラフ図Excel: 配線データ [{type, total_length_m}]
    roughConduitData: null,  // ラフ図Excel: 配管データ [{type, total_length_m}]
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
    detectedInfo:      $('detectedInfo'),
    // NeV判定
    nevOverallResult:  $('nevOverallResult'),
    nevCategories:     $('nevCategories'),
    // マニュアル判定
    manualOverallResult: $('manualOverallResult'),
    manualCategories:  $('manualCategories'),
    // タブ
    tabNev:            $('tabNev'),
    tabManual:         $('tabManual'),
    tabNevBadge:       $('tabNevBadge'),
    tabManualBadge:    $('tabManualBadge'),
    nevContent:        $('nevContent'),
    manualContent:     $('manualContent'),
    // 3ソース比較テーブル
    compareWireTable:  $('compareWireTable'),
    compareConduitTable:$('compareConduitTable'),
    // 乖離サニティチェック警告
    discrepancyWarnings: $('discrepancyWarnings'),
    // 旗上げ
    annotationsContent:$('annotationsContent'),
    // ラフ図Excel
    roughUploadSection:$('roughUploadSection'),
    roughFileInput:    $('roughFileInput'),
    roughFileName:     $('roughFileName'),
    roughRemove:       $('roughRemove'),
    // その他
    aiComment:         $('aiComment'),
    exportBtn:         $('exportBtn'),
    exportExcelBtn:    $('exportExcelBtn'),
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

    // ブラウザのフォーム自動復元に対応: ラジオボタンの実際の状態を state に同期
    const checkedRadio = document.querySelector('input[name="geminiModel"]:checked');
    if (checkedRadio) {
      state.selectedModel = checkedRadio.value;
    }

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

    // ラフ図Excel
    els.roughFileInput.addEventListener('change', onRoughFileSelect);
    els.roughRemove.addEventListener('click', removeRoughFile);

    els.checkBtn.addEventListener('click', runCheck);
    els.exportBtn.addEventListener('click', exportResult);
    els.exportExcelBtn.addEventListener('click', exportExcel);
    els.recheckBtn.addEventListener('click', resetForRecheck);

    // タブ切替
    els.tabNev.addEventListener('click', () => switchTab('nev'));
    els.tabManual.addEventListener('click', () => switchTab('manual'));
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

    // ステータス表示の更新（ユーザーの選択は変更しない）
    DrawingChecker.MODELS.forEach(model => {
      const el = document.getElementById('status-' + model.id);
      if (!el) return;
      const r = results[model.id];
      if (r && r.available) {
        el.textContent = '\u2713 利用可能';
        el.className = 'model-status available';
      } else {
        el.textContent = '\u2717 ' + (r?.reason || '利用不可');
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
      if (canvas) {
        els.previewContainer.appendChild(canvas);
      } else {
        els.previewContainer.innerHTML = '<p style="color:#9ca3af;font-size:13px;">プレビューを生成できませんでした</p>';
      }
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

  // ─── ラフ図Excel読み取り ───────────────────────
  function onRoughFileSelect(e) {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    parseRoughExcel(file);
  }

  async function parseRoughExcel(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array' });

      // 「配線・配管集計」シートを探す（完全一致優先→部分一致→なければエラー）
      const sheetName = wb.SheetNames.find(n => n === '配線・配管集計')
        || wb.SheetNames.find(n => n.includes('配線') && n.includes('配管'));
      if (!sheetName) {
        alert('「配線・配管集計」シートが見つかりません。\nラフ図チェックツールが出力したExcelを選択してください。\n\n検出されたシート: ' + wb.SheetNames.join(', '));
        return;
      }
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const wireData = [];
      const conduitData = [];
      let section = null; // 'wire' or 'conduit'

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cellA = String(row[0] || '').trim();

        // セクション検出
        if (cellA.includes('【配線集計】')) { section = 'wire'; continue; }
        if (cellA.includes('【配管集計】')) { section = 'conduit'; continue; }
        if (cellA === '配線合計' || cellA === '配管合計') { section = null; continue; }

        // ヘッダー行をスキップ
        if (cellA === '配線種別' || cellA === '配管種別') continue;

        // 内訳行（先頭スペース）をスキップ
        if (String(row[0] || '').startsWith('  ')) continue;

        if (section === 'wire' && cellA) {
          // 配線: col A=種別, col B=記載総長(m)
          const val = parseFloat(row[1]);
          if (!isNaN(val)) {
            wireData.push({ type: cellA, total_length_m: val });
          }
        } else if (section === 'conduit' && cellA) {
          // 配管: col A=種別, col E=合計長(m)
          const val = parseFloat(row[4]);
          if (!isNaN(val)) {
            // 同一種別を集約
            const existing = conduitData.find(d => d.type === cellA);
            if (existing) {
              existing.total_length_m += val;
            } else {
              conduitData.push({ type: cellA, total_length_m: val });
            }
          }
        }
      }

      state.roughWireData = wireData.length > 0 ? wireData : null;
      state.roughConduitData = conduitData.length > 0 ? conduitData : null;

      // UI更新
      els.roughFileName.textContent = file.name + ' ✓';
      els.roughFileName.style.color = 'var(--success)';
      els.roughRemove.style.display = '';

      // 結果が表示中なら比較テーブルを再描画
      if (lastResult) {
        renderCompareTable(els.compareWireTable, 'wire', lastResult.tableWireTotals, lastResult.countedWireTotals, lastResult.drawnWireLengths, state.roughWireData, null);
        renderCompareTable(els.compareConduitTable, 'conduit', lastResult.tableConduitTotals, lastResult.countedConduitTotals, lastResult.drawnConduitLengths, state.roughConduitData, lastResult.conduitSharingAnalysis);
      }
    } catch (err) {
      console.error('ラフ図Excel解析エラー:', err);
      alert('Excelファイルの読み取りに失敗しました。\nラフ図チェックツールが出力したExcelか確認してください。');
    }
  }

  function removeRoughFile() {
    state.roughWireData = null;
    state.roughConduitData = null;
    els.roughFileInput.value = '';
    els.roughFileName.textContent = '';
    els.roughRemove.style.display = 'none';

    // 結果が表示中なら比較テーブルを再描画（ラフ図列を除去）
    if (lastResult) {
      renderCompareTable(els.compareWireTable, 'wire', lastResult.tableWireTotals, lastResult.countedWireTotals, lastResult.drawnWireLengths, null, null);
      renderCompareTable(els.compareConduitTable, 'conduit', lastResult.tableConduitTotals, lastResult.countedConduitTotals, lastResult.drawnConduitLengths, null, lastResult.conduitSharingAnalysis);
    }
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

  // ─── タブ切替 ─────────────────────────────────
  function switchTab(tab) {
    els.tabNev.classList.toggle('active', tab === 'nev');
    els.tabManual.classList.toggle('active', tab === 'manual');
    els.nevContent.classList.toggle('active', tab === 'nev');
    els.manualContent.classList.toggle('active', tab === 'manual');
  }

  // ─── エラー表示 ───────────────────────────────
  function showError(err) {
    const container = document.getElementById('errorSection');
    if (!container) {
      alert('チェック中にエラーが発生しました:\n\n' + err.message);
      return;
    }

    let html = '';

    if (err.type === 'quota_exceeded') {
      html += `<div class="error-card quota-error">`;
      html += `<div class="error-header">`;
      html += `<span class="error-icon">&#9888;&#65039;</span>`;
      html += `<span class="error-title">${escapeHtml(err.message)}</span>`;
      html += `</div>`;

      if (err.isFreeTier) {
        html += `<div class="error-detail">`;
        html += `<p>Gemini API の<strong>無料枠（Free Tier）</strong>が上限に達しました。有料契約済みの場合でも、無料枠が優先消費されます。</p>`;
        html += `<p>有料枠（Pay-as-you-go）を利用するには、APIキーに課金設定を紐づける必要があります。</p>`;
        html += `</div>`;
      }

      if (err.suggestions && err.suggestions.length > 0) {
        html += `<div class="error-suggestions">`;
        html += `<div class="error-suggestions-title">対処方法:</div>`;
        html += `<ul>`;
        err.suggestions.forEach(s => {
          if (s.startsWith('http')) {
            html += `<li><a href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a></li>`;
          } else {
            html += `<li>${escapeHtml(s)}</li>`;
          }
        });
        html += `</ul>`;
      html += `</div>`;
      }

      // キャッシュクリア手順ガイド（折りたたみ式）
      //   自動リトライが尽きた quota_exceeded では「ブラウザ側リセット」が有効なケースが多いため案内する。
      html += renderResetGuide();

      html += `<div class="error-retry">`;
      html += `<button class="btn btn-retry" onclick="var s=this.closest('#errorSection')||this.closest('.error-card').parentElement;this.closest('.error-card').remove();if(s)s.style.display='none'">`;
      html += `&#128260; 閉じて再試行</button>`;
      html += `</div>`;

      html += `</div>`;
    } else if (err.type === 'parse_error') {
      html += `<div class="error-card quota-error">`;
      html += `<div class="error-header">`;
      html += `<span class="error-icon">&#9888;&#65039;</span>`;
      html += `<span class="error-title">Gemini の応答を解析できませんでした</span>`;
      html += `</div>`;

      // メッセージを改行で分割して表示
      const lines = err.message.split('\n').filter(l => l.trim());
      html += `<div class="error-detail">`;
      lines.forEach(line => { html += `<p>${escapeHtml(line)}</p>`; });
      if (err.model) {
        html += `<p>使用モデル: <strong>${escapeHtml(err.model)}</strong></p>`;
      }
      if (err.finishReason) {
        html += `<p>終了理由: <code>${escapeHtml(err.finishReason)}</code></p>`;
      }
      if (err.responsePreview) {
        html += `<p style="margin-top:8px;font-size:11px;color:var(--gray-400);">応答冒頭: ${escapeHtml(err.responsePreview)}</p>`;
      }
      html += `</div>`;

      html += `<div class="error-retry">`;
      html += `<button class="btn btn-retry" onclick="var s=this.closest('#errorSection')||this.closest('.error-card').parentElement;this.closest('.error-card').remove();if(s)s.style.display='none'">`;
      html += `&#128260; 閉じて再試行</button>`;
      html += `</div>`;
      html += `</div>`;
    } else if (err.type === 'server_overload') {
      html += `<div class="error-card quota-error">`;
      html += `<div class="error-header">`;
      html += `<span class="error-icon">&#9889;</span>`;
      html += `<span class="error-title">${escapeHtml(err.message)}</span>`;
      html += `</div>`;
      html += `<div class="error-detail">`;
      html += `<p>Gemini API サーバーが一時的に高負荷状態です。これは通常、数十秒〜数分で解消します。</p>`;
      html += `<p>しばらく待ってから「リトライ」ボタンを押してください。</p>`;
      html += `</div>`;
      html += `<div class="error-suggestions">`;
      html += `<div class="error-suggestions-title">対処方法:</div>`;
      html += `<ul>`;
      html += `<li>30秒〜1分ほど待ってからリトライしてください</li>`;
      if (err.model && err.model.includes('pro')) {
        html += `<li>Gemini 2.5 Flash など別のモデルに切り替えると成功しやすくなります</li>`;
      }
      html += `<li>繰り返し発生する場合は、時間帯を変えてお試しください</li>`;
      html += `</ul>`;
      html += `</div>`;

      // キャッシュクリア手順ガイド（折りたたみ式）
      //   server_overload は HTTP/2 コネクション状態などブラウザ側起因のケースも多いため案内する。
      html += renderResetGuide();

      html += `<div class="error-retry" style="display:flex;gap:8px;">`;
      html += `<button class="btn btn-primary" onclick="var s=document.getElementById('errorSection');if(s){s.style.display='none';s.innerHTML='';}document.getElementById('checkBtn').click();">`;
      html += `&#128260; リトライ</button>`;
      html += `<button class="btn btn-retry" onclick="var s=this.closest('#errorSection')||this.closest('.error-card').parentElement;this.closest('.error-card').remove();if(s)s.style.display='none'">`;
      html += `閉じる</button>`;
      html += `</div>`;
      html += `</div>`;
    } else {
      html += `<div class="error-card general-error">`;
      html += `<div class="error-header">`;
      html += `<span class="error-icon">&#10060;</span>`;
      html += `<span class="error-title">チェック中にエラーが発生しました</span>`;
      html += `</div>`;
      html += `<div class="error-detail"><p>${escapeHtml(err.message)}</p></div>`;
      html += `<div class="error-retry">`;
      html += `<button class="btn btn-retry" onclick="var s=this.closest('#errorSection')||this.closest('.error-card').parentElement;this.closest('.error-card').remove();if(s)s.style.display='none'">`;
      html += `&#128260; 閉じる</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    container.innerHTML = html;
    container.style.display = '';
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const errSec = document.getElementById('errorSection');
    if (errSec) { errSec.style.display = 'none'; errSec.innerHTML = ''; }

    els.loadingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 2パス方式の進捗コールバック — ローディングテキストを更新
    const onProgress = (info) => {
      const loadingText = els.loadingSection.querySelector('.loading-text');
      const loadingSub = els.loadingSection.querySelector('.loading-subtext');
      if (loadingText) loadingText.textContent = `Pass ${info.pass}/${info.total}: ${info.message}`;
      if (loadingSub) {
        loadingSub.textContent = info.pass === 1
          ? '統括表・旗上げ・記載線長を丁寧に読み取っています...'
          : 'NeV要件・マニュアル準拠の合否を判定しています...';
      }
    };

    try {
      const result = await DrawingChecker.check(state.apiKey, state.file, state.selectedType, state.selectedModel, onProgress);
      lastResult = result;
      renderResult(result);
    } catch (e) {
      els.loadingSection.style.display = 'none';
      setCheckingState(false);
      showError(e);
      return;
    }

    els.loadingSection.style.display = 'none';
    els.resultSection.style.display = '';
    els.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCheckingState(false);
  }

  // ─── 結果描画 ─────────────────────────────────
  function renderResult(result) {
    const typeLabel = state.selectedType === 'kiso' ? '基礎充電' : '目的地充電';
    const modelInfo = DrawingChecker.MODELS.find(m => m.id === state.selectedModel);
    const modelLabel = modelInfo ? modelInfo.name : state.selectedModel;
    const modeLabel = result.inputMode === 'pdf-native' ? 'PDF直接読取' : '画像変換';
    els.resultSummary.textContent = `${typeLabel} | ${modelLabel} | ${result.analyzedPages}ページ解析 | ${modeLabel}`;

    // 読み取り情報
    renderDetectedInfo(result.detectedInfo);

    // ラフ図Excel取込セクションを表示
    if (els.roughUploadSection) els.roughUploadSection.style.display = '';

    // 乖離サニティチェック警告（統括表 vs 旗上げ合計）
    renderDiscrepancyWarnings(result.discrepancyWarnings);

    // 比較テーブル（ラフ図データがあれば4列目追加）
    renderCompareTable(els.compareWireTable, 'wire', result.tableWireTotals, result.countedWireTotals, result.drawnWireLengths, state.roughWireData, null);
    renderCompareTable(els.compareConduitTable, 'conduit', result.tableConduitTotals, result.countedConduitTotals, result.drawnConduitLengths, state.roughConduitData, result.conduitSharingAnalysis);

    // 旗上げ詳細一覧
    renderAnnotationsCheck(result.flaggedAnnotations, result.tableWireTotals, result.tableConduitTotals);

    // NeV判定
    renderOverallBadge(els.nevOverallResult, result.nev);
    renderCategoryResults(els.nevCategories, result.nev, 'nev');

    // マニュアル判定
    renderOverallBadge(els.manualOverallResult, result.manual);
    renderCategoryResults(els.manualCategories, result.manual, 'manual');

    // タブバッジ
    renderTabBadge(els.tabNevBadge, result.nev);
    renderTabBadge(els.tabManualBadge, result.manual);

    // デフォルトでNeVタブを表示
    switchTab('nev');

    // AIコメント
    els.aiComment.textContent = result.overallComment || '（コメントなし）';

    // 料金概算
    renderCostEstimate(result.costEstimate);
  }

  function renderCostEstimate(cost) {
    const el = document.getElementById('costEstimate');
    if (!el) return;
    if (!cost) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }

    const fmtNum = n => n.toLocaleString();

    el.style.display = '';
    el.innerHTML = `
      <div class="cost-card">
        <div class="cost-header">
          <span class="cost-icon">&#128176;</span>
          <span class="cost-title">Gemini API 料金目安（税別）</span>
          <span class="cost-note">※ 概算値です。実際の請求額とは異なる場合があります</span>
        </div>
        <div class="cost-body">
          <div class="cost-row">
            <span class="cost-label">モデル</span>
            <span class="cost-value">${escapeHtml(cost.model)}</span>
          </div>
          <div class="cost-row">
            <span class="cost-label">入力トークン</span>
            <span class="cost-value">${fmtNum(cost.inputTokens)} tokens（$${cost.inputCostUsd}）</span>
          </div>
          <div class="cost-row">
            <span class="cost-label">出力トークン</span>
            <span class="cost-value">${fmtNum(cost.outputTokens)} tokens（$${cost.outputCostUsd}）</span>
          </div>
          <div class="cost-row cost-total">
            <span class="cost-label">合計（概算）</span>
            <span class="cost-value"><strong>$${cost.totalCostUsd}</strong>（約 <strong>${cost.totalCostJpy}円</strong>）</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderOverallBadge(el, data) {
    const overallLabels = {
      pass: { icon: '&#9989;', text: '合格', desc: '全ての必須要件を満たしています' },
      warn: { icon: '&#9888;&#65039;', text: '要確認', desc: '一部の必須要件に不備の可能性があります' },
      fail: { icon: '&#10060;', text: '不合格', desc: '複数の必須要件が満たされていません' },
    };
    const ov = overallLabels[data.overall] || overallLabels.warn;

    el.className = 'overall-result ' + (data.overall || 'warn');
    el.innerHTML = `
      <span class="overall-icon">${ov.icon}</span>
      <div class="overall-label">${ov.text}</div>
      <div class="overall-score">
        合格 ${data.totalPass} / ${data.totalItems} 項目
        （必須: ${data.requiredPass} / ${data.requiredTotal}）
      </div>
      <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">${ov.desc}</div>
    `;
  }

  function renderTabBadge(el, data) {
    if (data.overall === 'pass') {
      el.className = 'tab-badge pass';
      el.textContent = '合格';
    } else if (data.overall === 'warn') {
      el.className = 'tab-badge warn';
      el.textContent = '要確認';
    } else {
      el.className = 'tab-badge fail';
      el.textContent = `NG ${data.requiredFail || 0}件`;
    }
  }

  function renderCategoryResults(container, data, group) {
    container.innerHTML = '';
    const categories = DrawingChecker.CATEGORIES;

    const sortedCats = Object.keys(data.categoryResults).sort((a, b) => {
      return (categories[a]?.order || 99) - (categories[b]?.order || 99);
    });

    sortedCats.forEach(catKey => {
      const catData = data.categoryResults[catKey];
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
      container.appendChild(catEl);
    });
  }

  // ─── 比較テーブル描画（3〜4ソース対応）──────────────

  // ─── 種別名の正規化（表記揺れ吸収）────────────────
  // 【設計契約 / 単一ソース原則】
  //   本関数は DrawingChecker.normalizeKey（checker.js）への委譲ラッパーである。
  //   過去、app.js と checker.js で別実装を持っていたため
  //   "CV8sq×3C" と "CV8sq3C" が片方でしか統合されない、というキースペース分裂バグがあった。
  //   現在は checker.js の normalizeKey が「唯一の」正規化器。
  //
  //   ・ここに独自の replace を追加してはならない（ルール分裂の再発防止）。
  //   ・新しい正規化ルールが必要な場合は checker.js の normalizeKey を修正する。
  //   ・万一 DrawingChecker が未ロードの場合に備えたフォールバックは残してあるが、
  //     通常は unreachable。フォールバック発火時はコンソール警告を出す。
  function normalizeType(str) {
    if (!str) return '';
    // ※ DrawingChecker は checker.js で `const` 宣言されている global。
    //    `const` は window プロパティにならないため `typeof` で存在チェックする
    //    （`window.DrawingChecker` は undefined になる）。
    if (typeof DrawingChecker !== 'undefined'
        && DrawingChecker
        && typeof DrawingChecker.normalizeKey === 'function') {
      return DrawingChecker.normalizeKey(str);
    }
    // フォールバック（通常到達しない）: checker.js 未ロード時の保険
    console.warn('[normalizeType] DrawingChecker.normalizeKey unavailable; using fallback');
    return str
      .replace(/\s+/g, '')
      .replace(/[×xＸ]/gi, 'x')
      .replace(/[ー−–—]/g, '-')
      .toUpperCase();
  }

  // ─── ファジーマッチング（編集距離1の孤立キー統合）──────
  // 片方にしかないキー同士を編集距離で照合し、1文字違いなら統合。
  //
  // 【checker.js の detectDiscrepancies との責務分離】
  //   ・本関数（表示層）: 比較テーブルを見やすくするため孤立キーを視覚的に統合
  //   ・detectDiscrepancies（データ層）: 乖離警告そのものを検出（警告を出すことが目的）
  //   → 両者の入力は同じ（counted/table totals）だが、出力先と目的が異なる。
  //   → 本関数で統合されても警告データ自体は消えない（既に別配列として確定済み）。
  //   → 逆にデータ層で同様の統合を行うと、missing_in_* の警告が消失して
  //     「OCR 誤読の疑いをユーザーに告げる」という警告層の目的が崩れる。
  //   エラーチェック時: fuzzyMergeKeys の改変が警告件数に波及していないか確認すること。
  function fuzzyMergeKeys(merged) {
    const keys = Object.keys(merged);
    // 全ソースが揃っているキーと、片方だけのキーを分類
    const incomplete = keys.filter(k => {
      const r = merged[k];
      return r.table === undefined || (r.counted === undefined && r.drawn === undefined);
    });
    if (incomplete.length < 2) return;

    // 統括表のみ存在するキーと、旗上げ/記載線長のみ存在するキーを分離
    const tableOnly = incomplete.filter(k => merged[k].table !== undefined && merged[k].counted === undefined && merged[k].drawn === undefined);
    const countedOnly = incomplete.filter(k => merged[k].table === undefined && (merged[k].counted !== undefined || merged[k].drawn !== undefined));

    for (const tk of tableOnly) {
      let bestKey = null;
      let bestDist = Infinity;
      for (const ck of countedOnly) {
        const d = levenshtein1(tk, ck);
        if (d < bestDist) { bestDist = d; bestKey = ck; }
      }
      if (bestDist <= 1 && bestKey) {
        // 統合: countedOnly のデータを tableOnly 側にマージ
        const src = merged[bestKey];
        const dst = merged[tk];
        if (src.counted !== undefined) dst.counted = src.counted;
        if (src.drawn !== undefined) dst.drawn = src.drawn;
        if (src.rough !== undefined && dst.rough === undefined) dst.rough = src.rough;
        // 表示名は長い方を採用
        if (src.displayName.length > dst.displayName.length) {
          dst.displayName = src.displayName;
        }
        delete merged[bestKey];
        // countedOnly からも除外
        const idx = countedOnly.indexOf(bestKey);
        if (idx >= 0) countedOnly.splice(idx, 1);
      }
    }
  }

  // 編集距離（最大1まで高速判定）
  function levenshtein1(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return 2;
    if (la === lb) {
      let diff = 0;
      for (let i = 0; i < la; i++) { if (a[i] !== b[i]) diff++; if (diff > 1) return 2; }
      return diff;
    }
    const longer = la > lb ? a : b;
    const shorter = la > lb ? b : a;
    let diff = 0;
    for (let i = 0, j = 0; i < shorter.length; i++, j++) {
      if (shorter[i] !== longer[j]) { diff++; if (diff > 1) return 2; j++; if (j >= longer.length || shorter[i] !== longer[j]) return 2; }
    }
    return 1;
  }

  // ─── 乖離サニティチェック警告の描画 ────────────────
  // checker.js の detectDiscrepancies が返した警告リストをバッジ表示。
  // 警告がなければ非表示。ユーザー目視確認を促すため数値補正は行わない。
  //
  // 【設計契約 / エラーチェック時に必ず保証すべき不変条件】
  //   1. 全ての動的文字列（severity, message, labelFor 出力）は escapeHtml() を通すこと
  //      → 現状 w.severity / w.message / labelFor(w.severity) の 3 箇所が該当。
  //        Gemini 応答は本来英数字だが、将来ユーザー由来文字列が混入しても XSS を防ぐ。
  //   2. warnings 配列が空 / null の場合は el.style.display='none' で完全に隠すこと
  //      （前回実行の警告が残らないように innerHTML もクリア）
  //   3. 警告は Excel 出力対象外（意図的除外）:
  //      → Excel は「確定済み数値」を配るための成果物。警告は確認プロセス用。
  //      → 将来 Excel に含めたい場合は excel.js に専用シートを追加する方針
  //        （既存シートを汚染しないこと）。
  //   4. 本関数は renderResult() の冒頭（他テーブル描画より先）で呼ばれる想定。
  //      再実行時に DOM 残骸が残らないよう、最初に innerHTML をクリアしている。
  function renderDiscrepancyWarnings(warnings) {
    const el = els.discrepancyWarnings;
    if (!el) return;
    if (!warnings || warnings.length === 0) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const iconFor = sev => {
      if (sev === 'missing_in_counted') return '&#9888;';   // ⚠
      if (sev === 'missing_in_table')   return '&#10067;';  // ❓
      return '&#128202;';                                    // 📊
    };
    const labelFor = sev => {
      if (sev === 'missing_in_counted') return '旗上げ欠落疑い';
      if (sev === 'missing_in_table')   return '統括表欠落疑い';
      return '数値乖離';
    };

    let html = '<div class="discrepancy-header">';
    html += '<span class="discrepancy-icon">&#128073;</span>';
    html += `<span class="discrepancy-title">信頼度警告 (${warnings.length}件)</span>`;
    html += '<span class="discrepancy-note">統括表と旗上げ合計に大きな差があります。目視で確認してください。</span>';
    html += '</div><ul class="discrepancy-list">';

    warnings.forEach(w => {
      html += '<li class="discrepancy-item">';
      html += `<span class="discrepancy-badge sev-${escapeHtml(w.severity)}">${iconFor(w.severity)} ${escapeHtml(labelFor(w.severity))}</span>`;
      html += `<span class="discrepancy-msg">${escapeHtml(w.message)}</span>`;
      html += '</li>';
    });
    html += '</ul>';

    el.innerHTML = html;
    el.style.display = '';
  }

  // ─── 共入れ由来差の判定ヘルパー ──────────────────
  // 【判定条件】すべて満たす場合、"共入れ重複の可能性" ヒントを表示：
  //   1. kind === 'conduit'（配管のみ、配線には共入れ概念なし）
  //   2. tv !== undefined && fv !== undefined && fv > tv（旗上げが統括表を上回る）
  //   3. この配管種に対し、複数のケーブル種別が旗上げに存在（cableTypeCount >= 2）
  //   4. かつ shared_conduit_count による + 表記共入れが1件以上ある（hasPlusSharing）
  //   → 異なるケーブル種別間の物理配管共有が原因で旗上げが二重計上された可能性が高い
  //
  // 【sharingAnalysis のキー空間について】
  //   checker.js の normalizeKey で生成されたキー。
  //   一方この関数の merged は normalizeType 由来。両者の正規化粒度は僅かに異なる
  //   可能性があるため、displayName 一致で補助照合する。
  function isLikelySharingOvercount(kind, tv, fv, displayName, sharingAnalysis) {
    if (kind !== 'conduit') return false;
    if (tv === undefined || tv === null || fv === undefined || fv === null) return false;
    if (fv <= tv) return false;
    if (!sharingAnalysis) return false;
    // キー直接照合 → 見つからなければ displayName マッチでフォールバック
    const normKey = normalizeType(displayName);
    let info = null;
    for (const k of Object.keys(sharingAnalysis)) {
      const v = sharingAnalysis[k];
      if (normalizeType(v.displayName) === normKey) { info = v; break; }
    }
    if (!info) return false;
    return info.cableTypeCount >= 2 && info.hasPlusSharing;
  }

  function renderCompareTable(el, kind, tableData, countedData, drawnData, roughData, sharingAnalysis) {
    const hasRough = roughData && roughData.length > 0;
    const toNum = v => (v === undefined || v === null || v === '') ? undefined : Number(v);

    // 正規化キー → { displayName, table, counted, drawn, rough }
    const merged = {};
    const addSource = (data, field) => {
      if (!data) return;
      data.forEach(t => {
        const key = normalizeType(t.type);
        if (!key) return;
        if (!merged[key]) merged[key] = { displayName: t.type };
        merged[key][field] = toNum(t.total_length_m);
        // 表示名は最も長い（情報量が多い）ものを採用
        if (t.type.length > merged[key].displayName.length) {
          merged[key].displayName = t.type;
        }
      });
    };
    addSource(tableData, 'table');
    addSource(countedData, 'counted');
    addSource(drawnData, 'drawn');
    if (hasRough) addSource(roughData, 'rough');

    // ファジーマッチング: 辞書補正で漏れた1文字違いキーを統合
    fuzzyMergeKeys(merged);

    const keys = Object.keys(merged);
    if (keys.length === 0) {
      el.innerHTML = '<p class="totals-empty">データを読み取れませんでした</p>';
      return;
    }

    let html = '<table class="compare-table"><thead><tr>';
    html += '<th>種別</th>';
    html += '<th class="col-table">&#9312; 統括表</th>';
    html += '<th class="col-flag">&#9313; 旗上げ合計</th>';
    html += '<th class="col-drawn">&#9314; 記載線長</th>';
    if (hasRough) html += '<th class="col-rough">&#9315; ラフ図</th>';
    html += '<th class="col-status">判定</th>';
    html += '</tr></thead><tbody>';

    keys.forEach(key => {
      const row = merged[key];
      const tv = row.table;
      const fv = row.counted;
      const dv = row.drawn;
      const rv = hasRough ? row.rough : undefined;

      // 全値の一致判定
      const vals = [tv, fv, dv];
      if (hasRough) vals.push(rv);
      const validVals = vals.filter(v => v !== undefined && v !== null);
      const allMatch = validVals.length >= 2 && validVals.every(v => v === validVals[0]);
      const hasAnyDiff = validVals.length >= 2 && !allMatch;

      const fmtVal = v => (v !== undefined && v !== null) ? v + 'm' : '-';
      const diffCell = (val, ref) => {
        if (val === undefined || val === null || ref === undefined || ref === null) return '';
        return val !== ref ? ' diff-cell' : '';
      };

      html += '<tr>';
      html += `<td class="type-cell">${escapeHtml(row.displayName)}</td>`;
      html += `<td class="num-cell">${fmtVal(tv)}</td>`;
      html += `<td class="num-cell${diffCell(fv, tv)}">${fmtVal(fv)}</td>`;
      html += `<td class="num-cell${diffCell(dv, tv)}">${fmtVal(dv)}</td>`;
      if (hasRough) html += `<td class="num-cell${diffCell(rv, tv)}">${fmtVal(rv)}</td>`;

      if (allMatch) {
        html += `<td class="status-cell"><span class="match-badge">一致</span></td>`;
      } else if (hasAnyDiff) {
        const diffs = [];
        const diffPair = (label, a, b) => {
          if (a !== undefined && b !== undefined && a !== b) {
            diffs.push(`${label} ${b - a > 0 ? '+' : ''}${Math.round((b - a) * 10) / 10}m`);
          }
        };
        diffPair('①②差', tv, fv);
        diffPair('①③差', tv, dv);
        if (hasRough) diffPair('①④差', tv, rv);
        if (diffs.length === 0) {
          diffPair('②③差', fv, dv);
          if (hasRough) diffPair('②④差', fv, rv);
        }
        html += `<td class="status-cell"><span class="diff-badge">${escapeHtml(diffs[0] || '差異あり')}</span>`;
        if (diffs.length > 1) {
          html += `<span class="diff-sub">${escapeHtml(diffs.slice(1).join(' / '))}</span>`;
        }
        // 共入れ由来の差異ヒント（配管のみ、旗上げ>統括表 かつ 複数ケーブルで共入れパターン該当時）
        if (isLikelySharingOvercount(kind, tv, fv, row.displayName, sharingAnalysis)) {
          html += `<span class="diff-hint-sharing">&#128279; 共入れ重複の可能性</span>`;
        }
        html += `</td>`;
      } else {
        html += `<td class="status-cell"><span style="color:var(--gray-400);font-size:11px;">データ不足</span></td>`;
      }

      html += '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ─── 旗上げ整合チェック描画 ─────────────────────
  function renderAnnotationsCheck(annotations, tableWire, tableConduit) {
    if (!annotations || annotations.length === 0) {
      els.annotationsContent.innerHTML = '<p class="totals-empty">旗上げデータを読み取れませんでした</p>';
      return;
    }

    // 統括表のMapを作成（normalizeType で正規化キーを使い、表記揺れを吸収）
    const tableWireMap = {};
    if (tableWire) tableWire.forEach(t => { tableWireMap[normalizeType(t.type)] = t.total_length_m; });
    const tableConduitMap = {};
    if (tableConduit) tableConduit.forEach(t => { tableConduitMap[normalizeType(t.type)] = t.total_length_m; });

    // 旗上げをケーブル種別でグループ化（表示名も保持）
    const cableGroups = {};
    const cableDisplayName = {};
    const conduitGroups = {};
    const conduitDisplayName = {};
    annotations.forEach(a => {
      // ケーブル
      if (a.cable_type) {
        const ck = normalizeType(a.cable_type);
        if (!cableGroups[ck]) { cableGroups[ck] = []; cableDisplayName[ck] = a.cable_type; }
        cableGroups[ck].push(a);
      }
      // 配管
      if (a.conduit_type) {
        const dk = normalizeType(a.conduit_type);
        if (!conduitGroups[dk]) { conduitGroups[dk] = []; conduitDisplayName[dk] = a.conduit_type; }
        conduitGroups[dk].push(a);
      }
    });

    let html = '';

    // ケーブル別の旗上げ詳細
    const cableKeys = Object.keys(cableGroups);
    if (cableKeys.length > 0) {
      html += '<h4 class="totals-group-title" style="margin-top:12px;">&#128268; 配線（ケーブル）別 旗上げ一覧</h4>';
      cableKeys.forEach(cableType => {
        const items = cableGroups[cableType];
        const displayName = cableDisplayName[cableType] || cableType;
        const sum = items.reduce((s, a) => s + (a.length_m || 0), 0);
        const roundedSum = Math.round(sum * 10) / 10;
        const tableVal = tableWireMap[cableType];
        const hasDiff = tableVal !== undefined && tableVal !== null && tableVal !== roundedSum;

        html += `<div class="anno-group">`;
        html += `<div class="anno-group-header">`;
        html += `<span class="anno-type">${escapeHtml(displayName)}</span>`;
        html += `<span class="anno-sum ${hasDiff ? 'diff' : 'match'}">`;
        html += `旗上げ合計: <strong>${roundedSum}m</strong>`;
        if (tableVal !== undefined && tableVal !== null) {
          html += ` / 統括表: <strong>${tableVal}m</strong>`;
          if (hasDiff) {
            const diff = Math.round((roundedSum - tableVal) * 10) / 10;
            html += ` <span class="diff-badge">差異 ${diff > 0 ? '+' : ''}${diff}m</span>`;
          } else {
            html += ` <span class="match-badge">一致</span>`;
          }
        }
        html += `</span></div>`;

        html += '<table class="totals-table anno-table"><thead><tr>';
        html += '<th>#</th><th>施工方法</th><th>距離</th><th>配管</th><th>共入れ</th><th>補足</th>';
        html += '</tr></thead><tbody>';
        items.forEach((a, i) => {
          const sharedBadge = (Number(a.shared_conduit_count) || 0) > 1
            ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:0 4px;border-radius:4px;">共入れ${a.shared_conduit_count}</span>`
            : '-';
          html += `<tr>`;
          html += `<td style="color:var(--gray-400);width:30px;">${i + 1}</td>`;
          html += `<td>${escapeHtml(a.method || '-')}</td>`;
          html += `<td class="num-cell"><strong>${a.length_m != null ? a.length_m + 'm' : '-'}</strong></td>`;
          html += `<td>${escapeHtml(a.conduit_type || '-')}</td>`;
          html += `<td>${sharedBadge}</td>`;
          html += `<td style="font-size:11px;color:var(--gray-500);">${escapeHtml(a.note || '')}</td>`;
          html += `</tr>`;
        });
        html += '</tbody></table></div>';
      });
    }

    // 配管別の旗上げ詳細
    const conduitKeys = Object.keys(conduitGroups);
    if (conduitKeys.length > 0) {
      html += '<h4 class="totals-group-title" style="margin-top:20px;">&#128295; 配管別 旗上げ一覧</h4>';
      conduitKeys.forEach(conduitType => {
        const items = conduitGroups[conduitType];
        const displayName = conduitDisplayName[conduitType] || conduitType;
        // 共入れ区間は物理配管長として1回だけカウント（shared_conduit_count で按分）
        const sum = items.reduce((s, a) => {
          const len = a.length_m || 0;
          const shared = Number(a.shared_conduit_count) || 0;
          return s + (shared > 1 ? len / shared : len);
        }, 0);
        const roundedSum = Math.round(sum * 10) / 10;
        const tableVal = tableConduitMap[conduitType];
        const hasDiff = tableVal !== undefined && tableVal !== null && tableVal !== roundedSum;
        const hasShared = items.some(a => (Number(a.shared_conduit_count) || 0) > 1);

        html += `<div class="anno-group">`;
        html += `<div class="anno-group-header">`;
        html += `<span class="anno-type">${escapeHtml(displayName)}`;
        if (hasShared) html += ` <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;margin-left:4px;">共入れあり</span>`;
        html += `</span>`;
        html += `<span class="anno-sum ${hasDiff ? 'diff' : 'match'}">`;
        html += `旗上げ合計（物理長）: <strong>${roundedSum}m</strong>`;
        if (tableVal !== undefined && tableVal !== null) {
          html += ` / 統括表: <strong>${tableVal}m</strong>`;
          if (hasDiff) {
            const diff = Math.round((roundedSum - tableVal) * 10) / 10;
            html += ` <span class="diff-badge">差異 ${diff > 0 ? '+' : ''}${diff}m</span>`;
          } else {
            html += ` <span class="match-badge">一致</span>`;
          }
        }
        html += `</span></div>`;

        html += '<table class="totals-table anno-table"><thead><tr>';
        html += '<th>#</th><th>施工方法</th><th>距離</th><th>ケーブル</th><th>共入れ</th><th>補足</th>';
        html += '</tr></thead><tbody>';
        items.forEach((a, i) => {
          const sharedBadge = (Number(a.shared_conduit_count) || 0) > 1
            ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:0 4px;border-radius:4px;">共入れ${a.shared_conduit_count}</span>`
            : '-';
          html += `<tr>`;
          html += `<td style="color:var(--gray-400);width:30px;">${i + 1}</td>`;
          html += `<td>${escapeHtml(a.method || '-')}</td>`;
          html += `<td class="num-cell"><strong>${a.length_m != null ? a.length_m + 'm' : '-'}</strong></td>`;
          html += `<td>${escapeHtml(a.cable_type || '-')}</td>`;
          html += `<td>${sharedBadge}</td>`;
          html += `<td style="font-size:11px;color:var(--gray-500);">${escapeHtml(a.note || '')}</td>`;
          html += `</tr>`;
        });
        html += '</tbody></table></div>';
      });
    }

    els.annotationsContent.innerHTML = html;
  }

  // ─── 読み取り情報 ─────────────────────────────
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
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ─── OS 判定（キャッシュクリア手順のショートカット出し分け用）─
  // 【設計契約】
  //   Mac と Windows/Linux で修飾キーが異なるため判定する。
  //   judgeは2択のみ（Mac or その他）。Linux は Ctrl キーが共通なので Windows 扱いで十分。
  //   navigator.userAgent / navigator.platform は偽装可能だが、キャッシュクリア案内が
  //   間違うだけで実害はないため「best effort」で良い。
  function detectOS() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();
    if (/mac|iphone|ipad|ipod/.test(platform) || /mac os x|macintosh/.test(ua)) return 'mac';
    return 'windows'; // Linux も含む（Ctrl キー共通のため）
  }

  // ─── キャッシュクリア手順ガイド（エラーカード内の展開セクション）─
  // 【設計意図】
  //   Gemini API の一時的エラー（server_overload / quota_exceeded）は、ブラウザ側の
  //   HTTP/2 コネクション状態・メモリ圧迫・キャッシュ汚染が原因のことがある。
  //   JS からは HTTP/2 コネクションプールや HTTP キャッシュを完全にはリセットできないため、
  //   ユーザーに本物のブラウザ操作を案内する方式を採る。自動リトライが尽きた後の
  //   「次の一手」として機能する。
  //
  // 【段階設計】
  //   1. ハード再読込（Ctrl/⌘ + Shift + R）     — 最も軽量、ページ資源のみ再取得
  //   2. 閲覧履歴削除（Ctrl/⌘ + Shift + Delete） — キャッシュ本体のクリア
  //   3. ブラウザ完全再起動                       — HTTP/2 コネクション・メモリまで完全リセット
  //   軽い順に試せば、無駄な作業消失を避けつつ段階的に強度を上げられる。
  //
  // 【ユーザーデータ保護】
  //   API キーは localStorage 保存済みの場合は全リセット後も保持される旨を注記。
  //   未保存の場合の再入力を意識させるための注意書きを末尾に置く。
  function renderResetGuide() {
    const os = detectOS();
    const isMac = os === 'mac';
    const modKey = isMac ? '&#8984;' : 'Ctrl';       // ⌘ or Ctrl
    const osLabel = isMac ? 'Mac' : 'Windows / Linux';
    return `
      <details class="reset-guide">
        <summary class="reset-guide-summary">
          &#128259; サーバーエラーが続く場合の対処法（ブラウザキャッシュクリア手順）
        </summary>
        <div class="reset-guide-body">
          <p class="reset-guide-desc">
            ブラウザのキャッシュや接続状態が原因でエラーが続く場合、以下の手順で解消することがあります。
            <strong>${osLabel}</strong> をお使いのため、下記のショートカットでお試しください（軽い順）。
          </p>
          <ol class="reset-guide-steps">
            <li>
              <strong>軽いリセット — ハード再読込</strong><br>
              <kbd>${modKey}</kbd> <span class="reset-guide-plus">+</span> <kbd>Shift</kbd> <span class="reset-guide-plus">+</span> <kbd>R</kbd>
              <span class="reset-guide-note">ページとスクリプトをサーバーから再取得します（最も軽い操作・作業データは保持）。</span>
            </li>
            <li>
              <strong>強めのリセット — 閲覧履歴の削除</strong><br>
              <kbd>${modKey}</kbd> <span class="reset-guide-plus">+</span> <kbd>Shift</kbd> <span class="reset-guide-plus">+</span> <kbd>Delete</kbd>
              <span class="reset-guide-note">表示されるダイアログで「キャッシュされた画像とファイル」のみチェックし削除 → 本ページを再読込。</span>
            </li>
            <li>
              <strong>最強 — ブラウザの完全再起動</strong><br>
              全てのタブを閉じてブラウザを終了 → 再度起動してこのページを開く
              <span class="reset-guide-note">HTTP 接続状態・メモリまで完全にリセットされます。上記2つで解消しない場合に有効。</span>
            </li>
          </ol>
          <p class="reset-guide-footnote">
            ※ 「このブラウザに保存する」にチェックを入れて API キーを保存している場合、キーは全手順後も保持されます。未保存の場合は再入力が必要です。
          </p>
        </div>
      </details>
    `;
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

  // ─── Excelダウンロード ─────────────────────────
  function exportExcel() {
    if (!lastResult || typeof XLSX === 'undefined') return;

    const wb = XLSX.utils.book_new();
    const result = lastResult;
    const typeLabel = state.selectedType === 'kiso' ? '基礎充電' : '目的地充電';
    const modelInfo = DrawingChecker.MODELS.find(m => m.id === state.selectedModel);
    const modelLabel = modelInfo ? modelInfo.name : state.selectedModel;
    const overallLabel = v => v === 'pass' ? '合格' : v === 'warn' ? '要確認' : '不合格';
    const statusLabel = s => s === 'pass' ? 'OK' : s === 'fail' ? 'NG' : '要確認';

    // ===== シート1: 判定結果 =====
    const s1 = [];
    s1.push(['NeV 配線ルート図 要件判定結果']);
    s1.push(['図面タイプ', typeLabel, '使用モデル', modelLabel, '解析ページ数', result.analyzedPages]);
    s1.push([]);

    // 読み取り情報（renderDetectedInfo と同じフィールドを使用）
    if (result.detectedInfo) {
      s1.push(['【読み取り情報】']);
      const di = result.detectedInfo;
      const diFields = [
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
      diFields.forEach(f => {
        const val = di[f.key];
        if (val && String(val).trim() !== '') s1.push([f.label, String(val)]);
      });
      s1.push([]);
    }

    // NeV判定
    s1.push(['【NeV要件判定】', overallLabel(result.nev.overall)]);
    s1.push(['合格', result.nev.totalPass + '/' + result.nev.totalItems + '項目', '必須', result.nev.requiredPass + '/' + result.nev.requiredTotal]);
    s1.push([]);
    s1.push(['判定', '必須', 'カテゴリ', 'チェック項目', '検出内容', '詳細']);
    result.nev.items.forEach(item => {
      s1.push([statusLabel(item.status), item.required ? '必須' : '任意', item.category, item.label, item.found_text || '', item.detail || '']);
    });
    s1.push([]);

    // マニュアル判定
    s1.push(['【作図センターマニュアル判定】', overallLabel(result.manual.overall)]);
    s1.push(['合格', result.manual.totalPass + '/' + result.manual.totalItems + '項目', '必須', result.manual.requiredPass + '/' + result.manual.requiredTotal]);
    s1.push([]);
    s1.push(['判定', '必須', 'カテゴリ', 'チェック項目', '検出内容', '詳細']);
    result.manual.items.forEach(item => {
      s1.push([statusLabel(item.status), item.required ? '必須' : '任意', item.category, item.label, item.found_text || '', item.detail || '']);
    });
    s1.push([]);

    // AIコメント
    if (result.overallComment) {
      s1.push(['【AI総合コメント】']);
      s1.push([result.overallComment]);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 40 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws1, '判定結果');

    // ===== シート2: 配線・配管比較 =====
    const s2 = [];

    // 比較テーブル生成ヘルパー（セクションごとにラフ図有無を判定）
    const buildCompareSection = (title, tableData, countedData, drawnData, roughData) => {
      const hasR = roughData && roughData.length > 0;
      const sectionHeaders = ['種別', '①統括表', '②旗上げ合計', '③記載線長'];
      if (hasR) sectionHeaders.push('④ラフ図');
      sectionHeaders.push('判定');

      s2.push([title]);
      s2.push(sectionHeaders);

      const toNum = v => (v === undefined || v === null || v === '') ? undefined : Number(v);
      const merged = {};
      const addSrc = (data, field) => {
        if (!data) return;
        data.forEach(t => {
          const key = normalizeType(t.type);
          if (!key) return;
          if (!merged[key]) merged[key] = { displayName: t.type };
          merged[key][field] = toNum(t.total_length_m);
          if (t.type.length > merged[key].displayName.length) merged[key].displayName = t.type;
        });
      };
      addSrc(tableData, 'table');
      addSrc(countedData, 'counted');
      addSrc(drawnData, 'drawn');
      if (hasR) addSrc(roughData, 'rough');

      // ファジーマッチング: 辞書補正で漏れた1文字違いキーを統合
      fuzzyMergeKeys(merged);

      Object.keys(merged).forEach(key => {
        const r = merged[key];
        const tv = r.table, fv = r.counted, dv = r.drawn, rv = hasR ? r.rough : undefined;
        const vals = [tv, fv, dv];
        if (hasR) vals.push(rv);
        const valid = vals.filter(v => v !== undefined && v !== null);
        const allMatch = valid.length >= 2 && valid.every(v => v === valid[0]);

        let status = '';
        if (allMatch) status = '一致';
        else if (valid.length >= 2) status = '差異あり';
        else status = 'データ不足';

        const row = [r.displayName, tv != null ? tv : '', fv != null ? fv : '', dv != null ? dv : ''];
        if (hasR) row.push(rv != null ? rv : '');
        row.push(status);
        s2.push(row);
      });
    };

    buildCompareSection('【配線（ケーブル）比較】', result.tableWireTotals, result.countedWireTotals, result.drawnWireLengths, state.roughWireData);
    s2.push([]);
    buildCompareSection('【配管 比較】', result.tableConduitTotals, result.countedConduitTotals, result.drawnConduitLengths, state.roughConduitData);

    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, '配線・配管比較');

    // ===== シート3: 旗上げ詳細 =====
    if (result.flaggedAnnotations && result.flaggedAnnotations.length > 0) {
      const s3 = [];
      s3.push(['【旗上げ詳細一覧】']);
      s3.push(['ケーブル種別', '施工方法', '距離(m)', '配管種別', '共入れ', '補足']);
      result.flaggedAnnotations.forEach(a => {
        const sharedLabel = (Number(a.shared_conduit_count) || 0) > 1 ? `共入れ${a.shared_conduit_count}` : '';
        s3.push([a.cable_type || a.conduit_type || '-', a.method || '-', a.length_m != null ? a.length_m : '', a.conduit_type || '-', sharedLabel, a.note || '']);
      });

      const ws3 = XLSX.utils.aoa_to_sheet(s3);
      ws3['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws3, '旗上げ詳細');
    }

    // ダウンロード
    const fileName = `配線ルート図_判定結果_${typeLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);

    els.exportExcelBtn.textContent = 'ダウンロード完了!';
    setTimeout(() => { els.exportExcelBtn.innerHTML = '&#128229; Excelでダウンロード'; }, 2000);
  }

  // ─── 再チェック ───────────────────────────────
  function resetForRecheck() {
    lastResult = null;
    els.resultSection.style.display = 'none';
    removeFile();
    removeRoughFile();
    if (els.roughUploadSection) els.roughUploadSection.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── 起動 ─────────────────────────────────────
  init();

});
