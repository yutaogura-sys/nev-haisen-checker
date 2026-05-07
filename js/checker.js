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
      description: '統括表の記載がマニュアル**推奨**順序に従っているのが望ましい（[種別用途][配管種類・口径]の順、露出配管接続→露出配管→埋設配管の順、配管はPFD→HIVE→FEP等の順）。**情報自体の有無は別チェック（mc_summary_table / mc_summary_cable_breakdown）でカバーされる**。本項目は順序のみのスタイル判定であり、必要情報が揃っていれば順序が異なっても fail にせず warn 止まりにすること。任意項目扱い（required: false）', required: false },
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
      description: '**新設**埋設区間がある場合のみ、ハッチング色がマニュアル準拠か確認。アスファルト/コンクリート=赤色ハッチング、土/砂利=緑色ハッチング。**既設埋設区間のみの場合（既設配管・既設埋設等）はハッチング不要のため pass**。該当区間が一切ない場合も pass。flagged_annotations の note/method/cable_type に「既設」が含まれる旗上げは既設埋設として扱い、本チェックの対象外。新設埋設区間が存在しない場合に「ハッチングなし」を理由に warn/fail を返してはならない（過剰指摘の典型パターン）', required: false },
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
      description: '全ての設備ラベルに「新設」または「既設」のプレフィックスが付いているか。例：「新設プルボックス」「既設分電盤」「新設EV充電設備」等。判定は段階的に行う ①全設備にプレフィックス → pass、②一部欠落 + 色分けで識別可能（赤=新設、青=既設）→ pass（色分けで意図が明確）、③全設備プレフィックスなし + 色分けあり → warn（識別は機能するがマニュアル推奨表記から外れる）、④全設備プレフィックスなし + 色分けもなし → fail（識別手段なし）。Pass 1 の wire_color_distinction / color_legend_observed を最優先の根拠として参照', required: true },
    { id: 'mc_color_coding', category: 'manual_notation', label: '配線ルートの色分けルール',
      description: '配線ルートの色分けがマニュアル準拠か。期待ルール：新設配線=赤色線、既設配線=青色線、電力会社工事=緑線。判定は段階的に行う ①凡例（記号表）に色分けが定義 + ルート上に色分け視認 → pass、②凡例なしでも2色以上視認 → pass、③凡例ありでも色分け視認できず → warn、④凡例なし + 1色のみ視認 → warn、⑤完全モノクロ（凡例なし・色分け表記なし） → fail。Pass 1 の color_legend_observed / wire_color_distinction を最優先の根拠として参照', required: true },
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

## 【最初に判定すること】 図面のカラー判定
**他のすべての作業に着手する前**に、まず以下を必ず判定してください。
これは後段の色判定（配線色分け・埋設ハッチング・ケーブルプロテクター色等）すべての根拠になります。

### 判定対象
1. **図面全体に有彩色（赤・青・緑・オレンジ・橙・黄等）が 1 つでも含まれているか**
   - 配線ルート線の色 / ハッチング塗り / 凡例の色見本 / 色付きテキスト等のいずれかに有彩色があれば「カラー」
   - 完全にモノクロ（黒・白・グレースケールのみ）なら「モノクロ」
2. **観測した色を網羅的に1文で要約**
   - 例: 「配線ルート: 赤・青、ハッチング: 赤・緑、凡例: 4色」
   - モノクロの場合: 「カラー要素なし（モノクロ図面）」

### 判定結果は detected_info の以下フィールドに必ず記録
- **is_color_drawing**: true（カラー） / false（モノクロ）
- **color_observation_summary**: 上記の要約文

### 注意事項（必ず守ること）
- **「黒に見える線」「暗い線」も注意深く確認** — 暗い赤・暗い青・暗い緑が黒と誤認されやすい
- **配線ルート図は通常カラー**。完全モノクロの図面は稀である前提で慎重に判定
- **判定を行ってから後続の作業に進むこと** — この判定結果は後段の色観測（作業1-b、ハッチング観測等）と整合する必要がある
- 不確実な場合は **is_color_drawing=true** 側に倒し、color_observation_summary に「不確実: 色微差あり」と注記

## 【作業1】図面基本情報の読み取り (detected_info)
表題欄および図面全体から以下を読み取ってください（見つからない項目は空文字）：
施設名（設置場所名称）、図面名称（「配線ルート図」等）、工事名、作成者（会社名または個人名）、縮尺、作成日、電線種類（使用されている全ケーブル種別）、配線全長、配線内訳の要約、配線方法一覧（露出/埋設/架空等）、配管種類一覧、電源元（受電盤/分電盤/キュービクル等）、EV充電設備台数、路面状況（アスファルト/コンクリート/土等）、付帯設備（プルボックス/ハンドホール/支柱等）、既設設備情報

### 【作業1-b】配線色の観測（必須・後段の色分け判定の根拠になります）
配線ルート図は通常、新設配線=赤、既設配線=青、電力会社工事=緑のように色分けされています。
**完全モノクロの図面は稀です**。「黒に見える線」でも、注意深く確認すると暗い赤・暗い青の場合があります。
以下を必ず確認して detected_info に記録してください：

1. **凡例（記号表）の確認**
   - 図面の右下・左下・余白に「凡例」「記号表」「色分け表」等のラベル付き表があるかを確認
   - 凡例で定義されている色分けルールを文字で書き起こす（例：「赤線=新設配線、青線=既設配線」）
   - 凡例自体が見つからない場合は空文字

2. **配線ルート上の色観測**
   - 実際に図面内の配線ルート線（電源元から充電設備への経路を示す線）が何色で描かれているかを観測
   - 1本でも色付き線（赤・青・緑・橙等）が見える場合、その色名を全て列挙
   - 配線ルートが完全に黒のみで描かれている場合は空配列
   - **背景の罫線・表枠・テキストの色は除外**。あくまで「配線ルートを示す線」の色のみ

3. **凡例の所在**
   - 凡例が見つかった場合、その所在（例：「右下表題欄の下」「左上余白」）を記録
   - 見つからない場合は空文字

**重要**: この情報は後段の Pass 2 で「mc_color_coding（配線ルートの色分けルール）」判定の主要根拠になります。
画像のみで色微差を判定するのは Gemini にとって難しいため、Pass 1 でテキスト化することで判定精度を上げます。
慎重かつ正直に観測してください — 不確実な場合は空配列・空文字を返し、断定しないこと。

### 【作業1-c】ハッチング色の観測（必須・埋設ハッチング・ケーブルプロテクター判定の根拠になります）
配線ルート図には複数の種類の**ハッチング**（斜線・網掛け・塗りつぶし）が描かれます。各ハッチングの色を観測してください。

**ハッチング色のマニュアル準拠ルール:**
- **赤色ハッチング** = アスファルト/コンクリート埋設区間
- **緑色ハッチング** = 土/砂利埋設区間
- **オレンジ色ハッチング** = ケーブルプロテクター（CP2-60X3MBK 等）
- 上記以外の色も観測したらすべて列挙

**観測手順:**
1. **図面上のすべてのハッチング・色塗りエリアを走査**
   - 配線ルート上の埋設区間に塗られた色斜線
   - 配線途中のケーブルプロテクター区間の塗り
   - その他の色付き面状要素
2. **各ハッチングの色名を文字で記録**（例: "赤", "緑", "オレンジ"）
3. **各ハッチングの所在・用途を併記**（例: "埋設区間（赤、アスファルト想定）", "ケーブルプロテクター区間（オレンジ）"）

**重要な注意事項:**
- 凡例でハッチング色のルールが定義されている場合は color_legend_observed にその文言も含めて記録
- 「配線色」と「ハッチング色」は別フィールドで記録（混在させない）
- ハッチングが完全になければ空配列 []
- **「該当区間がない（埋設なし・プロテクターなし）」と「区間はあるが色が見えない」は別**
  - 区間自体がない場合: hatching_colors_observed=[]、hatching_locations=[]
  - 区間はあるが色が確認できない場合: hatching_colors_observed=[]、hatching_locations=["埋設区間あり（色不明）"] のように所在のみ記録

## 【作業2】統括表（配線集計表）の記載値の読み取り
図面内の統括表（配線集計表）から数値をそのまま読み取ってください。統括表がない場合は空配列 []。

### 【最重要】統括表数値の精度確保（桁検証ディシプリン）
統括表の数値は配線・配管の合計値であり、誤読が後段の判定に直接影響します。以下を厳守してください。

**1. 1〜3 桁数値が誤読されやすい**
   統括表には全長（〜数百 m）、内訳（〜数十 m）、配管長（〜数十 m）など多様な桁数の数値が並ぶ。
   特に注意:
   - 「15 ↔ 150」「18 ↔ 180」「6 ↔ 66」「3 ↔ 33」のような桁数の見落とし
   - 「3 ↔ 8」「1 ↔ 7」「5 ↔ 6」「4 ↔ 9」のような単一文字の混同
   - 小さい文字サイズ・低解像度・隣接セルとの近接で混同が増える

