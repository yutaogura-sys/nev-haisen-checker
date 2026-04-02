/* ============================================================
   checker.js — Gemini API を使った配線ルート図の要件チェック
   NeV補助金（次世代自動車充電インフラ整備促進事業）5-9-3 配線ルート図
   正解事例 40件以上の分析に基づく高精度チェックロジック
   ============================================================ */

const DrawingChecker = (() => {

  // ─── チェック項目定義 ───────────────────────────
  // 共通チェック項目（基礎・目的地の両方に適用）
  const COMMON_CHECKS = [
    // ── 表題欄 ──
    {
      id: 'setting_place',
      category: 'title_block',
      label: '設置場所名称の記載',
      description: '表題欄の「設置場所」欄に、申請で入力した設置場所名称（略称不可）が記載されているか。例）○○マンション、○○ホテル 等',
      required: true,
    },
    {
      id: 'drawing_name',
      category: 'title_block',
      label: '図面名称「配線ルート図」の記載',
      description: '表題欄の「図面名称」欄に「配線ルート図」と記載されているか。複数ページの場合は「配線ルート図1」「配線ルート図2」も可。不備例：「配線図」「電気配線図」「ルート図」等は不可',
      required: true,
    },
    {
      id: 'project_name',
      category: 'title_block',
      label: '工事名の記載',
      description: '表題欄に工事名が記載されているか。正解例：「充電設備設置工事」「普通充電設備設置工事」等',
      required: true,
    },
    {
      id: 'creator',
      category: 'title_block',
      label: '作成者の記載',
      description: '表題欄の「作成者」欄に会社名または個人名が記載されているか',
      required: true,
    },
    {
      id: 'scale',
      category: 'title_block',
      label: '縮尺の記載',
      description: '表題欄の「縮尺」欄に縮尺が記載されているか。正解例：A3:1/100、1/150 等',
      required: true,
    },
    {
      id: 'creation_date',
      category: 'title_block',
      label: '作成日の記載',
      description: '表題欄の「作成日」欄に日付が記載されているか（YYYY年MM月DD日 形式等）',
      required: true,
    },

    // ── 配線情報 ──
    {
      id: 'wire_type',
      category: 'wiring_info',
      label: '電線の種類・サイズの記載',
      description: '使用する電線の種類とサイズが記載されているか。正解例：CV5.5-3C、CV5sq-3C、CVT100sq、CV8sq-3C 等。配線集計表または配線ルート上のどちらかに記載があればよい',
      required: true,
    },
    {
      id: 'total_length',
      category: 'wiring_info',
      label: '配線全長の記載',
      description: '配線の全長が記載されているか。正解例：「CV5.5-3C 全長 20.1m」「CVT100sq 全長 38.5m」等。配線集計表に全長として記載されることが多い',
      required: true,
    },
    {
      id: 'length_breakdown',
      category: 'wiring_info',
      label: '配線内訳（露出/管内/埋設等）の記載',
      description: '配線全長の内訳が配線方法別に記載されているか。正解例：「内訳 露出 10.7m」「管内 金属製 E25 4.4m」「合成樹脂 埋設 FEP30 2.0m」等',
      required: true,
    },
    {
      id: 'section_details',
      category: 'wiring_info',
      label: '各区間の配線詳細の記載',
      description: '配線ルート上の各区間ごとに、電線種類・配管種類・距離が記載されているか。正解例：「CV5sq-3C 露出配管 PF5-28 Xxm」「CV5sq-3C 埋設配管 FEP-30 xxm」等',
      required: true,
    },

    // ── 配線方法・配管 ──
    {
      id: 'wiring_method',
      category: 'wiring_method',
      label: '配線方法（架空/露出/埋設）の記載',
      description: '各区間の配線方法が明確に記載されているか。正解例：架空（空中配線）、露出（壁面・天井沿い）、埋設（地中）の区別。配線集計表の内訳欄または図面上の各区間注記で確認',
      required: true,
    },
    {
      id: 'conduit_spec',
      category: 'wiring_method',
      label: '配管の種類・サイズの記載',
      description: '使用する配管の種類とサイズが記載されているか。正解例：PF5-28、VE-22、FEP-30、G28、G54、E25、HIVE-22、CD-22 等',
      required: true,
    },
    {
      id: 'conduit_material',
      category: 'wiring_method',
      label: '配管材質の記載（金属製/合成樹脂）',
      description: '配管の材質区分が記載されているか。正解例：「金属製 G28」「合成樹脂 FEP30」「金属管配管 E25」等。配線集計表の「管内」欄で金属製/合成樹脂の区分があればよい',
      required: true,
    },

    // ── 設備配置・寸法 ──
    {
      id: 'equipment_position',
      category: 'layout',
      label: 'EV充電設備の配置位置',
      description: 'EV充電設備の配置が図面上に示されているか。設備のラベル（EV充電設備1, 2等）と位置が確認できるか',
      required: true,
    },
    {
      id: 'power_source',
      category: 'layout',
      label: '電源元（受電盤/分電盤/キュービクル等）の記載',
      description: '配線の起点となる電源元が記載されているか。正解例：受電盤、分電盤、キュービクル、受電設備 等。配線ルートの始点に位置する',
      required: true,
    },
    {
      id: 'wiring_route_line',
      category: 'layout',
      label: '配線ルートの線表示',
      description: '配線ルートが図面上に線（赤色等）で図示されているか。電源元から各充電設備までの経路が視覚的に確認できるか',
      required: true,
    },
    {
      id: 'dimension_lines',
      category: 'layout',
      label: '位置関係がわかる寸法の記載',
      description: '配線ルート上の各区間の距離（m単位）が記載されているか。正解例：7.2m、10.7m、2.5m 等。配線ルートに沿って距離が注記されているか',
      required: true,
    },
    {
      id: 'compass',
      category: 'layout',
      label: '方位記号（N）の記載',
      description: '方位記号（北を示すN矢印）が図面上に記載されているか。通常は右上に配置',
      required: true,
    },
    {
      id: 'surface_material',
      category: 'layout',
      label: '路面状況の記載',
      description: '路面を構成する材質が記載されているか。正解例：路面状況：アスファルト、路面状況：コンクリート、路面状況：土 等。特に埋設配管がある場合は埋設箇所の路面状況が必要',
      required: true,
    },

    // ── 付帯設備 ──
    {
      id: 'rise_info',
      category: 'ancillary',
      label: '立上げ・掘削の長さの記載',
      description: '立上げ（地中から地上へケーブルを出す箇所）や掘削（地面を掘る箇所）がある場合、その長さが記載されているか。正解例：「立上げ 1m」「掘削 2m」「立ち上げ 0.5m」等。該当工事がない場合はパス',
      required: false,
    },
    {
      id: 'hand_hole',
      category: 'ancillary',
      label: 'ハンドホールの記載',
      description: 'ハンドホール（地中配線の点検用マンホール）がある場合、設置位置と仕様（材質、蓋、よこ、長さ）が記載されているか。正解例：「ハンドホール 400×300×深さ2m」等。該当工事がない場合はパス',
      required: false,
    },
    {
      id: 'pole_info',
      category: 'ancillary',
      label: '支柱の記載',
      description: '支柱（架空配線を支える柱）を設置する場合、支柱の位置が記載されているか。該当工事がない場合はパス',
      required: false,
    },
  ];

  // 基礎充電（マンション・集合住宅）固有チェック項目
  const KISO_CHECKS = [
    {
      id: 'building_name',
      category: 'kiso_specific',
      label: '建物名称の表示',
      description: 'マンション・団地等の建物名称が図面上に表示されているか',
      required: true,
    },
    {
      id: 'surrounding_structures',
      category: 'kiso_specific',
      label: '周辺構造物の記載',
      description: '建物、駐車場、駐輪場、フェンス、道路、植栽等の周辺構造物が記載されているか',
      required: true,
    },
    {
      id: 'utility_work_boundary',
      category: 'kiso_specific',
      label: '電力会社工事区間の明示',
      description: '電力会社工事（電力会社が施工する区間）がある場合、その範囲が「電力会社工事」等のラベルで明示されているか。該当がない場合はパス',
      required: false,
    },
    {
      id: 'power_meter_kiso',
      category: 'kiso_specific',
      label: '電力量計の記載',
      description: '新設電力量計（メーター）がある場合、設置位置が記載されているか。正解例：「新設電力量計」「電力量計（建物に取付）」等。該当がない場合はパス',
      required: false,
    },
  ];

  // 目的地充電（商業施設等）固有チェック項目
  const MOKUTEKICHI_CHECKS = [
    {
      id: 'pull_box',
      category: 'mokutekichi_specific',
      label: 'プルボックスの記載',
      description: 'プルボックス（配線の分岐・接続箱）がある場合、設置位置と仕様が記載されているか。正解例：「新設プルボックス 200×200×100」「新設アルボックス 200×200×100」等。該当がない場合はパス',
      required: false,
    },
    {
      id: 'power_meter_mokutekichi',
      category: 'mokutekichi_specific',
      label: '電力量計の記載',
      description: '新設電力量計（メーター）がある場合、設置位置が記載されているか。正解例：「新設電力量計」「新設電力量計（建物に取付）」等。該当がない場合はパス',
      required: false,
    },
    {
      id: 'switch_pole',
      category: 'mokutekichi_specific',
      label: '開閉器ポール/分岐盤の記載',
      description: '開閉器ポールや分岐盤がある場合、設置位置が記載されているか。正解例：「新設開閉器ポール」「既設開閉器ポール」等。該当がない場合はパス',
      required: false,
    },
    {
      id: 'existing_route',
      category: 'mokutekichi_specific',
      label: '既設充電設備の配線ルート（該当する場合）',
      description: '既設充電設備がある場合、既設設備の位置と配線ルートが記載されているか。既設と新設で色分け（新設=赤、既設=青等）またはページ分離がされているか',
      required: false,
    },
    {
      id: 'new_existing_distinction',
      category: 'mokutekichi_specific',
      label: '新設/既設の区別',
      description: '新設と既設の充電設備・配線ルートが区別されているか。正解例：色分け（新設=赤、既設=青）、ページ分離（配線ルート図1=新設、配線ルート図2=既設）、「残置」ラベル等。既設がない場合はパス',
      required: false,
    },
  ];

  // カテゴリ定義
  const CATEGORIES = {
    title_block:            { title: '(1)表題欄（図面基本情報）',      icon: '&#128203;', order: 1 },
    wiring_info:            { title: '(2)配線情報（電線・全長・内訳）', icon: '&#128268;', order: 2 },
    wiring_method:          { title: '(3)配線方法・配管',              icon: '&#128295;', order: 3 },
    layout:                 { title: '(4)設備配置・寸法・路面',         icon: '&#128207;', order: 4 },
    ancillary:              { title: '(5)付帯設備（立上げ・HH・支柱）', icon: '&#128736;', order: 5 },
    kiso_specific:          { title: '(6)基礎充電 固有項目',           icon: '&#127970;', order: 6 },
    mokutekichi_specific:   { title: '(6)目的地充電 固有項目',         icon: '&#127978;', order: 6 },
  };

  // ─── Gemini プロンプト生成 ──────────────────────
  function buildPrompt(type) {
    const checks = type === 'kiso'
      ? [...COMMON_CHECKS, ...KISO_CHECKS]
      : [...COMMON_CHECKS, ...MOKUTEKICHI_CHECKS];

    const checkListText = checks.map((c, i) => {
      return `${i + 1}. [${c.id}] ${c.label}\n   確認内容: ${c.description}\n   必須: ${c.required ? 'はい' : 'いいえ（該当する場合のみ）'}`;
    }).join('\n\n');

    const typeLabel = type === 'kiso'
      ? '基礎充電（マンション・集合住宅向け）'
      : '目的地充電（商業施設・ホテル・ゴルフ場等向け）';

    return `あなたはNeV補助金（次世代自動車充電インフラ整備促進事業）の「配線ルート図」の審査エキスパートです。
補助金要件 5-9-3「配線ルート図」に基づき、アップロードされた図面PDFを非常に高い精度で分析してください。
これはEV充電設備の補助金申請における配線ルート図（電源から充電設備までの配線経路・電線種類・配管仕様等を示す技術図面）です。

## 重要：配線ルート図とは
配線ルート図は、電源元（受電盤・キュービクル・分電盤等）からEV充電設備までの配線経路を示す技術図面です。
平面図（充電スペースの寸法・配置を示す図面）や設置場所見取図（敷地全体の広域図）とは異なり、
電線の種類・サイズ、配線方法（架空・露出・埋設）、配管の仕様、各区間の距離等を詳細に示します。

## 図面タイプ
${typeLabel}

## 補助金要件（5-9-3 配線ルート図）

### 基本要件
配線ルート図には、以下の内容を記載する必要があります：
- 電源元から充電設備間の配線ルート
- 電線の種類（ケーブル型番・サイズ）
- 配線方法（架空・露出・埋設）を明確に記載
- 配管の仕様（材質・径）を記載
- 配線の全長と導線を記載
- 位置関係がわかる寸法を記載
- 路面を構成する材質を記載（アスファルト、コンクリート、土等）
- キュービクル・受電盤・充電設備の位置を記載
- 立上げ・掘削がある場合はその長さを記載
- 埋設の場合は、埋設箇所の路面状況を記載

### (1) 表題欄（図面右下の枠内）
以下の項目が表題欄に記載されている必要があります：
- **設置場所**: 申請で入力した設置場所名称（略称不可）
- **図面名称**: 「配線ルート図」と記載（「配線ルート図1」「配線ルート図2」も可）
  - 不備事例：「配線図」「電気配線図」「ルート図」等は不可
- **工事名**: 「充電設備設置工事」「普通充電設備設置工事」等
- **作成者**: 会社名または個人名
- **縮尺**: 数値（例: A3:1/100、1/150 等）
- **作成日**: 年月日の記載

### (2) 配線情報
- **電線の種類・サイズ**: CV5.5-3C、CV5sq-3C、CVT100sq 等
- **全長**: 配線の総延長をm単位で記載
- **内訳**: 配線方法別の距離内訳（露出○m、管内金属製○m、埋設○m等）
- **各区間の詳細**: 配線ルート上の各区間に、電線種類・配管種類・距離を注記

### (3) 配線方法・配管
- **配線方法**: 架空（空中）、露出（壁面・天井沿い）、埋設（地中）を区別
- **配管の種類**: PF、VE、FEP、G、E、HIVE、CD 等の管種と径
- **配管の材質**: 金属製（G管・E管等）または合成樹脂（PF管・VE管・FEP管・CD管等）

### (4) 設備配置・寸法
- **EV充電設備**: 各充電設備の位置をラベル付きで表示
- **電源元**: 受電盤/分電盤/キュービクル等の位置を表示
- **配線ルート線**: 電源元から充電設備までの経路を線で図示
- **寸法**: 各区間の距離をm単位で記載
- **方位記号**: 北を示すN矢印
- **路面状況**: 路面の材質（アスファルト、コンクリート、土等）

### (5) 付帯設備（該当する場合のみ）
- **支柱**: 架空配線を支える柱。設置する場合は位置を記載
- **ハンドホール**: 地中配線の点検口。設置する場合は位置・仕様（材質・蓋・寸法）を記載
  - 正解例：「ハンドホール 幅400mm, 深さ300mm, 長さ2m」
- **立上げ・掘削**: 地中配線が地上に出る箇所。長さを記載

${type === 'mokutekichi' ? `### (6) 目的地充電の追加要件
- **プルボックス**: 配線の分岐・接続箱がある場合、位置・仕様を記載
  - 正解例：「新設プルボックス 200×200×100」「新設アルボックス 200×200×100」
- **電力量計**: 新設電力量計がある場合、設置位置を記載
- **開閉器ポール/分岐盤**: ある場合、位置を記載
- **既設充電設備**: 既設がある場合、既設の位置と配線ルートを記載
- **新設/既設の区別**: 色分け（新設=赤、既設=青）またはページ分離で区別
` : `### (6) 基礎充電の追加要件
- **建物名称**: マンション・団地名を図面上に表示
- **周辺構造物**: 建物、駐車場、駐輪場、フェンス、道路等を記載
- **電力会社工事**: 電力会社施工区間がある場合、範囲を明示
- **電力量計**: 新設電力量計がある場合、設置位置を記載
`}

## 正解事例から学んだパターン（40件以上の分析結果）

### 表題欄の標準パターン（図面右下の枠内）
- **設置場所**: 施設名のみ記載（例: 「キコーナ伊川谷店」「リリーヴィレッジＣＲＥＳＴ」）
- **図面名称**: 「配線ルート図」（複数ページの場合は「配線ルート図1」「配線ルート図2」「配線ルート図3」）
- **図面名称**: 別パターンとして「図面名 配線ルート図」の形式もある
- **工事名**: 「充電設備設置工事」が最も多い。「普通充電設備設置工事」もある
- **作成者**: 会社ロゴ＋会社名（例: 「ENECHANGE EVラボ株式会社」）
- **縮尺**: 「A3:1/100」が最も一般的。「A3:1/150」「A3:1/200」もある
- **作成日**: YYYY年MM月DD日 形式（例: 2025年05月01日）

### 配線集計表の標準パターン（図面左上〜中央に配置される表形式）
正解事例では、配線情報を「配線集計表」として図面内に表形式で整理して記載しています：

**普通充電の場合（CV5sq-3C / CV5.5-3C）:**
\`\`\`
CV5sq-3C  全長          ○○m
          内訳  露出              ○m
                管内  PF5-28      ○m
                      VE-22       ○m
                埋設  FEP-30      ○m
                合計              ○○m
\`\`\`

**急速充電の場合（CVT100sq 等の太い電線）:**
\`\`\`
CVT100sq  全長          ○○m
          内訳  露出              ○m
                管内  金属製 G54   ○m
                合計              ○○m
\`\`\`

### 各区間の配線注記パターン（配線ルート上に緑色テキストで記載）
正解事例では、配線ルート上の各区間ごとに以下の形式で詳細が注記されています：
- **「CV5sq-3C 露出配管 PF5-28 ○m」** — 露出区間（壁面・天井沿い）
- **「CV5sq-3C 露出配管 VE-22 ○m（ケーブル入れ入れ）」** — VE管露出区間
- **「CV5sq-3C 埋設配管 FEP-30 ○m」** — 地中埋設区間
- **「CV5sq-3C 露出配管 PF5-28 立ち上げ ○m」** — 立上げ区間
- **「CVT100sq 露出配管 G[54] ○m」** — 金属管露出区間
- **「CVT100sq 新設 露出配管 G[54] ○m」** — 新設明記の区間
- **「CV5sq-3C 天井内配管 PF5-28 ○m（ケーブル入れ入れ）」** — 天井内区間

### EV充電設備の配線接続パターン
- **壁面設置**: 「EV充電設備(壁面設置)」のラベル。壁面にケーブルが到達する形
- **金属架台**: 「EV充電設備(金属架台)」のラベル。架台上の設備にケーブル接続
- **EV充電設備周りの配線注記**: 「EV充電設備内配線 ○m」として設備内の配線も記載

### 付帯設備の標準パターン
- **新設プルボックス**: 「新設プルボックス 200×200×100」「新設アルボックス 200×200×100」
- **新設電力量計**: 「新設電力量計」「新設電力量計（建物に取付）」「新設電力量計（既設開閉器ポールに取付）」
- **新設開閉器ポール**: 「新設開閉器ポール」
- **電力会社工事**: 「電力会社工事」のラベルで施工範囲を明示
- **ハンドホール**: 「ハンドホール 幅○mm, 深さ○mm, 長さ○m」

### 配線ルート線の表現パターン
- **赤色の線**: 新設の配線ルートを示す
- **青色の線**: 既設の配線ルートを示す（該当する場合）
- **矢印付き**: 配線の方向を示す矢印が付く場合がある
- **番号付き参照**: ①②③④⑤⑥ 等の番号で配線区間を参照

### A3用紙の標準レイアウト
- 用紙サイズ: A3横（約420mm × 297mm）
- 表題欄: 図面右下に配置
- 方位記号: 図面右上に配置（N↑）
- 配線集計表: 図面左上〜左中に配置
- 配線ルート本体: 中央に配置
- 各区間の配線注記: 配線ルートに沿って緑色テキストで記載

${type === 'mokutekichi' ? `### 目的地充電の正解パターン
- **複数ページ構成**: 新設のみ=1ページ、既設あり=2〜3ページ
- **ページ分け**: 配線ルート図1（新設分）、配線ルート図2（既設分）、配線ルート図3（追加分）
- **色分け**: 新設配線=赤色線、既設配線=青色線
- **既設表記**: 「既設EV充電設備 残置」「既設配線 残置」等
- **プルボックス**: 配線の分岐点に新設プルボックスが配置されることが多い
- **電力量計・開閉器**: 受電盤〜充電設備間に新設電力量計が設置されることが多い
` : `### 基礎充電の正解パターン
- **ページ構成**: 基本的に1〜2ページ
- **建物名称**: 図面上にマンション名・団地名が大きく表示
- **電力会社工事**: 引込線〜電力量計までが電力会社工事区間として明示
- **新設電力量計**: 建物の外壁や既設ポールに取付の注記がある
- **周辺構造物**: 建物、駐車場、道路、フェンス、植栽等が描画
- **電力会社の引込**: 「電力会社工事」のラベルで引込線区間を明示
`}

## チェック項目
${checkListText}

## 回答フォーマット（厳密にこのJSON形式で返してください）
以下のJSON形式のみで回答してください。JSONの前後に余計なテキストは不要です。

\`\`\`json
{
  "results": [
    {
      "id": "チェック項目ID",
      "status": "pass | fail | warn",
      "found_text": "図面から実際に読み取れた内容（なるべく具体的に。読み取れたテキスト・数値をそのまま記載）",
      "detail": "判定理由の詳細説明"
    }
  ],
  "overall_comment": "図面全体に対する総合コメント（良い点・改善が必要な点を含む。400文字程度で具体的に）",
  "detected_info": {
    "facility_name": "読み取れた施設名",
    "drawing_title": "読み取れた図面名称",
    "project_name": "読み取れた工事名",
    "creator": "読み取れた作成者名",
    "scale": "読み取れた縮尺",
    "creation_date": "読み取れた作成日",
    "wire_type": "読み取れた電線の種類（例: CV5.5-3C）",
    "total_length": "読み取れた配線全長（例: 20.1m）",
    "length_breakdown": "配線内訳の要約（例: 露出10.7m, 管内G28 2.5m, 埋設FEP30 2.0m）",
    "wiring_methods": "確認できた配線方法の一覧（例: 露出, 埋設）",
    "conduit_types": "確認できた配管種類の一覧（例: PF5-28, VE-22, FEP-30）",
    "power_source": "読み取れた電源元（例: 受電盤, キュービクル）",
    "equipment_count": "読み取れたEV充電設備の台数",
    "surface_material": "読み取れた路面状況",
    "ancillary_equipment": "確認できた付帯設備（例: プルボックス, 電力量計, ハンドホール）",
    "existing_equipment_info": "読み取れた既設設備情報（なければ空文字）",
    "page_count_analyzed": "解析したページ数"
  }
}
\`\`\`

## 判定基準
- **pass**: 要件を満たしている（明確に記載が確認できる）
- **fail**: 要件を満たしていない（記載が見当たらない、または明らかに不十分）
- **warn**: 記載はあるが不明瞭、または要件を部分的にしか満たしていない

## 判定の注意事項（精度向上のために必ず守ること）

### 全体的な確認方法
- 画像を非常に注意深く、隅々まで確認してください
- **拡大して細部まで読み取る**つもりで、小さな文字やラベルも見逃さないでください
- 複数ページがある場合は全ページを確認してください
- 配線ルート図は技術図面のため、細かい注記が多数あります。全て読み取ってください

### 表題欄の確認方法
- **図面の右下**にある枠線で囲まれた領域を重点的に確認
- 枠内に「設置場所」「図面名」「作成者」「縮尺」「作成日」等のラベルがあるはずです
- 「図面名称」が「配線ルート図」であることを厳密に確認

### 配線集計表の確認方法
- **図面の左上〜左中エリア**に表形式で配線情報がまとめられていることが多い
- 表の中に「全長」「内訳」「露出」「管内」「埋設」等のキーワードを探す
- 電線種類（CV5sq-3C等）と各区間の距離を確認

### 配線ルート上の注記確認方法
- 配線ルートの線に沿って、**緑色のテキスト**で各区間の詳細が記載されている
- 「CV5sq-3C 露出配管 PF5-28 ○m」のような形式の注記を探す
- 各区間の電線種類・配管種類・距離が記載されているか確認

### 設備の確認方法
- 「EV充電設備」「受電盤」「分電盤」「キュービクル」等のラベルを探す
- 電源元から充電設備までの配線ルートが線で描かれているか確認
- 「新設電力量計」「新設プルボックス」等の付帯設備ラベルを探す

### 路面・寸法の確認方法
- 「路面状況：○○」「路面：アスファルト」等のテキストを探す
- 配線ルート上の各区間にm単位の距離が記載されているか確認
- 方位記号（N矢印）は通常、図面右上にあります

${type === 'mokutekichi' ? `### 目的地充電の追加確認
- 既設充電設備がある場合は**青色の線・ラベル**を確認
- 「残置」「既設」のテキストがあるか確認
- 複数ページの場合、各ページの図面名称を確認（配線ルート図1、配線ルート図2 等）
- プルボックス・電力量計・開閉器ポールの有無を確認
` : `### 基礎充電の追加確認
- 建物名称が図面上に表示されているか確認
- 電力会社工事区間が明示されているか確認
- 周辺構造物（建物、駐車場、道路等）の描画を確認
`}

### 重要な注意事項
- 「該当する場合のみ」のチェック項目は、該当しない場合（例：ハンドホールがない場合）は **pass** としてください
- found_text には図面から読み取れた具体的なテキスト・数値を記載してください。推測は不可です
- 全てのチェック項目について必ず結果を返してください（スキップ不可）
- 図面のどの位置から情報を読み取ったかを detail に含めてください`;
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
    const maxPages = Math.min(pageCount, 5);
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

  // ─── プレビュー用画像生成 ──────────────────────
  async function pdfToPreview(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const safeScale = calcSafeScale(page, 1.5);
    const viewport = page.getViewport({ scale: safeScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
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
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}?key=${apiKey}`,
        { method: 'GET' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return { available: false, reason: data?.error?.message || `HTTP ${response.status}` };
      }
      return { available: true, reason: '' };
    } catch (e) {
      return { available: false, reason: '接続エラー' };
    }
  }

  // ─── 全モデル一括接続テスト ────────────────────
  async function verifyAllModels(apiKey) {
    const results = {};
    await Promise.all(MODELS.map(async (model) => {
      results[model.id] = await verifyModel(apiKey, model.id);
    }));
    return results;
  }

  // ─── Gemini API 呼び出し ───────────────────────
  async function callGemini(apiKey, images, type, modelId) {
    const prompt = buildPrompt(type);

    const imageParts = images.map(img => ({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64,
      }
    }));

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
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };

    const useModel = modelId || 'gemini-2.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `API エラー (${response.status})`);
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
    if (candidate.finishReason === 'SAFETY') {
      throw new Error('Gemini の安全フィルタにより応答がブロックされました。図面の内容を確認してください。');
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

    try {
      return JSON.parse(jsonStr.trim());
    } catch (parseErr) {
      console.error('Gemini応答のJSONパースに失敗:', text.substring(0, 500));
      throw new Error('Gemini の応答を解析できませんでした。再試行してください。');
    }
  }

  // ─── API キー検証 ─────────────────────────────
  async function verifyApiKey(apiKey) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: 'GET' }
    );
    return response.ok;
  }

  // ─── 結果集計 ──────────────────────────────────
  function aggregateResults(geminiResult, type) {
    const checks = type === 'kiso'
      ? [...COMMON_CHECKS, ...KISO_CHECKS]
      : [...COMMON_CHECKS, ...MOKUTEKICHI_CHECKS];

    const resultMap = {};
    if (geminiResult.results) {
      geminiResult.results.forEach(r => { resultMap[r.id] = r; });
    }

    const items = checks.map(check => {
      const result = resultMap[check.id] || { status: 'fail', found_text: '', detail: '判定結果が取得できませんでした' };
      return {
        ...check,
        status: result.status,
        found_text: result.found_text || '',
        detail: result.detail || '',
      };
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
    if (requiredFail === 0) {
      overall = 'pass';
    } else if (requiredFail <= 2) {
      overall = 'warn';
    } else {
      overall = 'fail';
    }

    return {
      items,
      categoryResults,
      overall,
      totalPass,
      totalItems: items.length,
      requiredPass,
      requiredTotal: totalRequired.length,
      requiredFail,
      overallComment: geminiResult.overall_comment || '',
      detectedInfo: geminiResult.detected_info || {},
    };
  }

  // ─── メインチェック実行 ────────────────────────
  async function check(apiKey, file, type, modelId) {
    const { images, pageCount } = await pdfToImages(file);
    const geminiResult = await callGemini(apiKey, images, type, modelId);
    const aggregated = aggregateResults(geminiResult, type);
    aggregated.pageCount = pageCount;
    aggregated.analyzedPages = images.length;
    return aggregated;
  }

  // ─── 結果テキスト出力 ──────────────────────────
  function resultToText(result, type) {
    const typeLabel = type === 'kiso' ? '基礎充電' : '目的地充電';
    let text = `=== NeV 配線ルート図 要件判定結果 ===\n`;
    text += `図面タイプ: ${typeLabel}\n`;
    text += `判定: ${result.overall === 'pass' ? '合格' : result.overall === 'warn' ? '要確認' : '不合格'}\n`;
    text += `合格項目: ${result.totalPass} / ${result.totalItems}\n`;
    text += `必須項目: ${result.requiredPass} / ${result.requiredTotal}\n\n`;

    const info = result.detectedInfo;
    if (info) {
      text += `--- 読み取り情報 ---\n`;
      if (info.facility_name) text += `施設名: ${info.facility_name}\n`;
      if (info.drawing_title) text += `図面名称: ${info.drawing_title}\n`;
      if (info.creator) text += `作成者: ${info.creator}\n`;
      if (info.scale) text += `縮尺: ${info.scale}\n`;
      if (info.creation_date) text += `作成日: ${info.creation_date}\n`;
      if (info.wire_type) text += `電線種類: ${info.wire_type}\n`;
      if (info.total_length) text += `配線全長: ${info.total_length}\n`;
      if (info.length_breakdown) text += `内訳: ${info.length_breakdown}\n`;
      if (info.equipment_count) text += `EV充電設備: ${info.equipment_count}\n`;
      text += '\n';
    }

    text += `--- 項目別結果 ---\n`;
    result.items.forEach(item => {
      const icon = item.status === 'pass' ? '[OK]' : item.status === 'fail' ? '[NG]' : '[!?]';
      text += `${icon} ${item.label}${item.required ? '' : ' [任意]'}\n`;
      if (item.found_text) text += `    検出: ${item.found_text}\n`;
      if (item.detail) text += `    詳細: ${item.detail}\n`;
      text += '\n';
    });

    if (result.overallComment) {
      text += `--- AI コメント ---\n${result.overallComment}\n`;
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
  };

})();
