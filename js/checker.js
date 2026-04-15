/* ============================================================
   checker.js — Gemini API を使った配線ルート図の要件チェック
   NeV補助金（次世代自動車充電インフラ整備促進事業）5-9-3 配線ルート図
   正解事例 44件の分析に基づく高精度チェックロジック
   機能: NeV要件判定 / 作図センターマニュアル判定 / 配線・配管集計
   ============================================================ */

const DrawingChecker = (() => {

  // ─── NeV チェック項目定義 ─────────────────────────
  const COMMON_CHECKS = [
    // ── 表題欄 ──
    { id: 'setting_place', category: 'title_block', label: '設置場所名称の記載',
      description: '表題欄の「設置場所」欄に、申請で入力した設置場所名称（略称不可）が記載されているか', required: true },
    { id: 'drawing_name', category: 'title_block', label: '図面名称「配線ルート図」の記載',
      description: '表題欄に「配線ルート図」と記載されているか。複数ページ時は「配線ルート図1」「配線ルート図2」も可。不備例：「配線図」「電気配線図」「ルート図」等は不可', required: true },
    { id: 'project_name', category: 'title_block', label: '工事名の記載',
      description: '表題欄に工事名が記載されているか。正解例：「充電設備設置工事」「普通充電設備設置工事」等', required: true },
    { id: 'creator', category: 'title_block', label: '作成者の記載',
      description: '表題欄の「作成者」欄に会社名または個人名が記載されているか', required: true },
    { id: 'scale', category: 'title_block', label: '縮尺の記載',
      description: '表題欄の「縮尺」欄に縮尺が記載されているか。正解例：A3:1/100、1/150 等', required: true },
    { id: 'creation_date', category: 'title_block', label: '作成日の記載',
      description: '表題欄に日付が記載されているか（YYYY年MM月DD日 形式等）', required: true },

    // ── 配線情報 ──
    { id: 'wire_type', category: 'wiring_info', label: '電線の種類・サイズの記載',
      description: '使用する電線の種類とサイズが記載されているか。正解例：CV5.5-3C、CV5sq-3C、CVT100sq 等', required: true },
    { id: 'total_length', category: 'wiring_info', label: '配線全長の記載',
      description: '配線の全長が記載されているか。配線集計表に全長として記載されることが多い', required: true },
    { id: 'length_breakdown', category: 'wiring_info', label: '配線内訳（露出/管内/埋設等）の記載',
      description: '配線全長の内訳が配線方法別に記載されているか。正解例：「内訳 露出 10.7m」「管内 金属製 E25 4.4m」「合成樹脂 埋設 FEP30 2.0m」等', required: true },
    { id: 'section_details', category: 'wiring_info', label: '各区間の配線詳細の記載',
      description: '配線ルート上の各区間ごとに、電線種類・配管種類・距離が記載されているか', required: true },

    // ── 配線方法・配管 ──
    { id: 'wiring_method', category: 'wiring_method', label: '配線方法（架空/露出/埋設）の記載',
      description: '各区間の配線方法が明確に記載されているか。架空・露出・埋設の区別', required: true },
    { id: 'conduit_spec', category: 'wiring_method', label: '配管の種類・サイズの記載',
      description: '使用する配管の種類とサイズが記載されているか。正解例：PFD-28、VE-22、FEP-30、HIVE-42 等', required: true },
    { id: 'conduit_material', category: 'wiring_method', label: '配管材質の記載（金属製/合成樹脂）',
      description: '配管の材質区分が記載されているか。正解例：「金属製 G28」「合成樹脂 FEP30」等', required: true },

    // ── 設備配置・寸法 ──
    { id: 'equipment_position', category: 'layout', label: 'EV充電設備の配置位置',
      description: 'EV充電設備の配置が図面上に示されているか', required: true },
    { id: 'power_source', category: 'layout', label: '電源元（受電盤/分電盤/キュービクル等）の記載',
      description: '配線の起点となる電源元が記載されているか', required: true },
    { id: 'wiring_route_line', category: 'layout', label: '配線ルートの線表示',
      description: '配線ルートが図面上に線で図示されているか。電源元から各充電設備までの経路が確認できるか', required: true },
    { id: 'dimension_lines', category: 'layout', label: '位置関係がわかる寸法の記載',
      description: '配線ルート上の各区間の距離（m単位）が記載されているか', required: true },
    { id: 'compass', category: 'layout', label: '方位記号（N）の記載',
      description: '方位記号（北を示すN矢印）が図面上に記載されているか（任意項目）', required: false },
    { id: 'surface_material', category: 'layout', label: '路面状況の記載',
      description: '掘削工事（埋設配管）がある場合のみ必須。配線ルートに埋設区間がある場合、路面を構成する材質（アスファルト、コンクリート、土等）が記載されているか確認する。露出配管のみの場合はパス（pass）とする', required: false },

    // ── 付帯設備 ──
    { id: 'rise_info', category: 'ancillary', label: '立上げ・掘削の長さの記載',
      description: '立上げや掘削がある場合、その長さが記載されているか。該当工事がない場合はパス', required: false },
    { id: 'hand_hole', category: 'ancillary', label: 'ハンドホールの記載',
      description: 'ハンドホールがある場合、設置位置と仕様が記載されているか。該当がない場合はパス', required: false },
    { id: 'pole_info', category: 'ancillary', label: '支柱の記載',
      description: '支柱を設置する場合、位置が記載されているか。該当がない場合はパス', required: false },
  ];

  const KISO_CHECKS = [
    { id: 'building_name', category: 'kiso_specific', label: '建物名称の表示',
      description: 'マンション・団地等の建物名称が図面上に表示されているか', required: true },
    { id: 'surrounding_structures', category: 'kiso_specific', label: '周辺構造物の記載',
      description: '建物、駐車場、駐輪場、フェンス、道路、植栽等の周辺構造物が記載されているか', required: true },
    { id: 'utility_work_boundary', category: 'kiso_specific', label: '電力会社工事区間の明示',
      description: '電力会社工事区間がある場合、範囲が明示されているか。該当がない場合はパス', required: false },
    { id: 'power_meter_kiso', category: 'kiso_specific', label: '電力量計の記載',
      description: '新設電力量計がある場合、設置位置が記載されているか。該当がない場合はパス', required: false },
  ];

  const MOKUTEKICHI_CHECKS = [
    { id: 'pull_box', category: 'mokutekichi_specific', label: 'プルボックスの記載',
      description: 'プルボックスがある場合、設置位置と仕様が記載されているか。該当がない場合はパス', required: false },
    { id: 'power_meter_mokutekichi', category: 'mokutekichi_specific', label: '電力量計の記載',
      description: '新設電力量計がある場合、設置位置が記載されているか。該当がない場合はパス', required: false },
    { id: 'switch_pole', category: 'mokutekichi_specific', label: '開閉器ポール/分岐盤の記載',
      description: '開閉器ポールや分岐盤がある場合、位置が記載されているか。該当がない場合はパス', required: false },
    { id: 'existing_route', category: 'mokutekichi_specific', label: '既設充電設備の配線ルート（該当する場合）',
      description: '既設充電設備がある場合、既設の位置と配線ルートが記載されているか', required: false },
    { id: 'new_existing_distinction', category: 'mokutekichi_specific', label: '新設/既設の区別',
      description: '新設と既設の充電設備・配線ルートが区別されているか。色分けまたはページ分離。既設がない場合はパス', required: false },
  ];

  // ─── 作図センターマニュアル チェック項目 ────────────
  const MANUAL_CHECKS = [
    // ── 配線集計表 ──
    { id: 'mc_summary_table', category: 'manual_summary', label: '配線集計表（統括表）の存在',
      description: '図面内に配線集計表（統括表）が表形式で記載されているか。ケーブル種別ごとに全長・内訳（露出/管内/埋設）・配管種別が記載された表', required: true },
    { id: 'mc_summary_order', category: 'manual_summary', label: '統括表の記載順序',
      description: '統括表の記載が[種別用途][配管種類・口径]の順で、露出配管接続→露出配管→埋設配管の順序になっているか。配管はPFD→HIVE→FEP等の順', required: true },
    { id: 'mc_summary_cable_breakdown', category: 'manual_summary', label: 'ケーブル種別ごとの全長・内訳',
      description: '各ケーブル種別（CVT○sq、CV○sq-3C等）について、全長と配線方法別内訳（露出/管内/埋設）の長さ(m)が記載されているか', required: true },

    // ── 配線注記 ──
    { id: 'mc_annotation_format', category: 'manual_annotation', label: '配線注記の4要素記載',
      description: '各区間の配線注記に「ケーブル種別」「配線方法」「管種-管径」「距離(m)」の4要素が全て記載されているか。正解例：「CVT8sq-3C 露出配管 PFD-36 13m」', required: true },
    { id: 'mc_cable_conduit_match', category: 'manual_annotation', label: 'ケーブルと配管サイズの整合性',
      description: 'ケーブル種別に対して適切な配管サイズが使用されているか。仕様書準拠：CVT8sq-3C→PFD-28/HIVE-28、CVT22sq→PFD-28、CVT38sq→PFD-36等', required: true },
    { id: 'mc_length_unit', category: 'manual_annotation', label: '距離の単位表記(m)',
      description: '全ての配線距離がm（メートル）単位で統一されているか。mm/cmの混在がないか', required: true },

    // ── 埋設関連 ──
    { id: 'mc_burial_hatching', category: 'manual_burial', label: '埋設ハッチング色の適合性',
      description: '埋設区間がある場合、ハッチング色が適切か。アスファルト/コンクリート=赤色ハッチング、土/砂利=緑色ハッチング。該当がない場合はパス', required: false },
    { id: 'mc_burial_conduit_type', category: 'manual_burial', label: '埋設配管種別の適合性',
      description: '埋設配管にFEP管またはPFD管が使用されているか。該当がない場合はパス', required: false },
    { id: 'mc_burial_dimension', category: 'manual_burial', label: '埋設寸法（幅×深さ）の記載',
      description: '埋設区間がある場合、埋設寸法（幅400mm×深さ400mm、または幅200mm×深さ200mm）が記載されているか。該当がない場合はパス', required: false },

    // ── プルボックス ──
    { id: 'mc_pullbox_dimension', category: 'manual_pullbox', label: 'プルボックス寸法表記(W×H×D)',
      description: 'プルボックスがある場合、W×H×D(mm)の3数値で寸法が記載されているか。正解例：200×200×100、250×250×100、300×300×150等。該当がない場合はパス', required: false },
    { id: 'mc_pullbox_placement', category: 'manual_pullbox', label: 'プルボックス設置基準の準拠',
      description: 'プルボックスが設置基準に準拠しているか：①3つ目の曲がりに設置、②垂直6m毎・水平30m毎、③分岐点で配管径が変わる箇所。該当がない場合はパス', required: false },
    { id: 'mc_pullbox_size_spec', category: 'manual_pullbox', label: 'プルボックスサイズの仕様書準拠',
      description: 'プルボックスのサイズが仕様書に準拠しているか。PFD/HIVE28→200×200×100、36→200×200×100、42→250×250×100、54→250×250×100、HIVE70→300×300×200等。該当がない場合はパス', required: false },

    // ── ケーブルプロテクター ──
    { id: 'mc_cable_protector', category: 'manual_protector', label: 'ケーブルプロテクターの表記',
      description: 'ケーブルプロテクターがある場合、オレンジ色ハッチングで表示されているか。CP2-60X3MBK基準。該当がない場合はパス', required: false },

    // ── 表記規則 ──
    { id: 'mc_new_existing_prefix', category: 'manual_notation', label: '新設/既設の明確なプレフィックス表記',
      description: '全ての設備ラベルに「新設」または「既設」のプレフィックスが付いているか。例：「新設プルボックス」「既設分電盤」「新設EV充電設備」等', required: true },
    { id: 'mc_color_coding', category: 'manual_notation', label: '配線ルートの色分けルール',
      description: '配線ルートの色分けがマニュアル準拠か。新設配線=赤色線、既設配線=青色線、電力会社工事=緑線等の区分', required: true },
    { id: 'mc_vvf_exposure', category: 'manual_notation', label: 'VVF外部露出配線の禁止',
      description: 'VVF2mm-2CまたはVVF2mm-3Cが外部（屋外）において露出配線（管なし）で使用されていないか。VVFは屋外では必ず管内配線とする。VVFが使用されていない場合はパス', required: false },
    { id: 'mc_cable_excess_length', category: 'manual_notation', label: 'ケーブル余長の考慮',
      description: '立上げ箇所でケーブル余長が適切に考慮されているか。仕様書：H=6000→4m、H=7000→5m、H=8000→6m、H=9000→7m。該当がない場合はパス', required: false },
  ];

  // ─── カテゴリ定義 ─────────────────────────────────
  const CATEGORIES = {
    // NeV要件判定カテゴリ
    title_block:            { title: '(1)表題欄（図面基本情報）',      icon: '&#128203;', order: 1, group: 'nev' },
    wiring_info:            { title: '(2)配線情報（電線・全長・内訳）', icon: '&#128268;', order: 2, group: 'nev' },
    wiring_method:          { title: '(3)配線方法・配管',              icon: '&#128295;', order: 3, group: 'nev' },
    layout:                 { title: '(4)設備配置・寸法・路面',         icon: '&#128207;', order: 4, group: 'nev' },
    ancillary:              { title: '(5)付帯設備（立上げ・HH・支柱）', icon: '&#128736;', order: 5, group: 'nev' },
    kiso_specific:          { title: '(6)基礎充電 固有項目',           icon: '&#127970;', order: 6, group: 'nev' },
    mokutekichi_specific:   { title: '(6)目的地充電 固有項目',         icon: '&#127978;', order: 6, group: 'nev' },
    // 作図センターマニュアル判定カテゴリ
    manual_summary:         { title: '(A)配線集計表（統括表）',        icon: '&#128202;', order: 10, group: 'manual' },
    manual_annotation:      { title: '(B)配線注記フォーマット',        icon: '&#128221;', order: 11, group: 'manual' },
    manual_burial:          { title: '(C)埋設関連',                   icon: '&#9939;',   order: 12, group: 'manual' },
    manual_pullbox:         { title: '(D)プルボックス',               icon: '&#128230;', order: 13, group: 'manual' },
    manual_protector:       { title: '(E)ケーブルプロテクター',        icon: '&#128737;', order: 14, group: 'manual' },
    manual_notation:        { title: '(F)表記規則',                   icon: '&#128196;', order: 15, group: 'manual' },
  };

  // ─── Gemini プロンプト生成（2パス方式）──────────────
  // Pass 1: データ読み取り特化 / Pass 2: NeV・マニュアル判定特化

  // NOTE: 旧 buildPrompt() は2パス化に伴い buildPass1Prompt / buildPass2Prompt に分離・削除済み
  //
  // ─── プロンプト設計ノート（エラーチェック時の確認ポイント） ─────
  // Pass1 プロンプトには以下の解釈ルールが含まれる（回帰テスト対象）：
  //   ・「(Xm×N)」表記ルール: 「合計m (Xm×N)」形式は合計値、「(Xm×N)」単独は X×N で計算
  //   ・統括表レイアウトA/B/Cの判別手順（列ヘッダー優先）
  //   ・JSONスキーマ: table_wire_totals / table_conduit_totals / counted_* / drawn_* / flagged_annotations
  // これらを書き換える場合、detectDiscrepancies の警告パターンが
  // 変化しないか（特に missing_in_* の誤検出が増えないか）を必ず確認すること。
  // ─── Pass 1 プロンプト（データ読み取り特化）───────────
  function buildPass1Prompt(type) {
    const typeLabel = type === 'kiso'
      ? '基礎充電（マンション・集合住宅向け）'
      : '目的地充電（商業施設・ホテル・ゴルフ場等向け）';

    return `あなたはEV充電設備の「配線ルート図」データ読み取りのエキスパートです。
アップロードされたPDFの全ページを隅々まで確認し、配線・配管データを高精度で読み取ってください。
**このパスではデータの正確な読み取りのみに集中してください。要件の合否判定は行いません。**

## 図面タイプ: ${typeLabel}

## 【作業1】図面基本情報の読み取り (detected_info)
表題欄および図面全体から以下を読み取ってください（見つからない項目は空文字）：
施設名（設置場所名称）、図面名称（「配線ルート図」等）、工事名、作成者（会社名または個人名）、縮尺、作成日、電線種類（使用されている全ケーブル種別）、配線全長、配線内訳の要約、配線方法一覧（露出/埋設/架空等）、配管種類一覧、電源元（受電盤/分電盤/キュービクル等）、EV充電設備台数、路面状況（アスファルト/コンクリート/土等）、付帯設備（プルボックス/ハンドホール/支柱等）、既設設備情報

## 【作業2】統括表（配線集計表）の記載値の読み取り
図面内の統括表（配線集計表）から数値をそのまま読み取ってください。統括表がない場合は空配列 []。

**統括表の読み取り手順（必ず従ってください）：**
1. まず**列ヘッダー（見出し行）**を確認し、各列が何を表すか特定する
2. 各ケーブル種別の行を**1行ずつ**読み取る
3. 各行の「配線長」（=ケーブルの全長）の数値を正確に読み取る（桁数に注意: 15m と 150m、2m と 20m 等の誤読に注意）
4. 同じ行の「内訳」（露出/管内/埋設等）の数値も全て読み取る
5. **検証**: 配線長 = 内訳の合計 になるか確認。一致しない場合は再確認し修正

6. **統括表のレイアウトパターン（重要）:**
   統括表には複数のレイアウトが存在します。**必ず列ヘッダーで判断**してください。

   **パターンA（シンプル型）:**
   | ケーブル種別 | 全長 | 内訳（露出/管内/埋設…） |
   → 「全長」列 = 配線長（ケーブルの全長）

   **パターンB（配管長・配線長 分離型）:**
   | 配線種 | 種別用途 | 配管種 | **配管長** | **配線長** | 内訳… |
   → 「**配線長**」列 = ケーブルの全長（table_wire_totals に使う）
   → 「**配管長**」列 = 配管の長さ（table_conduit_totals に使う）
   → **配管長 ≠ 配線長** のケースが多いので、絶対に混同しないこと

   **よくある誤読**: 配管長の列を配線長と間違えて読んでしまう。
   例: CV22sq-2C の行で 配管長=69m、配線長=88m の場合、table_wire_totals には **88m** を記載すべき。
   69m を記載するのは誤り（これは配管長であり配線長ではない）。

7. 別のケーブル種別の数値を混同しないよう、行単位で慎重に読み取る

**共入れ（共通配管）の読み取り — 統括表:**
- **共入れN**: 1本の配管にN本のケーブルを通す設計。例:「PFD-36（共入れ2）」
- **※印**: 複数ケーブル行に同じ※番号がある場合、同一の物理配管を共有
- **配管合計の算出**: table_conduit_totals には**物理配管の実長**を記載。※印で共有が示されている配管は重複カウントしない。パターンBの統括表では「配管長」列の値を使う
- **ケーブル合計の算出**: table_wire_totals には各ケーブル種別の「配線長」（全長）をそのまま記載。**配管長の値を誤って使わないこと**

## 【作業3】旗上げ（各区間の注記）の全件読み取り
配線ルート上のテキスト注記（「旗上げ」）を**1つ残らず全て**読み取ってください。
**注記の文字色は複数あります**：新設区間は緑色や赤色、既設区間は青色で記載されます。**色に関係なく全ての旗上げを読み取ってください。**

例（新設区間 — 緑色テキスト）：
- 「CV8sq-3C  露出 横引き  13m」
- 「CV8sq-3C  露出 立上げ  3m」
- 「E31  露出 横引き  13m」
- 「CVT22sq  露出配管 PFD-28  5m」
- 「CV22sq-2C+IV5.5sq  露出  既設キュービクル内配線・余長  6m」
- 「CV22sq-2C+IV5.5sq  露出配管  PFD-36  30m」

例（既設区間 — 青色テキスト）：
- 「CVT38sq  埋設配管  FEP-30（既設）  15m」
- 「CVT22sq  既設埋設  FEP-40  10m」
- 「CV8sq-3C  既設配管  FEP-30  8m」

各旗上げについて以下を読み取ってください：
1. **ケーブル種別**: CV8sq-3C、CVT22sq 等
2. **配管種別**: E31、PFD-28 等（記載がある場合）
3. **施工方法**: 露出/埋設/架空 + 横引き/立上げ/立下げ/EV充電設備用分電盤内部配線 等
4. **距離**: Xm（数値）

**「+」結合表記の解析（非常に重要）:**
ケーブル種別が「CV22sq-2C+IV5.5sq」のように「+」で結合されている場合：
- **複数のケーブル種別が同一経路・同一配管を並走**している
- flagged_annotations にはケーブル種別ごとに**別々の行**として記録する
- **shared_conduit_count の設定（必須）**: 「+」で結合されたケーブル種別数を設定。例:
  - 「CV22sq-2C+IV5.5sq PFD-28 5m」→ 2種類 → 各エントリの shared_conduit_count = **2**
  - 「A+B+C PFD-36 10m」→ 3種類 → 各エントリの shared_conduit_count = **3**
- これにより配管の物理長が正しく算出される（5m÷2 + 5m÷2 = 5m）

**「Xm (Ym×N)」/「(Ym×N本)」表記の解析（非常に重要 — 誤解釈多発）:**
括弧内の「Ym×N」は「1本あたり Ym × N本並列 = 合計 Y×N m」を意味します。
**判別ルール（先頭の Xm の有無で判定）:**

**パターン①: 「Xm (Ym×N)」形式 — Xm が明記されている場合**
→ Xm が既に合計値なので **length_m = X**（Ym ではない）
- 「CV8sq-3C PFD-36 22m (11m×2)」→ length_m = **22**、shared_conduit_count = 2
- 「CV8sq-3C 露出 分電盤内配線・余長 4m (2m×2)」→ length_m = **4**

**パターン②: 「(Ym×N)」または「Ym×N本」のみ — 先頭に Xm がない場合**
→ 合計値が記載されていないので **自分で計算**: length_m = **Y × N**
- 「PFD-28 (3.5m×4)」→ length_m = **14**（3.5 × 4、**3.5 ではない**）
- 「PFD-36 5m×3本」→ length_m = **15**（5 × 3、**5 ではない**）
- 「HIVE-42 (2.5m×6)」→ length_m = **15**（2.5 × 6、**2.5 ではない**）

**どちらのパターンでも必ず守ること:**
- flagged_annotations には **1行だけ** 記録する（Ym の行を別に作成しない）
- shared_conduit_count は **この表記とは別の概念**（「+」結合の並列ケーブル数）なので混同しないこと
- 括弧内の「×N」は立上げ・立下げの本数を示すことが多いので、合計長として扱うのが妥当

**よくある誤り（絶対にしないこと）:**
- ✗ 「(3.5m×4)」を length_m=3.5 として記録（×4 を無視）
- ✗ 「22m (11m×2)」を length_m=44 として記録（×2 を二重適用）
- ✗ 「(3.5m×4)」を 4行に分割して記録（×4本 を別エントリに分割）

**見落としやすい区間タイプ（必ず確認すること）:**
- **既設埋設配管（FEP管等）** — 青色テキストの既設区間。**最も見落とされやすい区間です**
- **既設配管の立上げ・立下げ** — 既設埋設配管から地上に出る垂直区間
- **既設キュービクル内配線・余長** — 電源元のキュービクル内部の配線と余長
- **既設ピット内配線** — 既設のピット（地下通路）内を通る配線
- **プルボックス内配線・余長** — プルボックス間の内部配線と余長
- **EV充電設備用分電盤内配線・余長** — 分電盤内部の配線と余長
- **立上げ・立下げ** — 配管の垂直部分
- **配管端部の短い区間** — プルボックス付近等の短い配管区間
これらの小さな区間を合算すると全体の20〜40%を占めることがあります。

**共入れ（共通配管）の読み取り — 旗上げ:**
- **共入れ区間の特定**: 同一経路に複数ケーブルが並走し、1本の配管を共有している区間
- **ケーブル別に個別カウント**: 各ケーブル種別の距離をそれぞれ個別にカウント
- **配管は物理長で1回カウント**: counted_conduit_totals では共入れ区間の配管を重複加算しない
- **counted_conduit_totals 計算式（厳守）**: flagged_annotations を配管種別でグルーピングし、各エントリの length_m を shared_conduit_count で割った値を合計する（shared_conduit_count が 0 または 1 の場合はそのまま加算）。
  具体例: PFD-36 の flagged_annotations が以下の3行の場合:
    ① cable=CV22sq-2C / conduit=PFD-36 / 30m / shared_conduit_count=2
    ② cable=IV5.5sq  / conduit=PFD-36 / 30m / shared_conduit_count=2
    ③ cable=CV8sq-3C / conduit=PFD-36 / 10m / shared_conduit_count=0
    → PFD-36 = 30÷2 + 30÷2 + 10÷1 = 15 + 15 + 10 = **40m** ← 正解
    ✗ 誤り: 30 + 30 + 10 = 70m（共入れ区間を重複カウントしている）
- **shared_conduit_count**: 共入れでない区間は 0、共入れの場合はケーブル本数（2以上）

旗上げを全て読み取った上で、ケーブル種別・配管種別ごとに合算した値も算出してください。

## 【作業4】記載線長（寸法値）の読み取り
配線ルート線に沿って描かれた**寸法線（引出し線・矢印付きの距離表示）**を読み取り、ケーブル種別・配管種別ごとに合算してください。
寸法線がない場合や旗上げと同一の場合は、旗上げと同じ値を入れてください。
**drawn_conduit_lengths も共入れ区間の配管を重複カウントしないでください。**

### 対象の配線（ケーブル）種別例
CVT8sq、CVT14sq、CVT22sq、CVT38sq、CVT60sq、CVT100sq、CV5.5-3C、CV5sq-3C、CV8sq-3C、CV14sq-3C、CV22sq-3C、CV38sq-3C、CV60sq-3C、CV100sq-3C、VVF2mm-2C、VVF2mm-3C、IV5.5sq 等

### 対象の配管種別例
PFD-16、PFD-22、PFD-28、PFD-36、PFD-42、PFD-54、HIVE-28、HIVE-36、HIVE-42、HIVE-54、FEP-30、FEP-40、FEP-50、FEP-54、VE-22、VE-28、G28、G54、E25、E31、E39、CD-22 等

## 重要
- 旗上げは**1つも漏らさず**全て読み取ってください。読み落としは集計の食い違いの原因になります
- 統括表・旗上げ・記載線長の値が一致しない場合でも、それぞれの数値をそのまま報告してください
- 「EV充電設備用分電盤内部配線」「EV充電設備用分電盤〜配管端部」等の特殊区間も忘れずに読み取ってください
- 統括表の全長が内訳の合計と大きく乖離する場合（2倍以上差がある等）、読み取りミスの可能性が高いため数値を再確認すること
- **よくある読み取りミス**: 隣の行の数値を読んでしまう、桁を間違える（15→150、183→18.3）、複数ケーブルの合計値を1種別の値として読んでしまう

## 回答フォーマット（厳密にこのJSON形式で返してください）
**重要: 回答はJSON以外のテキストを含めず、以下のJSON構造のみを返してください。コードフェンス（\`\`\`json ... \`\`\`）で囲んでも構いません。**

\`\`\`json
{
  "table_wire_totals": [
    { "type": "ケーブル種別（例: CVT22sq）", "total_length_m": 数値 }
  ],
  "table_conduit_totals": [
    { "type": "配管種別（例: PFD-28）", "total_length_m": 数値 }
  ],
  "counted_wire_totals": [
    {
      "type": "ケーブル種別（例: CVT22sq）",
      "total_length_m": 数値,
      "breakdown": {
        "exposed_m": 数値,
        "in_conduit_m": 数値,
        "buried_m": 数値,
        "aerial_m": 数値
      }
    }
  ],
  "counted_conduit_totals": [
    {
      "type": "配管種別（例: PFD-28）",
      "total_length_m": 数値,
      "method": "露出 | 埋設 | 架空"
    }
  ],
  "drawn_wire_lengths": [
    { "type": "ケーブル種別（例: CVT22sq）", "total_length_m": 数値 }
  ],
  "drawn_conduit_lengths": [
    { "type": "配管種別（例: PFD-28）", "total_length_m": 数値 }
  ],
  "flagged_annotations": [
    {
      "cable_type": "ケーブル種別（例: CV8sq-3C）",
      "conduit_type": "配管種別（例: E31）。配管記載がない場合は空文字",
      "method": "施工方法（例: 露出 横引き、露出 立上げ、埋設 横引き 等）",
      "length_m": 数値,
      "shared_conduit_count": 0,
      "note": "補足情報（区間の説明等。なければ空文字）"
    }
  ],
  "detected_info": {
    "facility_name": "施設名",
    "drawing_title": "図面名称",
    "project_name": "工事名",
    "creator": "作成者",
    "scale": "縮尺",
    "creation_date": "作成日",
    "wire_type": "電線種類",
    "total_length": "配線全長",
    "length_breakdown": "配線内訳の要約",
    "wiring_methods": "配線方法一覧",
    "conduit_types": "配管種類一覧",
    "power_source": "電源元",
    "equipment_count": "EV充電設備台数",
    "surface_material": "路面状況",
    "ancillary_equipment": "付帯設備",
    "existing_equipment_info": "既設設備情報",
    "page_count_analyzed": "解析ページ数"
  }
}
\`\`\`

## 自己検証（回答前に必ず実行すること）
1. **旗上げ合計 vs 統括表の照合**: flagged_annotations の length_m をケーブル種別ごとに合算し、table_wire_totals の全長と比較。差異が10%以上ある場合は旗上げの読み直しを行う
   - 旗上げ > 統括表: 「(Xm×N)」表記の二重記録、「+」結合表記の重複がないか確認
   - 旗上げ < 統括表: 内配線・余長、ピット内、立上げ・立下げの読み落としがないか確認
2. **配管合計 vs 統括表の照合**: flagged_annotations の配管種別ごとに length_m÷shared_conduit_count を合計し、table_conduit_totals と比較。特に「+」結合のshared_conduit_countが0のままになっていないか
3. **「+」結合表記の確認**: 分割した全エントリのshared_conduit_countが結合ケーブル数と一致しているか
4. **既設区間の確認**: 統括表にFEP管や「既設」がある場合、旗上げからも既設区間を読み取れているか
5. **区間の網羅性確認**: 電源元からEV充電設備までの全経路が途切れなく繋がっているか`;
  }

  // ─── Pass 2 プロンプト（NeV・マニュアル判定特化）──────
  function buildPass2Prompt(type, pass1Data) {
    const nevChecks = type === 'kiso'
      ? [...COMMON_CHECKS, ...KISO_CHECKS]
      : [...COMMON_CHECKS, ...MOKUTEKICHI_CHECKS];

    const nevCheckListText = nevChecks.map((c, i) =>
      `${i + 1}. [${c.id}] ${c.label}\n   確認内容: ${c.description}\n   必須: ${c.required ? 'はい' : 'いいえ（該当する場合のみ）'}`
    ).join('\n\n');

    const manualCheckListText = MANUAL_CHECKS.map((c, i) =>
      `${i + 1}. [${c.id}] ${c.label}\n   確認内容: ${c.description}\n   必須: ${c.required ? 'はい' : 'いいえ（該当する場合のみ）'}`
    ).join('\n\n');

    const typeLabel = type === 'kiso'
      ? '基礎充電（マンション・集合住宅向け）'
      : '目的地充電（商業施設・ホテル・ゴルフ場等向け）';

    // Pass 1 データの整形（内部メタデータを除外）
    const dataContext = {};
    ['detected_info', 'table_wire_totals', 'table_conduit_totals',
     'counted_wire_totals', 'counted_conduit_totals',
     'drawn_wire_lengths', 'drawn_conduit_lengths', 'flagged_annotations'
    ].forEach(key => { if (pass1Data[key] !== undefined) dataContext[key] = pass1Data[key]; });
    const dataJson = JSON.stringify(dataContext, null, 2);

    return `あなたはNeV補助金の「配線ルート図」審査と作図センターマニュアル準拠チェックのエキスパートです。
前段のPass 1で図面から読み取ったデータと、図面画像の両方を参照しながら、要件チェックを行ってください。
**このパスでは合否判定のみに集中してください。データの再集計は行いません。**

## 図面タイプ: ${typeLabel}

## 【参考データ】Pass 1 読み取り結果
以下のJSONは前段で図面から読み取ったデータです。判定の根拠として活用してください。
不明な点がある場合は、提供された図面画像を直接確認してください。

\`\`\`json
${dataJson}
\`\`\`

## 【Part 1】NeV補助金要件チェック

### 基本要件（5-9-3 配線ルート図）
- 電源元から充電設備間の配線ルート
- 電線の種類（ケーブル型番・サイズ）、配線方法（架空・露出・埋設）
- 配管の仕様（材質・径）、配線の全長と内訳
- 位置関係がわかる寸法、路面材質
- 立上げ・掘削がある場合はその長さ

### 正解事例パターン（44件分析結果）
- 表題欄: 右下枠内に設置場所・図面名称「配線ルート図」・工事名・作成者・縮尺・作成日
- 配線集計表: ケーブル種別ごとに全長→内訳（露出/管内/埋設）→配管種別の表形式
- 配線注記: 「CV5sq-3C 露出配管 PFD-28 13m」形式で各区間に記載
- 色分け: 赤=新設/露出、青=既設/地中、緑=電力会社工事
- プルボックス: 「新設プルボックス 200×200×100」形式
- 方位記号: 右上にN矢印

### NeVチェック項目
${nevCheckListText}

## 【Part 2】作図センターマニュアル判定

作図センター（ミライズエネチェンジ）の以下のマニュアルに基づく準拠チェックです：
- 交付申請図面作成マニュアル
- 交付申請図面における配線配管長の考え方
- 標準設計仕様書Ver4.0

### マニュアル主要ルール
1. **配線集計表**: ケーブル種別→全長→内訳（露出/管内/埋設）→配管種別・口径の順で記載
2. **配線注記**: 「ケーブル種別 配線方法 管種-管径 距離m」の4要素を全区間に記載
3. **ケーブル・配管サイズ対応**: CVT8sq-3C→PFD-28/HIVE-28、CVT22sq→PFD-28、CVT38sq→PFD-36、CVT60sq→PFD-42/HIVE-42、CVT100sq→PFD-54/HIVE-54
4. **埋設ハッチング色**: アスファルト/コンクリート=赤、土/砂利=緑
5. **埋設配管**: FEP管またはPFD管を使用。埋設寸法は幅400mm×深さ400mm or 幅200mm×深さ200mm
6. **プルボックス設置基準**: ①3つ目の曲がりに設置、②垂直6m毎・水平30m毎、③分岐点で配管径変更
7. **プルボックスサイズ**: PFD/HIVE28→200×200×100、36→200×200×100、42→250×250×100、54→250×250×100
8. **ケーブルプロテクター**: オレンジ色ハッチング、大研化成CP2-60X3MBK基準
9. **VVF外部露出禁止**: VVF2mm-2C/3Cは屋外で露出配線（管なし）不可
10. **ケーブル余長**: 立上げH=6000→4m、H=7000→5m、H=8000→6m、H=9000→7m
11. **新設/既設プレフィックス**: 全設備ラベルに「新設」「既設」を付与
12. **色分け**: 新設=赤、既設=青、電力会社工事=緑

### マニュアルチェック項目
${manualCheckListText}

## 判定基準
- **pass**: 要件/ルールを満たしている
- **fail**: 必須項目で要件/ルールを満たしていない場合のみ使用
- **warn**: 記載はあるが不明瞭、または部分的にしか満たしていない
- **任意項目（必須: いいえ）のルール**: 該当しない場合は **pass**、該当するが不備がある場合は **warn**（failは使わない）

## 回答フォーマット（厳密にこのJSON形式で返してください）
**重要: 回答はJSON以外のテキストを含めず、以下のJSON構造のみを返してください。コードフェンス（\`\`\`json ... \`\`\`）で囲んでも構いません。**

\`\`\`json
{
  "nev_results": [
    {
      "id": "チェック項目ID",
      "status": "pass | fail | warn",
      "found_text": "図面から読み取れた内容（具体的に）",
      "detail": "判定理由の詳細"
    }
  ],
  "manual_results": [
    {
      "id": "マニュアルチェック項目ID",
      "status": "pass | fail | warn",
      "found_text": "図面から読み取れた内容",
      "detail": "判定理由の詳細"
    }
  ],
  "overall_comment": "図面全体の総合コメント（400文字程度。NeV要件とマニュアル準拠の両面から評価。Pass 1で読み取ったデータの整合性も含めて評価）"
}
\`\`\`

## 重要な注意事項
- 画像を隅々まで注意深く確認し、小さな文字やラベルも読み取ってください
- 複数ページがある場合は全ページを確認してください
- 「該当する場合のみ」の項目は、該当しない場合は **pass** としてください
- found_text には図面から読み取れた具体的なテキスト・数値を記載（推測不可）
- Pass 1で読み取ったデータ（detected_info、旗上げ等）を活用して正確に判定してください
- 全てのチェック項目について必ず結果を返してください（スキップ不可）`;
  }

  // ─── PDF → 画像変換 ────────────────────────────
  const MAX_CANVAS_PIXELS = 16_000_000;
  const MAX_CANVAS_DIM = 4096;

  function calcSafeScale(page, targetScale) {
    const viewport = page.getViewport({ scale: targetScale });
    let w = viewport.width;
    let h = viewport.height;

    if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
      const dimRatio = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
      return targetScale * dimRatio;
    }
    if (w * h > MAX_CANVAS_PIXELS) {
      const pixelRatio = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
      return targetScale * pixelRatio;
    }
    return targetScale;
  }

  async function pdfToImages(file) {
    let pdf;
    try {
      const arrayBuffer = await file.arrayBuffer();
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (e) {
      throw new Error('PDFファイルの読み込みに失敗しました。ファイルが破損しているか、パスワードで保護されている可能性があります。');
    }

    const images = [];
    const pageCount = pdf.numPages;
    const maxPages = Math.min(pageCount, 6);
    let totalBase64Size = 0;

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const safeScale = calcSafeScale(page, 3.0);
      const viewport = page.getViewport({ scale: safeScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const base64 = dataUrl.split(',')[1];
      totalBase64Size += base64.length;

      if (totalBase64Size > 18_000_000) {
        console.warn(`ページ${i}でペイロードサイズ上限に近づいたため、以降のページをスキップします`);
        canvas.width = 0;
        canvas.height = 0;
        break;
      }

      images.push({ base64, mimeType: 'image/jpeg', pageNum: i });
      canvas.width = 0;
      canvas.height = 0;
    }

    if (images.length === 0) {
      throw new Error('PDFから画像を生成できませんでした。');
    }

    return { images, pageCount };
  }

  // ─── PDF ネイティブ入力（テキスト層をGeminiに直接渡す）───
  // 【設計意図】
  //   pdf.js でラスタライズ → JPEG 変換するとテキスト層が失われ、
  //   Gemini が OCR で再認識するため桁違い誤読（15m↔150m）や
  //   類似文字誤読（PFD↔PFP）が発生しうる。
  //   PDFをそのまま base64 で Gemini に渡すと、埋め込みテキスト層を
  //   テキストとして直接抽出でき、精度が向上する。
  //   テキスト層がない（スキャン画像のみの）PDFでも Gemini 側で OCR されるため問題なし。
  //
  // 【フォールバック】
  //   base64 サイズが inline_data 上限（20MB）を超える場合や変換失敗時は
  //   check() 側で従来の pdfToImages（JPEG変換）にフォールバックする。
  //
  // 【pdfToImages との違い】
  //   pdfToImages: ページ単位でラスタ画像化 → 最大6ページ制限あり
  //   pdfToNative: PDF全体を1つのblob → 全ページがGeminiに渡る（ページ制限なし）
  const MAX_NATIVE_PDF_BASE64 = 18_000_000; // ~13.5MB (inline_data 20MB上限の安全マージン)

  async function pdfToNative(file) {
    const arrayBuffer = await file.arrayBuffer();

    // ページ数はpdf.jsで取得（Gemini APIはページ数を返さないため）
    let pageCount = 0;
    try {
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      pageCount = pdf.numPages;
      pdf.destroy();
    } catch (e) {
      throw new Error('PDFファイルの読み込みに失敗しました。ファイルが破損しているか、パスワードで保護されている可能性があります。');
    }

    // ArrayBuffer → base64
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    // チャンク単位で変換（大きなPDFでのスタックオーバーフロー防止）
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);

    if (base64.length > MAX_NATIVE_PDF_BASE64) {
      throw new Error(`PDFサイズが大きすぎます（${Math.round(base64.length / 1_000_000)}MB）。画像変換モードにフォールバックします。`);
    }

    return {
      images: [{ base64, mimeType: 'application/pdf' }],
      pageCount,
      nativeMode: true,  // check() 側で解析ページ数の表示を分岐するためのフラグ
    };
  }

  // ─── プレビュー用画像生成 ──────────────────────
  async function pdfToPreview(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const safeScale = calcSafeScale(page, 1.5);
      const viewport = page.getViewport({ scale: safeScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context の取得に失敗しました');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas;
    } catch (e) {
      console.error('プレビュー生成エラー:', e);
      return null;
    }
  }

  // ─── 利用可能モデル定義 ─────────────────────────
  const MODELS = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'free' },
    { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   tier: 'paid' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'free' },
  ];

  // ─── モデル別接続テスト ────────────────────────
  async function verifyModel(apiKey, modelId) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${modelId}?key=${apiKey}`,
        { method: 'GET' }
      );
      if (!response.ok) {
        // 503/500 は一時的な高負荷 — モデル自体は存在するので「利用可能」扱い
        if (response.status === 503 || response.status === 500) {
          return { available: true, reason: '' };
        }
        const data = await response.json().catch(() => ({}));
        return { available: false, reason: data?.error?.message || `HTTP ${response.status}` };
      }
      return { available: true, reason: '' };
    } catch (e) {
      return { available: false, reason: '接続エラー' };
    }
  }

  // ─── 有料キー判定（Proに軽量リクエストを送りクォータを確認）───
  async function checkPaidTier(apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "ok"' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 1 },
          }),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const msg = data?.error?.message || '';
        // 無料枠クォータ超過 → 無料キー
        if (response.status === 429 && msg.includes('free_tier')) {
          return false;
        }
        // 403 で free tier 関連 → 無料キー
        if (response.status === 403 && (msg.includes('free_tier') || msg.includes('billing'))) {
          return false;
        }
        // サーバーエラー(500/503等) → 判定不能、有料扱い（実行時に判明する）
        if (response.status >= 500) {
          return true;
        }
        // 429 で free_tier 以外（有料枠のレート制限） → 有料キー
        if (response.status === 429) {
          return true;
        }
        // その他のエラー（400等）→ 無料キーの可能性が高い
        if (msg.includes('free') || msg.includes('quota') || msg.includes('billing')) {
          return false;
        }
      }
      // 200 OK → 有料キー確定
      return true;
    } catch (e) {
      // ネットワークエラー等 → 判定不能、有料扱い（実行時に判明する）
      return true;
    }
  }

  async function verifyAllModels(apiKey) {
    const results = {};

    // まず全モデルの基本接続テスト（並列）
    await Promise.all(MODELS.map(async (model) => {
      results[model.id] = await verifyModel(apiKey, model.id);
    }));

    // 有料キーかどうか判定
    const isPaid = await checkPaidTier(apiKey);

    // 無料キーの場合、有料モデル(Pro)を利用不可にする
    if (!isPaid) {
      MODELS.forEach(model => {
        if (model.tier === 'paid' && results[model.id]?.available) {
          results[model.id] = {
            available: false,
            reason: '有料プランが必要です。Google AI Studio で課金を有効にしてください。',
          };
        }
      });
    }

    return results;
  }

  // ─── Gemini API 呼び出し ───────────────────────
  async function callGemini(apiKey, images, prompt, modelId) {
    const imageParts = images.map(img => ({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64,
      }
    }));

    const useModel = modelId || 'gemini-2.5-flash';

    // モデル別の最大出力トークン数
    const maxTokensByModel = {
      'gemini-2.5-pro':   65536,
      'gemini-2.5-flash': 65536,
      'gemini-2.0-flash': 8192,
    };
    const maxOutputTokens = maxTokensByModel[useModel] || 65536;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            ...imageParts,
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens,
      },
    };
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );
    } catch (networkErr) {
      throw new Error('ネットワーク接続エラー: インターネット接続を確認してください。');
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || '';
      const status = response.status;

      // クォータ超過（429）の検知と分類
      if (status === 429 || errMsg.includes('Quota exceeded') || errMsg.includes('quota')) {
        const isFreeTier = errMsg.includes('free_tier');
        const retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
        const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;

        const err = new Error(
          isFreeTier
            ? `【無料枠クォータ超過】モデル「${useModel}」の無料枠が上限に達しました。`
            : `【レート制限】モデル「${useModel}」のリクエスト制限に達しました。`
        );
        err.type = 'quota_exceeded';
        err.isFreeTier = isFreeTier;
        err.model = useModel;
        err.retryAfterSec = retrySec;
        err.suggestions = [];
        if (isFreeTier) {
          err.suggestions.push('Google AI Studio の課金設定で「有料枠（Pay-as-you-go）」を有効にしてください');
          err.suggestions.push('https://aistudio.google.com/apikey でAPIキーの課金設定を確認');
        }
        if (useModel.includes('pro')) {
          err.suggestions.push('Gemini 2.5 Flash や 2.0 Flash に切り替えると制限が緩和されます');
        }
        if (retrySec) {
          err.suggestions.push(`約${retrySec}秒後に再試行可能です`);
        }
        throw err;
      }

      // サーバー高負荷 (503) / 内部エラー (500) の検知
      if (status === 503 || status === 500 || errMsg.includes('high demand') || errMsg.includes('overloaded') || errMsg.includes('temporarily unavailable')) {
        const err = new Error(
          status === 503 || errMsg.includes('high demand')
            ? `モデル「${useModel}」は現在アクセスが集中しており、一時的に応答できません。`
            : `Gemini API でサーバーエラーが発生しました（HTTP ${status}）。`
        );
        err.type = 'server_overload';
        err.model = useModel;
        err.statusCode = status;
        throw err;
      }

      throw new Error(errMsg || `API エラー (${status})`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      const blockReason = data.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Gemini がリクエストをブロックしました（理由: ${blockReason}）。別の図面で再試行してください。`);
      }
      throw new Error('Gemini から応答が返りませんでした。しばらく待ってから再試行してください。');
    }

    const candidate = data.candidates[0];
    const finishReason = candidate.finishReason || '';

    if (finishReason === 'SAFETY') {
      throw new Error('Gemini の安全フィルタにより応答がブロックされました。');
    }

    const parts = candidate?.content?.parts || [];
    let text = null;
    for (let pi = parts.length - 1; pi >= 0; pi--) {
      if (parts[pi].text != null) {
        text = parts[pi].text;
        break;
      }
    }
    if (!text) {
      throw new Error('Gemini から有効なテキスト応答が得られませんでした。再試行してください。');
    }

    let jsonStr = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // トークン使用量を取得
    const usageMetadata = data.usageMetadata || {};

    try {
      const parsed = JSON.parse(jsonStr.trim());
      parsed._usageMetadata = usageMetadata;
      parsed._model = useModel;
      return parsed;
    } catch (parseErr) {
      console.error('Gemini応答のJSONパースに失敗:', text.substring(0, 500));

      // 原因を診断してユーザーに詳細を伝える
      let reason = '';
      if (finishReason === 'MAX_TOKENS') {
        reason = '原因: 応答がトークン上限に達し、JSONが途中で切れました。';
      } else if (finishReason === 'RECITATION') {
        reason = '原因: Gemini が応答を途中で停止しました（RECITATION）。';
      } else if (text.length < 100) {
        reason = '原因: Gemini の応答が極端に短く、有効なJSONが含まれていません。';
      } else if (!text.includes('{')) {
        reason = '原因: Gemini がJSON形式ではなくテキスト形式で応答しました。';
      } else {
        reason = '原因: Gemini の応答に不正なJSON構文が含まれていました。';
      }

      const suggestion = finishReason === 'MAX_TOKENS'
        ? 'ページ数の少ないPDFで再試行するか、別のモデルをお試しください。'
        : 'もう一度チェックを実行してください。繰り返す場合はモデルを変更してください。';

      const preview = text.substring(0, 200).replace(/\n/g, ' ');

      const err = new Error(
        `Gemini の応答を解析できませんでした。\n${reason}\n${suggestion}`
      );
      err.type = 'parse_error';
      err.finishReason = finishReason;
      err.model = useModel;
      err.responsePreview = preview;
      throw err;
    }
  }

  // ─── API キー検証 ─────────────────────────────
  async function verifyApiKey(apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        { method: 'GET' }
      );
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  // ─── NeV結果集計 ──────────────────────────────
  function aggregateNevResults(geminiResult, type) {
    const checks = type === 'kiso'
      ? [...COMMON_CHECKS, ...KISO_CHECKS]
      : [...COMMON_CHECKS, ...MOKUTEKICHI_CHECKS];

    const resultMap = {};
    const rawResults = geminiResult.nev_results || geminiResult.results || [];
    rawResults.forEach(r => { resultMap[r.id] = r; });

    const items = checks.map(check => {
      const result = resultMap[check.id] || { status: 'fail', found_text: '', detail: '判定結果が取得できませんでした' };
      // 任意項目(required: false)は fail → warn に変換（不合格扱いにしない）
      let status = result.status;
      if (!check.required && status === 'fail') status = 'warn';
      return { ...check, status, found_text: result.found_text || '', detail: result.detail || '' };
    });

    const categoryResults = {};
    items.forEach(item => {
      if (!categoryResults[item.category]) {
        categoryResults[item.category] = { items: [], pass: 0, fail: 0, warn: 0, total: 0 };
      }
      const cat = categoryResults[item.category];
      cat.items.push(item);
      cat.total++;
      if (item.status === 'pass') cat.pass++;
      else if (item.status === 'fail') cat.fail++;
      else cat.warn++;
    });

    const totalRequired = items.filter(i => i.required);
    const requiredPass = totalRequired.filter(i => i.status === 'pass').length;
    const requiredFail = totalRequired.filter(i => i.status === 'fail').length;
    const totalPass = items.filter(i => i.status === 'pass').length;

    let overall;
    if (requiredFail === 0) overall = 'pass';
    else if (requiredFail <= 2) overall = 'warn';
    else overall = 'fail';

    return { items, categoryResults, overall, totalPass, totalItems: items.length, requiredPass, requiredTotal: totalRequired.length, requiredFail };
  }

  // ─── マニュアル結果集計 ────────────────────────
  function aggregateManualResults(geminiResult) {
    const checks = MANUAL_CHECKS;

    const resultMap = {};
    const rawResults = geminiResult.manual_results || [];
    rawResults.forEach(r => { resultMap[r.id] = r; });

    const items = checks.map(check => {
      const result = resultMap[check.id] || { status: 'fail', found_text: '', detail: '判定結果が取得できませんでした' };
      // 任意項目(required: false)は fail → warn に変換（不合格扱いにしない）
      let status = result.status;
      if (!check.required && status === 'fail') status = 'warn';
      return { ...check, status, found_text: result.found_text || '', detail: result.detail || '' };
    });

    const categoryResults = {};
    items.forEach(item => {
      if (!categoryResults[item.category]) {
        categoryResults[item.category] = { items: [], pass: 0, fail: 0, warn: 0, total: 0 };
      }
      const cat = categoryResults[item.category];
      cat.items.push(item);
      cat.total++;
      if (item.status === 'pass') cat.pass++;
      else if (item.status === 'fail') cat.fail++;
      else cat.warn++;
    });

    const totalRequired = items.filter(i => i.required);
    const requiredPass = totalRequired.filter(i => i.status === 'pass').length;
    const requiredFail = totalRequired.filter(i => i.status === 'fail').length;
    const totalPass = items.filter(i => i.status === 'pass').length;

    let overall;
    if (requiredFail === 0) overall = 'pass';
    else if (requiredFail <= 2) overall = 'warn';
    else overall = 'fail';

    return { items, categoryResults, overall, totalPass, totalItems: items.length, requiredPass, requiredTotal: totalRequired.length, requiredFail };
  }

  // ─── 種別名正規化（キー比較用）──────────────────
  function normalizeKey(str) {
    if (!str) return '';
    return str.replace(/\s+/g, '').replace(/[ー−–—]/g, '-').toUpperCase();
  }

  // ─── 配管種別名の辞書ベース補正（Gemini誤読対策）──────
  // 既知の配管プレフィックスと照合し、1文字違いの誤読を自動補正
  const KNOWN_CONDUIT_PREFIXES = [
    'PFD', 'HIVE', 'FEP', 'VE', 'E', 'G', 'CD', 'PF',
  ];

  function correctConduitType(rawType) {
    if (!rawType) return rawType;
    const upper = rawType.replace(/\s+/g, '').replace(/[ー−–—]/g, '-').toUpperCase();
    // "PFP-54" → prefix="PFP", suffix="-54" / "F31" → prefix="F", suffix="31"
    const m = upper.match(/^([A-Z]+)(-?\d+.*)$/);
    if (!m) return rawType;
    const prefix = m[1];
    const suffix = m[2];
    // 既知プレフィックスに完全一致すればそのまま
    if (KNOWN_CONDUIT_PREFIXES.includes(prefix)) return rawType;
    // 1文字違い（編集距離1）の既知プレフィックスを探す
    let bestMatch = null;
    let bestDist = Infinity;
    for (const known of KNOWN_CONDUIT_PREFIXES) {
      const d = editDistance1(prefix, known);
      if (d < bestDist) { bestDist = d; bestMatch = known; }
    }
    if (bestDist === 1 && bestMatch) {
      return bestMatch + suffix;
    }
    return rawType;
  }

  // 編集距離（最大1まで高速判定、2以上は打ち切り）
  function editDistance1(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return 2;
    if (la === lb) {
      let diff = 0;
      for (let i = 0; i < la; i++) { if (a[i] !== b[i]) diff++; if (diff > 1) return 2; }
      return diff;
    }
    // 長さ1違い → 挿入/削除1回で一致するか
    const longer = la > lb ? a : b;
    const shorter = la > lb ? b : a;
    let diff = 0;
    for (let i = 0, j = 0; i < shorter.length; i++, j++) {
      if (shorter[i] !== longer[j]) { diff++; if (diff > 1) return 2; j++; if (j >= longer.length || shorter[i] !== longer[j]) return 2; }
    }
    return 1;
  }

  // Gemini結果全体に配管種別補正を適用
  function applyConduitCorrections(result) {
    // table_conduit_totals
    (result.table_conduit_totals || []).forEach(t => { t.type = correctConduitType(t.type); });
    // counted_conduit_totals
    (result.counted_conduit_totals || []).forEach(t => { t.type = correctConduitType(t.type); });
    // drawn_conduit_lengths
    (result.drawn_conduit_lengths || []).forEach(t => { t.type = correctConduitType(t.type); });
    // flagged_annotations
    (result.flagged_annotations || []).forEach(a => {
      if (a.conduit_type) a.conduit_type = correctConduitType(a.conduit_type);
    });
  }

  // ─── 配管合計の再計算（共入れ重複カウント補正）───────
  // Gemini が counted_conduit_totals で共入れ区間を重複加算する問題への安全策
  // flagged_annotations から shared_conduit_count を使い物理配管長を正確に算出
  function recalcConduitFromAnnotations(annotations) {
    if (!annotations || annotations.length === 0) return [];
    const calc = {};
    const displayNames = {};
    const methods = {};
    annotations.forEach(a => {
      if (!a.conduit_type) return;
      const key = normalizeKey(a.conduit_type);
      if (!displayNames[key]) { displayNames[key] = a.conduit_type; methods[key] = a.method || ''; }
      const len = a.length_m || 0;
      const shared = Number(a.shared_conduit_count) || 0;
      calc[key] = (calc[key] || 0) + (shared > 1 ? len / shared : len);
    });
    return Object.keys(calc).map(key => ({
      type: displayNames[key],
      total_length_m: Math.round(calc[key] * 10) / 10,
      method: methods[key],
    }));
  }

  // ─── ケーブル合計の再計算（Gemini集計誤り補正）───────
  // Gemini が counted_wire_totals を独自計算する際の誤り（(Xm×N)表記の二重カウント等）への安全策
  // flagged_annotations の各エントリを単純合算して正確な合計を算出
  function recalcWireFromAnnotations(annotations) {
    if (!annotations || annotations.length === 0) return [];
    const calc = {};
    const displayNames = {};
    annotations.forEach(a => {
      if (!a.cable_type) return;
      const key = normalizeKey(a.cable_type);
      if (!displayNames[key]) displayNames[key] = a.cable_type;
      calc[key] = (calc[key] || 0) + (a.length_m || 0);
    });
    return Object.keys(calc).map(key => ({
      type: displayNames[key],
      total_length_m: Math.round(calc[key] * 10) / 10,
    }));
  }

  // ─── 乖離サニティチェック（信頼度警告の検出）───────
  // 【目的】
  //   統括表の値と、旗上げカウントの値が大きく乖離している場合に警告リストを返す。
  //   読み取り自体は補正せず、ユーザー目視確認を促す情報として扱う（= 非破壊的監査層）。
  //
  // 【設計契約 / エラーチェック時に必ず保証すべき不変条件】
  //   1. 本関数は既存の数値（table_*_totals / counted_*_totals）を改変しない（副作用なし）
  //   2. 入力は必ず applyConduitCorrections 後の状態であること
  //      （種別名の正規化が揃っていないと missing_in_* が誤検出される）
  //   3. 戻り値の warning は { kind, type, severity, tableValue, countedValue, message } 形を満たす
  //   4. severity は 'diff' | 'missing_in_counted' | 'missing_in_table' のいずれか
  //   5. 同一 severity・同一 type の重複は normalizeKey による同一キー化で自然に排除される
  //
  // 【判定ロジック】
  //   ・両方に存在 → |差| >= ABS_THRESHOLD_M かつ 相対差 >= REL_THRESHOLD の両方を満たす場合のみ警告
  //     （AND条件にすることで小規模配線（例: 5m vs 8m = 60%差）の誤警告を抑える）
  //   ・統括表のみ → 旗上げ読み落とし疑い（missing_in_counted）
  //   ・旗上げのみ → 統括表読み落とし疑い（missing_in_table）
  //   ・両方 0m は無視（ゼロ除算回避＆情報ゼロ）
  //
  // 【しきい値の根拠（変更時は必ずテスト追加）】
  //   ABS_THRESHOLD_M = 20m: 現場で「誤読」と判断可能な最小単位（桁間違い:15m↔150m, 2m↔20m を確実に拾う）
  //   REL_THRESHOLD   = 30%: 計測誤差・端数丸めでは生じ得ない差。Gemini 集計ミス（二重カウント等）の典型値
  //   ※境界値テスト済み: 差20m・相対30% ちょうどは「警告」、19.9m や 29.9% は「警告しない」
  //
  // 【表示層との分担】
  //   本関数はデータ層で「疑わしい」ことだけを検出。
  //   一方、app.js の fuzzyMergeKeys は「表示統合のために 1 文字違いをマージ」する別責務。
  //   両者を分離しているのは、データ層で安易に統合すると警告を取りこぼす（本来警告すべき
  //   missing_in_* が消える）ため。エラーチェック時はこの分離を必ず維持すること。
  const ABS_THRESHOLD_M = 20;    // 20m以上の差で警告候補（桁違い誤読の確実検出）
  const REL_THRESHOLD   = 0.30;  // 30%以上の差で警告候補（集計ミスの典型差）

  function detectDiscrepancies(tableTotals, countedTotals, kindLabel) {
    const warnings = [];
    const tableMap = {};
    const countedMap = {};
    (tableTotals || []).forEach(t => {
      const k = normalizeKey(t.type);
      if (k) tableMap[k] = { type: t.type, value: Number(t.total_length_m) || 0 };
    });
    (countedTotals || []).forEach(t => {
      const k = normalizeKey(t.type);
      if (k) countedMap[k] = { type: t.type, value: Number(t.total_length_m) || 0 };
    });

    const allKeys = new Set([...Object.keys(tableMap), ...Object.keys(countedMap)]);
    allKeys.forEach(k => {
      const t = tableMap[k];
      const c = countedMap[k];
      // 両方に存在する → 差が閾値超なら警告
      if (t && c) {
        const diff = Math.abs(t.value - c.value);
        if (t.value === 0 && c.value === 0) return;
        const base = Math.max(t.value, c.value);
        const rel = base > 0 ? diff / base : 0;
        if (diff >= ABS_THRESHOLD_M && rel >= REL_THRESHOLD) {
          warnings.push({
            kind: kindLabel,
            type: t.type || c.type,
            severity: 'diff',
            tableValue: t.value,
            countedValue: c.value,
            diff: Math.round(diff * 10) / 10,
            rel: Math.round(rel * 100),
            message: `${kindLabel}「${t.type}」: 統括表${t.value}m vs 旗上げ合計${c.value}m（差${Math.round(diff*10)/10}m・${Math.round(rel*100)}%）`,
          });
        }
      }
      // 統括表にあるが旗上げに出てこない → 読み落とし疑い
      else if (t && !c && t.value > 0) {
        warnings.push({
          kind: kindLabel,
          type: t.type,
          severity: 'missing_in_counted',
          tableValue: t.value,
          countedValue: 0,
          message: `${kindLabel}「${t.type}」: 統括表に${t.value}m記載ありだが旗上げから検出されず（読み落とし疑い）`,
        });
      }
      // 旗上げにあるが統括表に出てこない → 統括表誤読または統括表欠落
      else if (!t && c && c.value > 0) {
        warnings.push({
          kind: kindLabel,
          type: c.type,
          severity: 'missing_in_table',
          tableValue: 0,
          countedValue: c.value,
          message: `${kindLabel}「${c.type}」: 旗上げから${c.value}m検出されたが統括表に記載なし（統括表側の読み落とし疑い）`,
        });
      }
    });
    return warnings;
  }

  // ─── Gemini元データと再計算値のマージ ──────────────
  // Gemini の counted/drawn totals をベースに、recalc で算出した種別の値で上書き
  // recalc にない種別は Gemini の元値を保持（データ消失防止）
  function mergeTotals(geminiTotals, recalcTotals) {
    const map = {};
    // 1. Gemini の元データをベースとして登録
    (geminiTotals || []).forEach(t => {
      const key = normalizeKey(t.type);
      if (key) map[key] = { ...t };
    });
    // 2. 再計算値で上書き（shared_conduit_count 補正済みの正確な値）
    (recalcTotals || []).forEach(t => {
      const key = normalizeKey(t.type);
      if (key) map[key] = t;
    });
    return Object.values(map);
  }

  // ─── メインチェック実行 ────────────────────────
  async function check(apiKey, file, type, modelId, onProgress) {
    // PDFネイティブ入力を優先（テキスト層の直接抽出で精度向上）
    // サイズ超過やエラー時は従来のJPEG画像変換にフォールバック
    let images, pageCount, nativeMode;
    try {
      ({ images, pageCount, nativeMode } = await pdfToNative(file));
      console.log(`PDFネイティブモード: ${pageCount}ページ`);
    } catch (nativeErr) {
      console.warn('PDFネイティブ入力に失敗、画像変換にフォールバック:', nativeErr.message);
      ({ images, pageCount } = await pdfToImages(file));
      nativeMode = false;
    }

    // ── Pass 1: データ読み取り（統括表・旗上げ・記載線長・基本情報）──
    if (onProgress) onProgress({ pass: 1, total: 2, message: '統括表・旗上げ・配線データを読み取り中...' });
    const pass1Prompt = buildPass1Prompt(type);
    const pass1Result = await callGemini(apiKey, images, pass1Prompt, modelId);

    // ── Pass 2: NeV要件・マニュアル準拠の合否判定 ──
    if (onProgress) onProgress({ pass: 2, total: 2, message: 'NeV要件・マニュアル準拠を判定中...' });
    const pass2Prompt = buildPass2Prompt(type, pass1Result);
    const pass2Result = await callGemini(apiKey, images, pass2Prompt, modelId);

    // 2パスの結果をマージ（Pass 1: データ、Pass 2: 判定）
    const geminiResult = {
      ...pass1Result,
      nev_results: pass2Result.nev_results,
      manual_results: pass2Result.manual_results,
      overall_comment: pass2Result.overall_comment,
    };

    // トークン使用量を合算
    const usage1 = pass1Result._usageMetadata || {};
    const usage2 = pass2Result._usageMetadata || {};
    geminiResult._usageMetadata = {
      promptTokenCount: (usage1.promptTokenCount || 0) + (usage2.promptTokenCount || 0),
      candidatesTokenCount: (usage1.candidatesTokenCount || 0) + (usage2.candidatesTokenCount || 0),
      totalTokenCount: (usage1.totalTokenCount || 0) + (usage2.totalTokenCount || 0),
    };
    geminiResult._model = pass2Result._model || pass1Result._model;

    // 配管種別名の辞書ベース補正（PFP→PFD, F-39→E-39 等の誤読対策）
    // 【重要な実行順序 — 変更時は detectDiscrepancies の挙動回帰テスト必須】
    //   applyConduitCorrections → mergeTotals → detectDiscrepancies の順序は不変条件。
    //   補正前に detectDiscrepancies を呼ぶと、table 側「PFD-54」と counted 側「PFP-54」が
    //   別キー扱いになり、両方とも missing_in_* として誤警告される。
    //   エラーチェック時は「両側とも同じ正規化済み種別名になっているか」を必ず確認すること。
    applyConduitCorrections(geminiResult);

    const nev = aggregateNevResults(geminiResult, type);
    const manual = aggregateManualResults(geminiResult);

    // flagged_annotations から配線・配管合計を再計算（Geminiの集計誤り補正）
    // Geminiの元データをベースに、再計算値で上書きマージ（データ消失防止）
    const fa = geminiResult.flagged_annotations || [];
    const recalcWire = recalcWireFromAnnotations(fa);
    const recalcConduit = recalcConduitFromAnnotations(fa);
    const wireTotals = mergeTotals(geminiResult.counted_wire_totals, recalcWire);
    const conduitTotals = mergeTotals(geminiResult.counted_conduit_totals, recalcConduit);
    // drawn は Gemini原本をベースに、再計算が存在する種別のみ上書き
    const drawnWireTotals = mergeTotals(geminiResult.drawn_wire_lengths, recalcWire);
    const drawnConduitTotals = mergeTotals(geminiResult.drawn_conduit_lengths, recalcConduit);

    // 乖離サニティチェック（統括表 vs 旗上げ合計）
    // ここで渡す counted 側は mergeTotals 済みの正確値（recalcWire/Conduit で再計算済）。
    // table 側は Gemini 読み取りそのまま（統括表が「事実」として存在する以上、
    // ここで補正すると統括表の誤読を隠蔽してしまうため、原本を保つ）。
    const discrepancyWarnings = [
      ...detectDiscrepancies(geminiResult.table_wire_totals, wireTotals, '配線'),
      ...detectDiscrepancies(geminiResult.table_conduit_totals, conduitTotals, '配管'),
    ];

    return {
      nev,
      manual,
      tableWireTotals: geminiResult.table_wire_totals || [],
      tableConduitTotals: geminiResult.table_conduit_totals || [],
      countedWireTotals: wireTotals,
      countedConduitTotals: conduitTotals,
      drawnWireLengths: drawnWireTotals,
      drawnConduitLengths: drawnConduitTotals,
      flaggedAnnotations: geminiResult.flagged_annotations || [],
      discrepancyWarnings,
      overallComment: geminiResult.overall_comment || '',
      detectedInfo: geminiResult.detected_info || {},
      pageCount,
      analyzedPages: nativeMode ? pageCount : images.length,
      inputMode: nativeMode ? 'pdf-native' : 'jpeg-raster',
      costEstimate: estimateCost(geminiResult._usageMetadata, geminiResult._model),
    };
  }

  // ─── 料金概算 ─────────────────────────────────
  // 単位: USD per 1M tokens（2025年4月時点の参考価格）
  const PRICING = {
    'gemini-2.5-pro':   { input: 1.25, output: 10.00, label: 'Gemini 2.5 Pro' },
    'gemini-2.5-flash': { input: 0.15, output: 0.60,  label: 'Gemini 2.5 Flash' },
    'gemini-2.0-flash': { input: 0.10, output: 0.40,  label: 'Gemini 2.0 Flash' },
  };

  function estimateCost(usage, modelId) {
    if (!usage) return null;
    const pricing = PRICING[modelId] || PRICING['gemini-2.5-flash'];
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);

    const inputCostUsd = (inputTokens / 1_000_000) * pricing.input;
    const outputCostUsd = (outputTokens / 1_000_000) * pricing.output;
    const totalCostUsd = inputCostUsd + outputCostUsd;

    // USD → JPY 概算（1 USD ≈ 150 JPY）
    const rate = 150;
    const totalCostJpy = totalCostUsd * rate;

    return {
      model: pricing.label,
      inputTokens,
      outputTokens,
      totalTokens,
      inputCostUsd: Math.round(inputCostUsd * 10000) / 10000,
      outputCostUsd: Math.round(outputCostUsd * 10000) / 10000,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      totalCostJpy: Math.round(totalCostJpy * 100) / 100,
    };
  }

  // ─── 結果テキスト出力 ──────────────────────────
  function resultToText(result, type) {
    const typeLabel = type === 'kiso' ? '基礎充電' : '目的地充電';
    let text = `=== NeV 配線ルート図 要件判定結果 ===\n`;
    text += `図面タイプ: ${typeLabel}\n\n`;

    // NeV判定
    const nev = result.nev;
    text += `■ NeV要件判定: ${nev.overall === 'pass' ? '合格' : nev.overall === 'warn' ? '要確認' : '不合格'}\n`;
    text += `  合格 ${nev.totalPass} / ${nev.totalItems} 項目（必須: ${nev.requiredPass} / ${nev.requiredTotal}）\n\n`;

    nev.items.forEach(item => {
      const icon = item.status === 'pass' ? '[OK]' : item.status === 'fail' ? '[NG]' : '[!?]';
      text += `${icon} ${item.label}${item.required ? '' : ' [任意]'}\n`;
      if (item.found_text) text += `    検出: ${item.found_text}\n`;
      if (item.detail) text += `    詳細: ${item.detail}\n`;
      text += '\n';
    });

    // マニュアル判定
    const manual = result.manual;
    text += `\n■ 作図センターマニュアル判定: ${manual.overall === 'pass' ? '合格' : manual.overall === 'warn' ? '要確認' : '不合格'}\n`;
    text += `  合格 ${manual.totalPass} / ${manual.totalItems} 項目（必須: ${manual.requiredPass} / ${manual.requiredTotal}）\n\n`;

    manual.items.forEach(item => {
      const icon = item.status === 'pass' ? '[OK]' : item.status === 'fail' ? '[NG]' : '[!?]';
      text += `${icon} ${item.label}${item.required ? '' : ' [任意]'}\n`;
      if (item.found_text) text += `    検出: ${item.found_text}\n`;
      if (item.detail) text += `    詳細: ${item.detail}\n`;
      text += '\n';
    });

    // 配線集計（統括表）
    if (result.tableWireTotals && result.tableWireTotals.length > 0) {
      text += `\n■ 統括表の記載値 — 配線\n`;
      result.tableWireTotals.forEach(w => { text += `  ${w.type}: ${w.total_length_m}m\n`; });
    }
    if (result.tableConduitTotals && result.tableConduitTotals.length > 0) {
      text += `\n■ 統括表の記載値 — 配管\n`;
      result.tableConduitTotals.forEach(c => { text += `  ${c.type}: ${c.total_length_m}m\n`; });
    }

    // 配線集計（実カウント）
    if (result.countedWireTotals && result.countedWireTotals.length > 0) {
      text += `\n■ 注記カウント — 配線\n`;
      result.countedWireTotals.forEach(w => {
        text += `  ${w.type}: ${w.total_length_m}m`;
        const bd = w.breakdown;
        if (bd) {
          const parts = [];
          if (bd.exposed_m) parts.push(`露出${bd.exposed_m}m`);
          if (bd.in_conduit_m) parts.push(`管内${bd.in_conduit_m}m`);
          if (bd.buried_m) parts.push(`埋設${bd.buried_m}m`);
          if (bd.aerial_m) parts.push(`架空${bd.aerial_m}m`);
          if (parts.length) text += ` （${parts.join(', ')}）`;
        }
        text += '\n';
      });
    }
    if (result.countedConduitTotals && result.countedConduitTotals.length > 0) {
      text += `\n■ 注記カウント — 配管\n`;
      result.countedConduitTotals.forEach(c => {
        text += `  ${c.type}: ${c.total_length_m}m`;
        if (c.method) text += ` [${c.method}]`;
        text += '\n';
      });
    }

    // 記載線長
    if (result.drawnWireLengths && result.drawnWireLengths.length > 0) {
      text += `\n■ 記載線長 — 配線\n`;
      result.drawnWireLengths.forEach(w => { text += `  ${w.type}: ${w.total_length_m}m\n`; });
    }
    if (result.drawnConduitLengths && result.drawnConduitLengths.length > 0) {
      text += `\n■ 記載線長 — 配管\n`;
      result.drawnConduitLengths.forEach(c => { text += `  ${c.type}: ${c.total_length_m}m\n`; });
    }

    // 旗上げ一覧
    if (result.flaggedAnnotations && result.flaggedAnnotations.length > 0) {
      text += `\n■ 旗上げ（各区間の注記）一覧\n`;
      result.flaggedAnnotations.forEach((a, i) => {
        text += `  ${i + 1}. ${a.cable_type || a.conduit_type || '-'}`;
        if (a.cable_type && a.conduit_type) text += ` / ${a.conduit_type}`;
        text += ` | ${a.method || '-'} | ${a.length_m != null ? a.length_m : '-'}m`;
        if ((Number(a.shared_conduit_count) || 0) > 1) text += ` [共入れ${a.shared_conduit_count}]`;
        if (a.note) text += ` (${a.note})`;
        text += '\n';
      });
    }

    // 読み取り情報
    const info = result.detectedInfo;
    if (info) {
      text += `\n--- 読み取り情報 ---\n`;
      if (info.facility_name) text += `施設名: ${info.facility_name}\n`;
      if (info.drawing_title) text += `図面名称: ${info.drawing_title}\n`;
      if (info.creator) text += `作成者: ${info.creator}\n`;
      if (info.scale) text += `縮尺: ${info.scale}\n`;
      if (info.creation_date) text += `作成日: ${info.creation_date}\n`;
      if (info.wire_type) text += `電線種類: ${info.wire_type}\n`;
      if (info.total_length) text += `配線全長: ${info.total_length}\n`;
      if (info.equipment_count) text += `EV充電設備: ${info.equipment_count}\n`;
    }

    if (result.overallComment) {
      text += `\n--- AI コメント ---\n${result.overallComment}\n`;
    }

    return text;
  }

  // ─── 公開API ──────────────────────────────────
  return {
    check,
    verifyApiKey,
    verifyModel,
    verifyAllModels,
    pdfToPreview,
    resultToText,
    CATEGORIES,
    MODELS,
    COMMON_CHECKS,
    KISO_CHECKS,
    MOKUTEKICHI_CHECKS,
    MANUAL_CHECKS,
  };

})();