**2. 各数値を「桁ごとに確認」する手順**
   - 数値全体の桁数（1桁か2桁か3桁か、小数点の有無）を最初に決定
   - 各桁の文字を1つずつ識別
   - 同列の上下の数値と整合するか確認（極端な桁違いは要再確認）

**3. 「読み取れない」を表現する手段（ハルシネーション禁止）**
   セルがあるが数値が読み取れない場合（解像度低い・印字かすれ・遮蔽等）:
   - **推測値で穴埋めしない** — 推測値を入れると後段で「一致」と誤判定される silent failure になる
   - confidence フィールドを "low" または "unreadable" に設定
   - "unreadable" の場合は total_length_m を null にしてよい
   - 「本当に 0m なのか、それとも読み取れないのか」を必ず区別する（0m を返すのは確実に 0m と読めた場合のみ）

**4. confidence の判定基準**
   - **high**: 数値を明確に読み取れた（鮮明・コントラスト十分）
   - **medium**: 読めたが解像度・サイズ・近接干渉で確信度中程度
   - **low**: 読み取りに自信なし。値は記録するが推測の可能性を示す
   - **unreadable**: セルは存在するが完全に読み取り不能。total_length_m=null

**統括表の読み取り手順（必ず従ってください）：**
1. まず**列ヘッダー（見出し行）**を確認し、各列が何を表すか特定する
2. 各ケーブル種別の行を**1行ずつ**読み取る
3. 各行の「配線長」（=ケーブルの全長）の数値を正確に読み取る（上記桁検証ディシプリンに従う）
4. 同じ行の「内訳」（露出/管内/埋設等）の数値も全て読み取る
5. **行内自己整合性検証（必須）**: 「配線長 = 露出+管内+埋設+架空 の内訳合計」 を手元計算で確認
   - 絶対差 ≥ 5m または 相対差 ≥ 5% で乖離する場合は、その行の数値を桁ごとに再読
   - 再読で訂正できない場合は confidence を "low" に設定（あえて入力した数値を信用しないことを後段に伝える）
   - 隣接行（上下）のセルを誤って読んでいないかも併せて確認

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

**マルチページ統括表の取り扱い（規模の大きい図面で発生）:**
- 統括表が複数ページに分かれている場合（行が次ページに続く等）、**全ページの統括表を結合して 1 つの table_wire_totals / table_conduit_totals にまとめる**
- 各エントリの source_page には「**そのケーブル種別/配管種別の行が記載されているページ番号**」を設定
- 複数ページに同じケーブル種別の行が現れる場合（ページごとに分割表記）、合算した値を 1 件として記録し、source_page は最初の出現ページを設定
- ページ間で数値が連続する表（例: page 1 に CVT8sq-3C 12m、page 2 に同種別 8m → 合計 20m）の場合、**1 行に統合**して total_length_m=20 にする

## 【作業3】旗上げ（各区間の注記）の全件読み取り
配線ルート上のテキスト注記（「旗上げ」）を**1つ残らず全て**読み取ってください。
**注記の文字色は複数あります**：新設区間は緑色や赤色、既設区間は青色で記載されます。**色に関係なく全ての旗上げを読み取ってください。**

### 【最重要】数値読み取りの精度確保（桁検証ディシプリン）
旗上げの length_m は本ツールで最も誤読が発生しやすい箇所です。以下を厳守してください。

**1. 1桁・2桁数値が最も誤読されやすい**
   配線ルート図には短区間（1m, 3m, 5m, 8m, 13m, 18m 等）が多数存在し、これらは隣接数字との視覚的類似で混同されやすい。
   **特に注意**: 文字サイズが小さい数値、画像解像度が低い箇所、近接する別の旗上げが視覚的に重なる箇所。

**2. 典型的な誤読パターン（必ず再確認）**
   - 「3 ↔ 8」（曲線部分の判別が難しい）
   - 「1 ↔ 7」（縦棒のみの 1 と斜め線がある 7）
   - 「5 ↔ 6」（下部のループ有無）
   - 「13 ↔ 18」（下二桁の 3/8 混同）
   - 「15 ↔ 150」（桁数の見落とし — m 表記の左右の数字を誤認）
   - 「2 ↔ 20」（同上）
   - 「4 ↔ 9」（手書きまたは細字の場合）

**3. 数値1つごとに「桁ごとの確認」を実行**
   - その数値が **1桁か2桁か3桁か** を最初に決める（小数点の有無、m の左に数字が何文字あるか）
   - 各桁の文字を1つずつ識別する（例: "13m" なら "1" + "3" + "m"）
   - 隣接する旗上げの length_m と矛盾しないか確認（例: 同じ短い区間で「5m」と「50m」が並んでいたら 10倍違いは要再確認）

**4. ケーブル長と配管長の両方を同等の精度で確認**
   旗上げ1件には通常 length_m が1つだけ記載されますが、その値は cable_type と conduit_type の両方の長さとして扱われます（共入れの場合の shared_conduit_count による分割は別問題）。
   **配管側の合計（counted_conduit_totals）も同じ length_m を根拠に算出されるため、cable と conduit を区別して片方だけ慎重に読むのではなく、length_m そのものを慎重に読んでください。**

**5. 確信が持てない場合の振る舞い**
   ・桁数や数字に確信が持てない場合、note 欄に "数値読み取りに不確実性あり" と明記
   ・それでも flagged_annotations にはエントリ自体を入れる（読み落としよりは桁誤読の方が後段で検出可能）

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
5. **ページ番号 (page)**: その旗上げが描かれているページ番号（1-indexed の整数）。単一ページPDFの場合は常に 1。マルチページPDFの場合は **必ず実際のページ番号を記録**。これにより後段の取りこぼし検出（特定ページの記録ゼロ）と、警告メッセージのページ特定が可能になる

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

**マルチページ図面の取り扱い（取りこぼし・二重カウント防止）:**
複数ページにわたる図面では、ページ間の取りこぼしと二重カウントの両方が発生しやすい。以下の手順で読み取ること：

1. **ページごとに独立して旗上げを読み取る**
   - 各ページの旗上げを page=1, page=2, ... と分けて全件列挙
   - 合算は行わず、ページ別の生データを揃える段階を最初に終わらせる

2. **ページごとの件数を意識する**
   - ページ番号別に「このページに何件の旗上げを記録したか」を意識
   - あるページに極端に少ない（または 0 件の）記録の場合、取りこぼしの強い疑い → 再走査
   - 例: 5ページ図面で page=1 に 30 件、page=2 以降が各 0 件なら、page 2-5 は要再確認

3. **ページをまたぐ連続区間（重要 — 二重カウント注意）**
   - ページの端で区切られた配線が次ページに続いている場合、**1 つの旗上げを 2 件として記録しない**
   - 次ページで同じ旗上げ表示が繰り返されているように見えても、それは見出し的な引用や同区間の補足であり別区間ではないことが多い
   - 同一ケーブル種別・同一施工方法・同一 length_m の旗上げが連続ページに現れた場合、二重記載の疑いが高い → どちらか 1 件のみを採用し、note に「ページXとページYに同表示」と記録

4. **ページごとの内訳を note に記すと有効**
   - 例: 同一ケーブル種別が複数ページに散在する場合、note に "page 1 で 12m + page 2 で 8m" のように内訳を残すとデバッグが容易になる（必須ではないが推奨）

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
    {
      "type": "ケーブル種別（例: CVT22sq）",
      "total_length_m": "数値（confidence='unreadable' の場合は null を許容）",
      "confidence": "high | medium | low | unreadable",
      "source_page": "整数（この値を読み取った統括表が記載されているページ番号、1-indexed）。単一ページなら 1"
    }
  ],
  "table_conduit_totals": [
    {
      "type": "配管種別（例: PFD-28）",
      "total_length_m": "数値（confidence='unreadable' の場合は null を許容）",
      "confidence": "high | medium | low | unreadable",
      "source_page": "整数（この値を読み取った統括表が記載されているページ番号、1-indexed）。単一ページなら 1"
    }
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
      "page": "ページ番号（整数, 1-indexed）。単一ページなら 1、マルチページなら実際のページ番号",
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
    "is_color_drawing": "boolean（true=有彩色が1つでもある、false=完全モノクロ）。判定に迷う場合は true 側に倒す",
    "color_observation_summary": "観測した色を網羅的に1文で要約（例: '配線ルート: 赤・青、ハッチング: 赤・緑、凡例: 4色'、モノクロなら 'カラー要素なし'）",
    "color_legend_observed": "凡例に記載されている色分けルールの全文（例: '赤線=新設配線、青線=既設配線、緑線=電力会社工事'）。凡例が見つからない場合は空文字",
    "wire_color_distinction": ["配線ルート線で実際に観測した色名の配列。例: ['赤', '青']。完全モノクロのみなら空配列 []"],
    "color_legend_location": "凡例の所在（例: '右下表題欄の下'）。見つからない場合は空文字",
    "hatching_colors_observed": ["観測されたハッチング色名の配列。例: ['赤', '緑', 'オレンジ']。ハッチングが一切なければ空配列 []"],
    "hatching_locations": ["各ハッチングの所在・用途の説明配列。例: ['埋設区間（赤、アスファルト想定）', 'ケーブルプロテクター（オレンジ）']。区間自体がなければ空配列"],
    "page_count_analyzed": "解析ページ数"
  }
}
\`\`\`

## 自己検証（回答前に必ず実行すること — 抽象的に終わらせず、必ず手を動かして再走査すること）

### 検証0: 統括表内の自己整合性（必ず最初に実行）
旗上げ照合（検証1, 検証2）に進む前に、**統括表自体の妥当性を確認**してください。
統括表の数値が誤っていると、後段の照合がすべて連鎖的に誤判定されます。

1. **行内整合性**: 各ケーブル種別行で「全長 = 露出+管内+埋設+架空 の内訳合計」を手元計算で確認
   - 絶対差 ≥ 5m または 相対差 ≥ 5% で乖離する場合、その行を桁ごとに再読
   - 再読で訂正できなければ confidence を "low" に設定

2. **配管長 vs 配線長の取り違えチェック（パターン B 統括表のみ）**:
   - 「配線長」列と「配管長」列を取り違えていないか確認
   - 同じケーブル種別で配線長 < 配管長 となっている場合は要再確認（通常は配線長 ≥ 配管長）

3. **隣接行混同のチェック**:
   - 各ケーブル種別の行が、その上下の別種別の行と数値を取り違えていないか確認
   - 1〜2 桁数値（例: 5m, 8m）は特に隣接セルとの混同が起きやすい

4. **confidence の付与**:
   - 各 table_wire_totals / table_conduit_totals エントリに confidence を必ず付与
   - 「読み取れた」確信が高ければ "high"、不確実なら "medium" または "low"、完全に読めなければ "unreadable"（total_length_m=null）
   - **推測値で穴埋めする代わりに低 confidence を返すのが正しい振る舞い**

5. **source_page の付与**:
   - 各エントリの source_page に、その行が記載されているページ番号（1-indexed）を設定
   - マルチページ統括表で異なるページにまたがる場合、最初の出現ページを記録

### 検証1: 旗上げ合計 vs 統括表の照合（ケーブル）
flagged_annotations の length_m をケーブル種別ごとに合算し、table_wire_totals の全長と比較。
**再読トリガー（厳しめ・予防的）**: ケーブル種別 X について以下のいずれかを満たす場合は再読を実施
- **絶対差 ≥ 5m**（後段アプリの警告閾値 20m より早く検出するため）
- **相対差 ≥ 15%**（後段アプリの警告閾値 30% より早く検出するため）

**再読フロー（必ずこの順序で実行し、結果を本番出力に反映すること）:**

1. **ステップA: 全件列挙** — 図面全体を再走査し、cable_type に X を含む旗上げを **1 件残らず** 抽出
2. **ステップB: 桁ごとの再確認** — 各旗上げの length_m について
   - 桁数を改めて確認（1桁か 2 桁か 3 桁か）
   - 各桁の文字を 1 つずつ識別（特に 3↔8、1↔7、5↔6、4↔9、15↔150、2↔20）
   - 文字サイズが小さい数値・近接する別表示と重なる箇所は特に慎重に
3. **ステップC: 表記パターン誤読の検出** — 以下の二重カウント / 不足を排除
   - 「(Xm×N)」表記: パターン①（Xm 明記）なら X、パターン②（X なし）なら Y×N
   - 「+」結合: 各エントリの shared_conduit_count が結合数と一致
4. **ステップD: マルチページ取りこぼしの検出**（複数ページの場合）
   - ページ番号別の件数を確認し、極端に少ない/0 件のページがあれば再走査
   - 連続ページにわたる同一表示は 1 件として記録（二重カウント排除）
5. **ステップE: 修正の確定反映** — 再読で発見した誤りを **flagged_annotations の本体に上書き**（思考だけで終わらせず、実際に出力に反映）

**差異の方向別の典型パターン:**
- 旗上げ > 統括表: 「(Xm×N)」表記の二重記録、「+」結合表記の重複、マルチページ二重記載
- 旗上げ < 統括表: 内配線・余長、ピット内、立上げ・立下げの読み落とし、特定ページの取りこぼし

### 検証2: 旗上げ合計 vs 統括表の照合（配管）
flagged_annotations の配管種別ごとに「length_m ÷ shared_conduit_count」（共入れの場合）または「length_m」（単独配管）を合計し、table_conduit_totals と比較。
再読トリガーと再読フローは検証1と同じ。**特に「+」結合の shared_conduit_count が 0 のままになっていないか必ず確認**。

### 検証3: 「+」結合表記の整合性
「+」で結合された全エントリの shared_conduit_count が結合ケーブル数と一致するか確認。
不一致があれば **必ず修正** して出力。

### 検証4: 既設区間の確認
統括表に FEP 管や「既設」記載がある場合、旗上げ側にも既設区間が記録されているか確認。
青色テキストの旗上げを見落としていないか再確認。

### 検証5: 区間の網羅性
電源元（受電盤・分電盤・キュービクル等）から EV 充電設備までの全経路が、旗上げの集合で途切れなく繋がっているか確認。
特定ページに記録が偏っていないかも併せて確認（マルチページ図面では特に重要）。

### 検証6: ページ番号の整合性（マルチページのみ）
flagged_annotations の各エントリに page フィールドが正しく設定されているか確認。
**page=0 や空欄、明らかに範囲外の値（解析ページ数を超える）がないか**。
ある場合は該当旗上げの位置を再確認して修正。`;
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

## 【特別注意】色関連チェックの判定について（共通ルール）
色判定は誤判定が発生しやすいため、**すべての色関連チェック**で以下の共通フローを必ず実行してください。

### 共通: Pass 1 データを最優先で参照
**画像のみで判定せず**、まず Pass 1 が抽出した以下フィールドを必ず参照:
- \`detected_info.is_color_drawing\`: 図面全体がカラーかモノクロか
- \`detected_info.color_observation_summary\`: 観測した色の網羅サマリ
- \`detected_info.color_legend_observed\`: 凡例の文言
- \`detected_info.wire_color_distinction\`: 配線ルート線の色配列
- \`detected_info.color_legend_location\`: 凡例の所在
- \`detected_info.hatching_colors_observed\`: ハッチング色の配列
- \`detected_info.hatching_locations\`: ハッチング所在・用途の配列

### 重要な共通注意事項
- **\`is_color_drawing=true\` のとき、すべての色関連チェックを「fail」にすることは矛盾**です。慎重に判定してください
- 「黒に見える線」でも、注意深く確認すると暗い赤・暗い青の場合があります。**安易にモノクロと断定しない**
- Pass 1 の各色フィールドに値が記録されている場合、それは Pass 1 で観測された事実です。fail にする前に必ず再確認してください
- \`found_text\` には Pass 1 の観測結果（色名・凡例文言・ハッチング情報）を必ず引用してください
- \`detail\` には判定マトリクスのどの行に該当するか（例：「凡例あり + 2色以上視認 → pass」）を明記してください

---

### mc_color_coding（配線ルートの色分けルール）判定マトリクス
**根拠フィールド**: \`color_legend_observed\`、\`wire_color_distinction\`、\`is_color_drawing\`

| 凡例 | 配線色 | status | 理由 |
|---|---|---|---|
| あり | 2色以上 | **pass** | マニュアル準拠 |
| あり | 1色のみ | **pass** | 凡例ベースの色分けは存在 |
| なし | 2色以上 | **pass** | 凡例なしだが実質的に色分けあり |
| あり | 0色（モノクロ） | **warn** | 凡例があるのに視認できない（印刷起因の可能性） |
| なし | 1色のみ | **warn** | 部分的な色分け |
| なし | 0色（モノクロ） | **fail** | 完全に色分けなし |

---

### mc_burial_hatching（埋設ハッチング色の適合性）判定マトリクス
**根拠フィールド**: \`hatching_colors_observed\`、\`hatching_locations\`、\`detected_info.surface_material\`
**マニュアル準拠色**: アスファルト/コンクリート=**赤**、土/砂利=**緑**

| 埋設区間 | ハッチング色 | status | 理由 |
|---|---|---|---|
| なし | - | **pass** | 該当なし（required: false の任意項目） |
| あり | 赤 OR 緑 を含む | **pass** | マニュアル準拠 |
| あり | 赤・緑以外（例: 黒、灰、青） | **warn** | 色不一致（マニュアル外） |
| あり | ハッチングなし or hatching_colors_observed=[] | **warn** | 色塗りが視認できない（印刷起因の可能性） |
| 不明 | - | **warn** | 埋設区間の有無が判別不能 |

---

### mc_cable_protector（ケーブルプロテクターの表記）判定マトリクス
**根拠フィールド**: \`hatching_colors_observed\`、\`hatching_locations\`
**マニュアル準拠色**: ケーブルプロテクター=**オレンジ**（CP2-60X3MBK 基準）

| プロテクター区間 | ハッチング色 | status | 理由 |
|---|---|---|---|
| なし | - | **pass** | 該当なし（required: false の任意項目） |
| あり | オレンジ OR 橙 を含む | **pass** | マニュアル準拠 |
| あり | オレンジ以外 | **warn** | 色不一致 |
| あり | ハッチングなし | **warn** | 色塗りが視認できない |

---

### new_existing_distinction（新設/既設の区別、目的地充電のみ）判定マトリクス
**根拠フィールド**: \`wire_color_distinction\`、\`color_legend_observed\`、\`is_color_drawing\`

| 既設設備 | 区別の手段 | status | 理由 |
|---|---|---|---|
| なし | - | **pass** | 該当なし（required: false） |
| あり | 配線色 2色以上 | **pass** | 色分けで区別 |
| あり | 凡例で色分け定義 | **pass** | 凡例で区別 |
| あり | ページ分離（複数ページで分ける） | **pass** | ページ分離で区別 |
| あり | 上記いずれもなし | **warn** | 区別が不明確 |

---

### mc_new_existing_prefix（設備ラベルの新設/既設プレフィックス表記）判定マトリクス
**根拠フィールド**: \`wire_color_distinction\`、\`color_legend_observed\`
**マニュアル準拠の意図**: 新設・既設を識別可能にすること（プレフィックス表記が標準手段だが、色分けも代替手段として許容される）

| 全設備プレフィックス | 色分け識別（赤=新設 / 青=既設） | status | 理由 |
|---|---|---|---|
| 全設備に付与 | - | **pass** | マニュアル明示準拠 |
| 一部欠落 | 配線色に「赤」または「青」を含む | **pass** | 色分けで識別の意図が明確（プレフィックス重複を省略しただけ） |
| 全設備で欠落 | 配線色に「赤」または「青」を含む | **warn** | 識別は機能するがマニュアル推奨表記から外れる |
| 全設備で欠落 | 色分けなし（モノクロ） | **fail** | 識別手段が一切ない |
| 不明 | - | **warn** | 判定不能 |

**重要な注意事項（過剰指摘抑止）:**
- **赤色で作図された設備に「新設」プレフィックスがない場合でも、色分けで識別できれば fail にしない**（pass または warn）
- 実務上、赤=新設・青=既設の慣習が確立しているため、プレフィックスは「冗長表記」として省略されることが多い
- Pass 1 の \`wire_color_distinction\` に「赤」「青」が記録されている場合、それは事実として識別手段が存在することを意味する

### 矛盾検出（自己整合性チェック — 必ず実行）
判定後に以下の矛盾がないか **自己チェック** してください。矛盾があれば再判定:
- **\`is_color_drawing=true\` なのに mc_color_coding=fail**: 色は観測されているのに色分けなしと判定 → 矛盾
- **\`hatching_colors_observed\` に色があるのに mc_burial_hatching=fail / mc_cable_protector=fail**: ハッチング色は観測されているのに該当チェック fail → 矛盾
- **\`wire_color_distinction\` が 2色以上なのに new_existing_distinction=fail**: 色での区別は観測されているのに区別なしと判定 → 矛盾
- **\`wire_color_distinction\` に「赤」または「青」を含むのに mc_new_existing_prefix=fail**: 色で新設/既設を識別できるのにプレフィックスなしを fail と判定 → 矛盾（過剰指摘）

矛盾を検出した場合は、当該チェックを最低でも warn に抑え、detail に「Pass 1 観測値との矛盾あり、要手動確認」を明記してください。

## 判定基準
- **pass**: 要件/ルールを満たしている
- **fail**: 必須項目で要件/ルールを満たしていない場合のみ使用
- **warn**: 記載はあるが不明瞭、または部分的にしか満たしていない
- **任意項目（必須: いいえ）のルール**: 該当しない場合は **pass**、該当するが不備がある場合は **warn**（failは使わない）

### 「推奨フォーマット系」項目の取り扱い（過剰指摘抑止）
スタイル・順序・推奨フォーマットを判定する項目（例: \`mc_summary_order\` 統括表の記載順序）は、
**情報自体の有無**と**推奨フォーマットへの準拠**を分けて判定してください:
- 必要情報自体の有無は別チェック（例: mc_summary_table / mc_summary_cable_breakdown）でカバーされている
- 本系統のチェックは **「推奨形式に従っているか」** のみを見るスタイル判定
- **必要情報が揃っていれば、推奨形式と異なっていても fail にせず warn 止まり**にすること
- description に「推奨」「望ましい」と記載されている項目、または required: false の項目は特にこの原則を厳守
- 「順序が違う」「並びが推奨と異なる」だけで fail を返してはいけない（過剰指摘の典型パターン）

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
    let bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    // チャンク単位で変換（大きなPDFでのスタックオーバーフロー防止）
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);

    // 【候補3: メモリ明示解放】
    //   btoa 完了後、中間変数 (PDFサイズと同等のメモリを消費) は不要。
    //   ローカル変数なので関数終了時に GC 対象だが、このあと size check を挟むため明示的に解放。
    //   主な効果: 2パス方式で2回呼ばれた場合の累積メモリ圧を抑制。
    binary = null;
    bytes = null;

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

  // ─── 遅延ヘルパー（リトライ用）──────────────────
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Gemini API リトライラッパ ─────────────────
  // 【設計契約】
  //   callGemini を包み、一時的なエラーに対して自動リトライを行う。
  //   ユーザー視点では「たまに詰まる Gemini」が「透明に回復する」挙動になる。
  //
  // 【リトライポリシー】
  //   ・server_overload (503/500/high demand/overloaded) → 指数バックオフ 2s/4s/8s、最大3回
  //   ・quota_exceeded (429) with retryAfterSec          → サーバー指定秒数 +1s 待機、1回のみ
  //   ・ネットワーク接続エラー                              → 2s/4s、最大2回
  //   ・その他（400系/JSONパース失敗/APIキー無効）        → リトライせず即 throw
  //
  // 【リトライしない理由（設計判断）】
  //   ・400/401/403 は改善不能（キー無効・リクエスト不正）
  //   ・parse_error はレスポンス自体が壊れており、再試行しても同じ失敗になる確率が高い
  //   ・quota_exceeded で retryAfterSec 不明の場合、サーバー指示なしにリトライすると
  //     ストーム化してさらにレート制限を悪化させる
  //
  // 【エラー継承】
  //   最終的に throw する際は、callGemini から受け取った元の err オブジェクトを
  //   そのまま投げる（.type, .suggestions, .retryAfterSec 等が app.js で参照されるため）。
  //
  // 【進捗通知】
  //   onProgress が渡されていれば passContext (pass, total) を引き継いだうえで
  //   retry: true フラグ付きで呼び出す。UI 側はメッセージだけ更新する実装で良い。
  async function callGeminiWithRetry(apiKey, images, prompt, modelId, onProgress, passContext) {
    const MAX_TRANSIENT = 3;
    const MAX_QUOTA = 1;
    const MAX_NETWORK = 2;
    let transientCount = 0;
    let quotaCount = 0;
    let networkCount = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await callGemini(apiKey, images, prompt, modelId);
      } catch (err) {
        // サーバー高負荷 → 指数バックオフ
        if (err.type === 'server_overload' && transientCount < MAX_TRANSIENT) {
          transientCount++;
          const waitMs = 2000 * Math.pow(2, transientCount - 1); // 2000, 4000, 8000
          const waitSec = Math.round(waitMs / 1000);
          console.warn(`[Gemini] サーバー高負荷 (${err.statusCode || '?'})、${waitSec}秒後に再試行 (${transientCount}/${MAX_TRANSIENT})`);
          if (onProgress && passContext) {
            onProgress({
              ...passContext,
              message: `サーバー応答待機中... ${waitSec}秒後に再試行 (${transientCount}/${MAX_TRANSIENT})`,
              retry: true,
              retryReason: 'server_overload',
            });
          }
          await sleep(waitMs);
          continue;
        }

        // クォータ超過で retryAfterSec が判明 → 1回だけ指定時間待機リトライ
        //
        // 【設計契約 / 0値ガード】
        //   err.retryAfterSec は Math.ceil(parseFloat(...)) または null のいずれか。
        //   素朴に `&& err.retryAfterSec` と書くと、Gemini が "retry in 0s" を返したときに
        //   0 が falsy 扱いされてリトライが silently スキップされる。
        //   semantically には「0秒待機→即時リトライ」が正しい挙動なので、
        //   `typeof === 'number' && >= 0` で明示的にゼロ許容する。
        //   （null/undefined はリトライしない = サーバー指示なしでのストーム回避）
        if (err.type === 'quota_exceeded'
            && typeof err.retryAfterSec === 'number'
            && err.retryAfterSec >= 0
            && quotaCount < MAX_QUOTA) {
          quotaCount++;
          const waitMs = (err.retryAfterSec + 1) * 1000; // +1 秒の余裕
          const waitSec = Math.ceil(waitMs / 1000);
          console.warn(`[Gemini] レート制限、${waitSec}秒後に再試行 (${quotaCount}/${MAX_QUOTA})`);
          if (onProgress && passContext) {
            onProgress({
              ...passContext,
              message: `レート制限のため ${waitSec}秒後に再試行中... (${quotaCount}/${MAX_QUOTA})`,
              retry: true,
              retryReason: 'quota_exceeded',
            });
          }
          await sleep(waitMs);
          continue;
        }

        // ネットワーク接続エラー → 短い backoff
        // callGemini は networkErr を 'ネットワーク接続エラー: ...' で throw するのでメッセージで判別
        if (err.message && err.message.indexOf('ネットワーク接続エラー') === 0 && networkCount < MAX_NETWORK) {
          networkCount++;
          const waitMs = 2000 * networkCount; // 2000, 4000
          const waitSec = Math.round(waitMs / 1000);
          console.warn(`[Gemini] ネットワークエラー、${waitSec}秒後に再試行 (${networkCount}/${MAX_NETWORK})`);
          if (onProgress && passContext) {
            onProgress({
              ...passContext,
              message: `ネットワークエラー、${waitSec}秒後に再試行 (${networkCount}/${MAX_NETWORK})`,
              retry: true,
              retryReason: 'network',
            });
          }
          await sleep(waitMs);
          continue;
        }

        // リトライ対象外 → 元のエラーをそのまま再スロー
        throw err;
      }
    }
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

    // ─── モデル別の最大出力トークン数 ───────────────
    // 【設計契約 / Gemini 2.5 thinking tokens を考慮したサイジング】
    //   Gemini 2.5 Flash/Pro は暗黙的な内部推論 (thinking) を実行し、
    //   thinking tokens は maxOutputTokens バジェットを消費する。
    //   ・2.5 Pro は thinking を完全に無効化できない（thinkingBudget=0 は Flash のみ対応）
    //   ・Dynamic thinking で最大 ~24K (Flash) / ~32K (Pro) 消費することがある
    //
    //   実測（リアル図面ベース）:
    //     Pass 1 出力 (JSON): ~6,000-10,000 tokens (旗上げ多数 + detected_info 16項目)
    //     Pass 2 出力 (JSON): ~5,000-8,000  tokens (51 check items × 日本語60-350文字)
    //     Thinking (内部):    ~3,000-10,000 tokens (タスク複雑度で変動)
    //
    //   → 合計 ~15K-25K が現実的。32K マージンで 2.5 Pro の複雑図面にも対応。
    //   以前は 65K を割り当てていたが、冗長 budget は推論遅延・サーバー負荷の原因。
    //   32K は 65K の半分で負荷軽減しつつ thinking を吸収できる実用サイズ。
    //
    //   【MAX_TOKENS 到達時の挙動】
    //     finishReason === 'MAX_TOKENS' が返る。本コードでは下記の2経路で明示処理:
    //       a) text が空のまま返る場合 → 直接 parse_error に type 化（L1077 前の新規分岐）
    //       b) JSON が途中で切れて text ありだがパース失敗 → JSON.parse catch で parse_error
    //     どちらも app.js の parse_error カードで原因と対処が表示される。
    const maxTokensByModel = {
      'gemini-2.5-pro':   32768,  // thinking tokens 分を確保（thinking 無効化不可）
      'gemini-2.5-flash': 32768,  // 同上（thinking は dynamic で変動）
      'gemini-2.0-flash': 8192,   // 2.0 は thinking なし。維持。
    };
    const maxOutputTokens = maxTokensByModel[useModel] || 32768;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            ...imageParts,
          ]
        }
      ],
      // ─── 決定論的デコーディング設定 ───────────────
      // 【設計契約 / 抽出タスクの再現性保証】
      //   本アプリの主タスクは「PDF図面からの数値抽出」であり、
      //   同じ入力に対しては同じ出力が返ることを期待する（ユーザー観測上の再現性）。
      //
      //   ・temperature=0    : 確率的サンプリングを完全無効化（常に最尤トークンを選ぶ）
      //   ・topK=1           : トップ1候補のみを候補集合にする（完全貪欲）
      //
      //   【topP を意図的に指定しない理由】
      //     初期案では topP=0 も併記していたが、以下の理由で削除:
      //       1) temperature=0 + topK=1 の時点で候補集合は常に「トップ1」確定。
      //          topP=0 を重ねても情報は増えず、純粋に冗長。
      //       2) 一部の Gemini バックエンドで topP=0 がバリデーションエラー
      //          （"topP must be > 0"）として拒絶される事例報告がある。
      //          拒絶されるとリクエスト全体が 400 で失敗し、リトライでも復旧しない。
      //       3) Google 公式の "deterministic decoding" サンプルも
      //          temperature=0 + topK=1 のみで topP は触らない流儀。
      //     → API 拒絶リスクを避けるため、未指定でデフォルトに任せる。
      //
      //   【以前の設定（temperature=0.1）からの変更】
      //     温度 0.1 は「ほぼ決定論的だが稀にブレる」領域。抽出タスクでは
      //     ブレは純粋にノイズ（創造性は不要）なので 0 に固定する。
      //     ユーザーから「同じ図面で 1 回目と 2 回目の結果が異なる」という
      //     レビューがあり、これを解消するための変更。
      //
      //   【副作用】
      //     ・Gemini が偶然にも誤読に収束した場合、同じ誤読を再現する。
      //       → しかし誤読は別途 detectDiscrepancies で警告されるので検出可能。
      //     ・"多様性のあるコメント" は生成しづらくなる（overall_comment がやや定型化）。
      //       → 抽出精度の再現性の方が本タスクでは重要と判断。
      generationConfig: {
        temperature: 0,
        topK: 1,
        maxOutputTokens,
      },
    };

    // 【候補3: メモリ明示解放】
    //   JSON.stringify は PDFサイズと同等の巨大な文字列を生成する。
    //   fetch に渡した後は bodyStr の参照を null にして GC 対象化する。
    //   (requestBody / imageParts の中の base64 も、これで参照カウントが下がる)
    let bodyStr = JSON.stringify(requestBody);

    let response;
    try {
      // 【候補2: no-cache 化】
      //   キャッシュを経由させずに毎回オリジン直行させる。
      //   ・cache: 'no-store'   : fetch API レベルで HTTP キャッシュを一切使わない
      //   ・Cache-Control ヘッダ: 中間プロキシ・ブラウザキャッシュへの要求
      //   【限界】 `Connection: close` は fetch では forbidden header のため設定不可。
      //    HTTP/2 コネクションプールの詰まりは完全には回避できないが、
      //    少なくともキャッシュ由来の 503 リプレイは防げる。
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache',
          },
          cache: 'no-store',
          body: bodyStr,
        }
      );
    } catch (networkErr) {
      // body は送信失敗時にも参照不要
      bodyStr = null;
      throw new Error('ネットワーク接続エラー: インターネット接続を確認してください。');
    }

    // 送信完了 → 巨大 body 文字列を即時解放（await fetch 戻り後は不要）
    bodyStr = null;

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || '';
      const status = response.status;

      // クォータ超過（429）の検知と分類
      // 【M2 修正】メッセージ検知は大小文字非依存にする。
      //   Google が将来 "Quota Exceeded" や全大文字 "QUOTA" 等に変更しても
      //   detection を取りこぼさないよう toLowerCase() で正規化する。
      //   主検知は status === 429 だがフォールバックとしてメッセージも確認。
      if (status === 429 || errMsg.toLowerCase().includes('quota')) {
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
        // 【M1 修正】retrySec=0 を落とさず suggestion メッセージ化する。
        //   素朴に `if (retrySec)` と書くと 0 が falsy でスキップされ、
        //   retry ロジック（callGeminiWithRetry の `typeof === 'number' && >= 0` ガード）
        //   とメッセージ側で挙動が分裂していた。両者を揃える。
        //   0秒は「すぐに再試行可能」の意味（Gemini サーバー側でレート制限が既に解除済み）。
        if (typeof retrySec === 'number' && retrySec >= 0) {
          err.suggestions.push(
            retrySec === 0
              ? 'すぐに再試行可能です（レート制限は解除されています）'
              : `約${retrySec}秒後に再試行可能です`
          );
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

    // ─── MAX_TOKENS: 空テキストのケースを明示的に parse_error へ分岐 ───────────────
    // 【設計契約 / Gemini 2.5 thinking tokens との相互作用】
    //   Gemini 2.5 系は内部推論 (thinking) が maxOutputTokens バジェットを消費する。
    //   極端なケースでは thinking だけでバジェットを使い切り、
    //   finishReason='MAX_TOKENS' で text が空のまま返ることがある。
    //
    //   この分岐がない場合:
    //     ・!text の generic Error（untyped）にフォールスルー
    //     ・app.js 側で type 不明扱い → 汎用 "予期せぬエラー" カードになり
    //       ユーザーは「なぜ失敗したか・どう対処すべきか」が分からない
    //
    //   この分岐があることで:
    //     ・err.type='parse_error' に型付けされ、app.js の parse_error カードへ誘導
    //     ・カードには「モデル変更 / 再試行」が対処として明示される
    //     ・err.finishReason/err.model を添えてログで原因特定を容易化
    //
    //   【補足】 text 非空で MAX_TOKENS（JSON 途中切れ）は下の JSON.parse catch 経路で
    //   既に parse_error に型付けされる。ここは空テキスト専用の先回り分岐。
    if (!text && finishReason === 'MAX_TOKENS') {
      const err = new Error(
        `Gemini の応答がトークン上限 (${maxOutputTokens}) に達し、本文が空で返されました。` +
        `内部推論 (thinking) がバジェットを使い切った可能性があります。` +
        `モデルを変更するか、しばらく待ってから再試行してください。`
      );
      err.type = 'parse_error';
      err.finishReason = finishReason;
      err.model = useModel;
      throw err;
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

  // ─── 色関連チェックの自己矛盾検出（多項目サニティチェック）──────
  // 【設計契約 / Pass 1 と Pass 2 の判定整合性を強制】
  //   背景: Pass 1 の detected_info で色情報（配線色・凡例・ハッチング色・全体カラー判定）を
  //   観測しているにもかかわらず、Pass 2 が画像のみで「白黒図面」「色分けなし」と判定して
  //   色関連チェック（mc_color_coding / mc_burial_hatching / mc_cable_protector /
  //   new_existing_distinction）を fail にする false-fail のレビュー報告がある。
  //
  //   本関数は Pass 1 と Pass 2 の判定を突き合わせ、矛盾があれば status を warn に降格する：
  //     ・mc_color_coding:           wire_color / 凡例 / is_color_drawing / hatching の何らかの色観測あり
  //     ・mc_burial_hatching:        hatching_colors_observed に「赤」「緑」を含む観測あり
  //     ・mc_cable_protector:        hatching_colors_observed に「オレンジ」「橙」を含む観測あり
  //     ・new_existing_distinction:  wire_color_distinction が 2 色以上 OR 凡例あり
  //     ・mc_new_existing_prefix:    wire_color_distinction に「赤」または「青」を含む（過剰指摘抑止）
  //                                   赤=新設・青=既設の慣習が確立しているため、プレフィックス省略は
  //                                   「冗長表記の省略」として許容される。色分けで識別可能なら fail にしない。
  //
  //   降格のみ実装（昇格はしない）:
  //     ・false-fail（誤って不合格にする）を防ぐのが目的
  //     ・false-pass（本来モノクロなのに pass にする）は別問題で、Pass 1 が fail を返したケース
  //       なら Pass 2 が pass しても本関数は介入しない（矛盾検出の対象外）
  //
  //   【副作用】
  //     ・geminiResult.manual_results / nev_results 内の対象エントリを直接ミューテートする
  //       （new_existing_distinction は NeV 側、その他は manual 側に存在）
  //       → 後続の aggregateManualResults / aggregateNevResults はミューテート後の値を読む
  //     ・元のステータスを残すため original_status フィールドを追加（デバッグ・監査用）
  //
  //   【戻り値】 { downgrades: [{ id, reason }], count: number }（ログ・テレメトリ用途）
  function applyColorRelatedSanityCheck(geminiResult) {
    const detectedInfo = geminiResult.detected_info || {};
    const manualResults = geminiResult.manual_results || [];
    const nevResults    = geminiResult.nev_results    || [];

    // Pass 1 の色観測フィールドを抽出
    const legend = (detectedInfo.color_legend_observed || '').trim();
    const wireColors = Array.isArray(detectedInfo.wire_color_distinction)
      ? detectedInfo.wire_color_distinction.filter(c => c && String(c).trim()).map(String)
      : [];
    const hatchingColors = Array.isArray(detectedInfo.hatching_colors_observed)
      ? detectedInfo.hatching_colors_observed.filter(c => c && String(c).trim()).map(String)
      : [];
    const isColorDrawing = detectedInfo.is_color_drawing === true;
    const colorSummary = (detectedInfo.color_observation_summary || '').trim();

    // ヘルパー: id でエントリを検索（manual と nev の両方を見る）
    const findResult = (id) => (
      manualResults.find(r => r && r.id === id) || nevResults.find(r => r && r.id === id) || null
    );

    // ヘルパー: 降格処理（fail のみ対象、observation は理由文字列）
    const downgrade = (target, observation) => {
      target.original_status = target.status;
      target.status = 'warn';
      target.detail = (
        `[自動降格 fail→warn] Pass 1 で色情報を観測（${observation}）したにもかかわらず、` +
        `Pass 2 が「色分け/色塗りなし」と判定したため、判定不整合と見なし warn に降格しました。` +
        `元の判定理由: ${target.detail || '（詳細なし）'}。` +
        `お手元の図面で色分け/ハッチングを直接ご確認ください。`
      );
    };

    const downgrades = [];

    // ── 1. mc_color_coding（配線ルートの色分けルール）──
    const cc = findResult('mc_color_coding');
    if (cc && cc.status === 'fail') {
      const obs = [];
      if (legend.length > 0)        obs.push(`凡例: 「${legend}」`);
      if (wireColors.length > 0)    obs.push(`配線色: [${wireColors.join(', ')}]`);
      if (hatchingColors.length > 0) obs.push(`ハッチング色: [${hatchingColors.join(', ')}]`);
      if (isColorDrawing)           obs.push('is_color_drawing=true');
      if (colorSummary && (legend.length || wireColors.length || hatchingColors.length || isColorDrawing)) {
        obs.push(`観測サマリ: 「${colorSummary}」`);
      }
      if (obs.length > 0) {
        downgrade(cc, obs.join(' / '));
        downgrades.push({ id: 'mc_color_coding', reason: obs.join(' / ') });
      }
    }

    // ── 2. mc_burial_hatching（埋設ハッチング色）──
    //   赤=アスファルト/コンクリート、緑=土/砂利。これらが Pass 1 で観測されていれば降格対象。
    const bh = findResult('mc_burial_hatching');
    if (bh && bh.status === 'fail') {
      const burialKeywords = ['赤', '緑', 'アスファルト', 'コンクリート', '土', '砂利'];
      const matched = hatchingColors.filter(c => burialKeywords.some(k => c.includes(k)));
      if (matched.length > 0) {
        downgrade(bh, `埋設関連ハッチング色: [${matched.join(', ')}]`);
        downgrades.push({ id: 'mc_burial_hatching', reason: matched.join(', ') });
      }
    }

    // ── 3. mc_cable_protector（ケーブルプロテクター色）──
    //   オレンジ/橙が Pass 1 で観測されていれば降格対象。
    const cp = findResult('mc_cable_protector');
    if (cp && cp.status === 'fail') {
      const protectorKeywords = ['オレンジ', '橙'];
      const matched = hatchingColors.filter(c => protectorKeywords.some(k => c.includes(k)));
      if (matched.length > 0) {
        downgrade(cp, `プロテクター色: [${matched.join(', ')}]`);
        downgrades.push({ id: 'mc_cable_protector', reason: matched.join(', ') });
      }
    }

    // ── 4. new_existing_distinction（新設/既設の区別、NeV 側）──
    //   配線色 2 色以上、または凡例で色分けが定義されていれば降格対象。
    const ned = findResult('new_existing_distinction');
    if (ned && ned.status === 'fail') {
      const obs = [];
      if (wireColors.length >= 2) obs.push(`配線色 2 色以上: [${wireColors.join(', ')}]`);
      if (legend.length > 0)      obs.push(`凡例: 「${legend}」`);
      if (obs.length > 0) {
        downgrade(ned, obs.join(' / '));
        downgrades.push({ id: 'new_existing_distinction', reason: obs.join(' / ') });
      }
    }

    // ── 5. mc_new_existing_prefix（設備ラベルの新設/既設プレフィックス、Manual 側）──
    //   過剰指摘抑止: 赤=新設・青=既設の慣習が確立しているため、配線色に「赤」または「青」が
    //   観測されていればプレフィックス省略は識別意図が明確と判断し、fail を warn に降格する。
    //   凡例で色分けが定義されている場合も同様（凡例ベースの識別が機能している）。
    //   降格条件:
    //     ・wire_color_distinction に「赤」「青」「red」「blue」のいずれかの色名を含む
    //     ・OR  color_legend_observed に「赤」「青」を含む（凡例ベースの識別）
    const nep = findResult('mc_new_existing_prefix');
    if (nep && nep.status === 'fail') {
      const colorKeywords = ['赤', '青', 'red', 'blue', 'Red', 'Blue', 'RED', 'BLUE'];
      const matchedColors = wireColors.filter(c => colorKeywords.some(k => c.includes(k)));
      const legendHasNewExistingColor = colorKeywords.some(k => legend.includes(k));
      const obs = [];
      if (matchedColors.length > 0) obs.push(`新設/既設識別色: [${matchedColors.join(', ')}]`);
      if (legendHasNewExistingColor) obs.push(`凡例に色分け定義: 「${legend}」`);
      if (obs.length > 0) {
        downgrade(nep, obs.join(' / '));
        downgrades.push({ id: 'mc_new_existing_prefix', reason: obs.join(' / ') });
      }
    }

    return { downgrades, count: downgrades.length };
  }

  // ─── 種別名正規化（キー比較用）──────────────────
  // 【設計契約】本関数はツール全体で使用される「唯一の」種別キー正規化器である。
  //   ・checker.js 内部（detectDiscrepancies / mergeTotals / 旗上げ集計）で使用
  //   ・app.js からは DrawingChecker.normalizeKey 経由で参照され、normalizeType として委譲
  //   → 分裂させないこと。正規化ルールを変更する場合は本関数のみ修正し、
  //     app.js 側は自動的に追随する（delegation pattern）。
  //
  // 【正規化ルール】
  //   1. 空白（半角/全角/タブ/改行等）を除去
  //   2. 乗算記号・x・全角Ｘ を統一（"CV8sq×3C" ≡ "CV8sqx3C" ≡ "CV8sqＸ3C"）
  //      ※ /gi で半角X/xも一時 'x' に落とし、最後の toUpperCase で 'X' に収束
  //   3. 各種ダッシュ（全角ハイフン・マイナス・emダッシュ等）を ASCII '-' に統一
  //   4. 大文字化（"3c" ≡ "3C"、"pfd" ≡ "PFD"）
  //
  // 【改変時の注意】
  //   ・ここを変えると mergeTotals のキー衝突挙動が変わる → 必ず detectDiscrepancies の
  //     警告件数・compareTable のマージ件数がゼロ件以上増減していないか回帰テスト
  //   ・normalizeType（app.js）との分裂を防ぐため、app.js 側の委譲が外れていないか
  //     periodic に確認すること
  function normalizeKey(str) {
    if (!str) return '';
    return str
      .replace(/\s+/g, '')          // 空白除去
      .replace(/[×xＸ]/gi, 'x')      // ×/x/Ｘ を一旦 'x' に統一
      .replace(/[ー−–—]/g, '-')     // 各種ダッシュを ASCII ハイフンに
      .toUpperCase();                // 大文字統一（'x' は 'X' に収束）
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

  // ─── 配管共入れパターン解析（共入れ由来の差異識別用）───
  // 【目的】
  //   flagged_annotations を配管種別ごとに解析し、共入れ（複数ケーブル種別が
  //   同一配管を共有）のパターン指標を返す。
  //   比較テーブルで「旗上げ > 統括表」となった差異が、共入れ由来の二重計上か
  //   別原因（Gemini誤読・読み落とし等）かを app.js が識別するための材料。
  //
  // 【背景 — なぜ必要か】
  //   shared_conduit_count は「CV22sq-2C+IV5.5sq」のような + 表記（同一旗上げ内の
  //   並走）しか捕捉できない。統括表で「※1」「(共入れ2)」として示される
  //   ケーブル種別間の配管共有は旗上げ単独では判別できず、recalcConduit では
  //   同一物理配管を二重計上する（例: Honda cars岐阜中央 PFD-36 14m→20m）。
  //
  // 【判定ロジック — app.js 側で使う条件】
  //   旗上げ > 統括表 かつ 以下の両方が真なら「共入れ由来の可能性」を表示:
  //     ・ cableTypes.size >= 2（複数ケーブル種別がこの配管を使用）
  //     ・ hasPlusSharing（+ 表記由来の shared_conduit_count > 1 が1件以上ある）
  //   hasStandalone（shared_conduit_count == 0 のエントリ）も補足情報として保持。
  //
  // 【副作用なし】
  //   annotations は読み取り専用。既存の recalc/detectDiscrepancies には一切干渉しない。
  function analyzeConduitSharing(annotations) {
    const analysis = {};
    (annotations || []).forEach(a => {
      if (!a.conduit_type) return;
      const key = normalizeKey(a.conduit_type);
      if (!key) return;
      if (!analysis[key]) {
        analysis[key] = {
          displayName: a.conduit_type,
          cableTypes: new Set(),
          hasPlusSharing: false,   // shared_conduit_count > 1 のエントリあり
          hasStandalone: false,    // shared_conduit_count == 0 のエントリあり
          entryCount: 0,
        };
      }
      const info = analysis[key];
      info.entryCount++;
      if (a.cable_type) {
        const ck = normalizeKey(a.cable_type);
        if (ck) info.cableTypes.add(ck);
      }
      const shared = Number(a.shared_conduit_count) || 0;
      if (shared > 1) info.hasPlusSharing = true;
      else info.hasStandalone = true;
    });
    // Set は JSON シリアライズされないので配列＋サイズに変換しつつ
    // displayNameMap も作って app.js から使いやすくする
    const result = {};
    Object.keys(analysis).forEach(k => {
      const v = analysis[k];
      result[k] = {
        displayName: v.displayName,
        cableTypeCount: v.cableTypes.size,
        hasPlusSharing: v.hasPlusSharing,
        hasStandalone: v.hasStandalone,
        entryCount: v.entryCount,
      };
    });
    return result;
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
  //   3. 戻り値の warning は { kind, type, severity, tableValue, countedValue, message, hint } 形を満たす
  //      hint は annotations が渡された場合に組み立てられる説明文（オプション、空文字許容）
  //   4. severity は 'diff' | 'missing_in_counted' | 'missing_in_table' のいずれか
  //   5. 同一 severity・同一 type の重複は normalizeKey による同一キー化で自然に排除される
  //   6. annotations 引数は読み取り専用。hint 生成のためだけに参照する
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

  // ─── 警告メッセージ用の hint 生成 ───────────────────
  // 【目的】
  //   detectDiscrepancies の警告に「ユーザーが原因切り分けに使えるヒント」を付与。
  //   message は事実（数値の差異）のみを表記し、hint は推測ベースの調査ガイドとして分離。
  //
  // 【生成ロジック】
  //   1) 該当種別の旗上げを抽出（ケーブル種別 or 配管種別の typeKey 一致）
  //   2) 1〜2 桁の小さい数値が含まれていれば「Gemini 誤読の可能性」を提示
  //   3) ページ番号が複数 / 不在ならマルチページ取りこぼし示唆
  //   4) severity 別の典型原因（読み落とし / 二重カウント等）を提示
  //
  // 【副作用なし】 annotations / 既存の警告は不変。
  function buildDiscrepancyHint(typeKey, severity, annotations, kindLabel) {
    const isWire = kindLabel === '配線';
    const related = (annotations || []).filter(a => {
      const tk = normalizeKey(isWire ? a.cable_type : a.conduit_type);
      return tk && tk === typeKey;
    });

    const hints = [];

    // 1〜2 桁数値（< 5m）の存在確認 — Gemini 誤読の典型対象
    const smallNumberCount = related.filter(a => {
      const v = Number(a.length_m) || 0;
      return v > 0 && v < 5;
    }).length;
    if (smallNumberCount > 0) {
      hints.push(
        `小さい数値（5m未満）の旗上げが ${smallNumberCount} 件含まれます。` +
        `Gemini は 1〜2 桁の数値（3↔8、1↔7、13↔18 等）を誤読する傾向があるため、該当区間の手動確認を推奨します。`
      );
    }

    // ページ分布 — マルチページ取りこぼし検出のヒント
    const pageSet = new Set();
    let missingPageCount = 0;
    related.forEach(a => {
      const p = Number(a.page) || 0;
      if (p > 0) pageSet.add(p);
      else missingPageCount++;
    });
    if (pageSet.size >= 2) {
      const sorted = [...pageSet].sort((x, y) => x - y);
      hints.push(`該当旗上げの所在ページ: ${sorted.join(', ')}。これらのページの旗上げを優先的に再確認してください。`);
    } else if (pageSet.size === 1) {
      hints.push(`該当旗上げは page ${[...pageSet][0]} に集中しています。他ページに同種別の旗上げが取りこぼされていないか確認してください。`);
    } else if (missingPageCount > 0 && related.length > 0) {
      hints.push(`該当旗上げ ${related.length} 件にページ情報が記録されていません。マルチページ図面の場合、ページ取りこぼしの可能性があります。`);
    }

    // severity 別の典型原因
    if (severity === 'missing_in_counted') {
      hints.push(`旗上げ側の読み落とし候補: 内配線・余長、ピット内、立上げ・立下げ、配管端部の短区間。`);
    } else if (severity === 'missing_in_table') {
      hints.push(`原因候補: ① 統括表側の読み落とし、② 旗上げの二重記録（(Xm×N) 表記、+ 結合表記、マルチページ二重記載）。`);
    } else if (severity === 'diff') {
      hints.push(`原因候補: 旗上げの桁誤読、(Xm×N) 表記の解釈ミス、共入れ配管の shared_conduit_count 設定漏れ。`);
    }

    return hints.join(' ');
  }

  // ─── 統括表 confidence ベースの警告検出 ─────────────
  // 【目的】
  //   Pass 1 が confidence='low' / 'unreadable' を返したセルを警告化。
  //   従来の detectDiscrepancies は数値差分のみを見るため、
  //   「Gemini が読み取れなかった」事実そのものを表面化できなかった。
  //
  // 【設計契約】
  //   1. 副作用なし（tableTotals は読み取り専用）
  //   2. severity='low_confidence' は detectDiscrepancies の severity 群と排他的に扱う
  //      （重複警告を避けるため、detectDiscrepancies 側で同 typeKey をスキップ）
  //   3. message は事実、hint は調査ガイドの分担を維持
  //
  // 【ハルシネーション抑止との連携】
  //   Pass 1 プロンプトで「推測値で穴埋めせず confidence='low' を返す」よう指示している。
  //   その結果として返された low/unreadable を本関数が拾い、ユーザーへ可視化する。
  function detectLowConfidenceWarnings(tableTotals, kindLabel) {
    const warnings = [];
    (tableTotals || []).forEach(t => {
      if (!t || !t.type) return;
      const conf = String(t.confidence || '').toLowerCase();
      if (conf !== 'low' && conf !== 'unreadable') return;

      const isUnreadable = conf === 'unreadable';
      const numVal = Number(t.total_length_m);
      const hasValue = !isUnreadable && Number.isFinite(numVal);
      const valueDisplay = isUnreadable
        ? '読み取り不能'
        : hasValue ? `${numVal}m（信頼度低）` : '数値なし';

      const sourcePage = Number(t.source_page) || 0;
      const pageHint = sourcePage > 0 ? `（該当ページ: ${sourcePage}）` : '';

      warnings.push({
        kind: kindLabel,
        type: t.type,
        severity: 'low_confidence',
        tableValue: hasValue ? numVal : null,
        countedValue: null,
        confidence: conf,
        sourcePage: sourcePage || null,
        message: `${kindLabel}「${t.type}」: 統括表の値の信頼度が低い (confidence=${conf}, ${valueDisplay})`,
        hint: (
          isUnreadable
            ? `Gemini が統括表のこのセルを読み取れませんでした。原本の統括表で「${t.type}」の値を直接ご確認ください。${pageHint}`
            : `Gemini が読み取りに自信を持てませんでした。原本の統括表で「${t.type}」の値を直接ご確認ください。${pageHint}`
        ),
      });
    });
    return warnings;
  }

  function detectDiscrepancies(tableTotals, countedTotals, kindLabel, annotations) {
    const warnings = [];
    const tableMap = {};
    const countedMap = {};
    // confidence='low' / 'unreadable' のキーは detectLowConfidenceWarnings 側で
    // 既に専用警告が発火されるため、本関数では重複警告を避けるためスキップする。
    const lowConfidenceKeys = new Set();
    (tableTotals || []).forEach(t => {
      if (!t || !t.type) return;
      const conf = String(t.confidence || '').toLowerCase();
      if (conf === 'low' || conf === 'unreadable') {
        const k = normalizeKey(t.type);
        if (k) lowConfidenceKeys.add(k);
      }
    });
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
      // 両方に存在する
      //   【設計契約 / severity 分類ロジック】
      //   ・tableMap / countedMap は「キー登録されているだけで truthy なオブジェクト」なので、
      //     value=0 のまま登録されている場合がある（Gemini が 0m を明示返却したケース）。
      //   ・よって、素朴に `if (t && c)` で両方存在扱いすると、片方が 0 の場合に
      //     severity='diff' が発火してしまう（正しくは missing_in_* ）。
      //   ・以下では、両方 0 は無害として無視、片方だけ 0 のケースは missing_in_* に振り分け、
      //     両方 >0 かつ閾値超のケースのみ 'diff' として警告する。
      //   ・この分岐順は厳密に守ること（エラーチェック時の優先順位）。
      // 統括表側が low/unreadable confidence の場合は detectLowConfidenceWarnings が
      // 既に専用警告を発火しているため、ここでは重複警告を避けてスキップ。
      if (lowConfidenceKeys.has(k)) return;

      if (t && c) {
        // Case A: 両方とも 0m — 実質データなし、警告不要
        if (t.value === 0 && c.value === 0) return;
        // Case B: 統括表側が 0m（実質未記載） → missing_in_table 扱い
        //   「旗上げでは検出されているのに統括表に記載なし」と同じ意味
        if (t.value === 0 && c.value > 0) {
          warnings.push({
            kind: kindLabel,
            type: c.type || t.type,
            severity: 'missing_in_table',
            tableValue: 0,
            countedValue: c.value,
            message: `${kindLabel}「${c.type || t.type}」: 旗上げから${c.value}m検出されたが統括表に記載なし（統括表側の読み落とし疑い）`,
            hint: buildDiscrepancyHint(k, 'missing_in_table', annotations, kindLabel),
          });
          return;
        }
        // Case C: 旗上げ側が 0m（実質未検出） → missing_in_counted 扱い
        //   「統括表には記載があるのに旗上げから検出できない」と同じ意味
        if (c.value === 0 && t.value > 0) {
          warnings.push({
            kind: kindLabel,
            type: t.type || c.type,
            severity: 'missing_in_counted',
            tableValue: t.value,
            countedValue: 0,
            message: `${kindLabel}「${t.type || c.type}」: 統括表に${t.value}m記載ありだが旗上げから検出されず（読み落とし疑い）`,
            hint: buildDiscrepancyHint(k, 'missing_in_counted', annotations, kindLabel),
          });
          return;
        }
        // Case D: 両方 >0 — 通常の差分判定（絶対値 AND 相対値の両閾値超のみ警告）
        const diff = Math.abs(t.value - c.value);
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
            hint: buildDiscrepancyHint(k, 'diff', annotations, kindLabel),
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
          hint: buildDiscrepancyHint(k, 'missing_in_counted', annotations, kindLabel),
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
          hint: buildDiscrepancyHint(k, 'missing_in_table', annotations, kindLabel),
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
    // 【候補1: 自動リトライ】
    //   callGeminiWithRetry は 503/500/429(retry-after 付き)/ネットワークエラーを
    //   透明に自動リトライする。passContext を渡すことで、リトライ中のメッセージも
    //   pass/total 情報を保持した形で UI に流れる。
    const pass1Context = { pass: 1, total: 2 };
    if (onProgress) onProgress({ ...pass1Context, message: '統括表・旗上げ・配線データを読み取り中...' });
    const pass1Prompt = buildPass1Prompt(type);
    const pass1Result = await callGeminiWithRetry(apiKey, images, pass1Prompt, modelId, onProgress, pass1Context);

    // ── Pass 2: NeV要件・マニュアル準拠の合否判定 ──
    const pass2Context = { pass: 2, total: 2 };
    if (onProgress) onProgress({ ...pass2Context, message: 'NeV要件・マニュアル準拠を判定中...' });
    const pass2Prompt = buildPass2Prompt(type, pass1Result);
    const pass2Result = await callGeminiWithRetry(apiKey, images, pass2Prompt, modelId, onProgress, pass2Context);

    // 【候補3: メモリ明示解放】
    //   両パス完了後、images (PDF全体の base64 を含む巨大オブジェクト) への参照を解放。
    //   以降の処理では images.length のみ使用するため、先に数値だけ抽出しておく。
    //   これで後続の集計・レンダリング処理中に renderer メモリが落ち着く。
    const imagesLength = images.length;
    images = null;

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

    // 色関連チェックの自己矛盾検出（Pass 1 観測値 vs Pass 2 fail の不整合補正）
    // 【実行順序】 aggregateManualResults / aggregateNevResults より前で実行する不変条件。
    //   geminiResult.manual_results / nev_results を直接ミューテートして status を fail→warn に降格するため、
    //   降格後の値を aggregate* が読むよう、必ず先に呼ぶ。
    //   対象: mc_color_coding, mc_burial_hatching, mc_cable_protector, new_existing_distinction
    //   （new_existing_distinction は NeV 側、他は manual 側）。
    const colorSanity = applyColorRelatedSanityCheck(geminiResult);
    if (colorSanity.count > 0) {
      colorSanity.downgrades.forEach(d => {
        console.warn(`[${d.id} 自動降格] ${d.reason}`);
      });
    }

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
    // 警告の発火順序：
    //   1) low_confidence — 統括表セルの読み取り信頼度が低い箇所を最初に表面化
    //   2) detectDiscrepancies — 数値差分・読み落とし・二重記録の検出
    //   detectDiscrepancies は low_confidence の typeKey を内部でスキップするため重複警告は出ない。
    const discrepancyWarnings = [
      ...detectLowConfidenceWarnings(geminiResult.table_wire_totals, '配線'),
      ...detectLowConfidenceWarnings(geminiResult.table_conduit_totals, '配管'),
      ...detectDiscrepancies(geminiResult.table_wire_totals, wireTotals, '配線', fa),
      ...detectDiscrepancies(geminiResult.table_conduit_totals, conduitTotals, '配管', fa),
    ];

    // 配管共入れパターン解析（app.js が比較テーブルで「共入れ由来の可能性」を識別する材料）
    // normalizeKey ベースのキーなので app.js の normalizeType とはキー空間が異なる点に注意。
    // → app.js 側では displayName 経由で照合するか、再度 normalize する。
    const conduitSharingAnalysis = analyzeConduitSharing(fa);

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
      conduitSharingAnalysis,
      overallComment: geminiResult.overall_comment || '',
      detectedInfo: geminiResult.detected_info || {},
      pageCount,
      analyzedPages: nativeMode ? pageCount : imagesLength,
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
    // 種別キー正規化器（app.js から normalizeType として委譲利用される単一ソース）
    // ※ この関数を app.js で再実装しないこと。ルール分裂による誤マージ/誤警告の原因になる。
    normalizeKey,
    CATEGORIES,
    MODELS,
    COMMON_CHECKS,
    KISO_CHECKS,
    MOKUTEKICHI_CHECKS,
    MANUAL_CHECKS,
  };

})();
