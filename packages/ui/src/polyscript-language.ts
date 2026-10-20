/**
 * PolyScript language support for CodeMirror.
 *
 * Provides autocompletion, hover tooltips, and tooltip styling
 * bundled as a single Extension via `polyscriptLanguageSupport()`.
 *
 * Individual pieces (`polyscriptCompletion`, `polyscriptHoverExtension`)
 * are also exported for advanced usage.
 */

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

// --- Function signature definitions for hover tooltips ---

interface ParamInfo {
  name: string;
  desc: string;
  optional?: boolean;
}

interface FuncSignature {
  signature: string;
  desc: string;
  params: ParamInfo[];
  example?: string;
}

const signatures: Record<string, FuncSignature> = {
  // 3D primitives
  box: {
    signature: 'box width height depth',
    desc: '3Dの直方体を作成',
    params: [
      { name: 'width', desc: 'X方向の幅' },
      { name: 'height', desc: 'Y方向の高さ' },
      { name: 'depth', desc: 'Z方向の奥行き' },
    ],
    example: 'box 80 60 10',
  },
  cylinder: {
    signature: 'cylinder radius height',
    desc: '3Dの円柱を作成',
    params: [
      { name: 'radius', desc: '円柱の半径' },
      { name: 'height', desc: '円柱の高さ' },
    ],
    example: 'cylinder 5 10',
  },
  sphere: {
    signature: 'sphere radius',
    desc: '3Dの球を作成',
    params: [
      { name: 'radius', desc: '球の半径' },
    ],
    example: 'sphere 10',
  },
  cone: {
    signature: 'cone r1 r2 h',
    desc: '3Dの円錐・円錐台を作成',
    params: [
      { name: 'r1', desc: '底面の半径' },
      { name: 'r2', desc: '上面の半径（0で尖った円錐）' },
      { name: 'h', desc: '高さ' },
    ],
    example: 'cone 10 0 20',
  },
  torus: {
    signature: 'torus r1 r2',
    desc: '3Dのトーラス（ドーナツ形）を作成',
    params: [
      { name: 'r1', desc: '中心から管中心までの半径' },
      { name: 'r2', desc: '管の半径' },
    ],
    example: 'torus 20 5',
  },
  wedge: {
    signature: 'wedge dx dy dz ltx',
    desc: '3Dのくさび形を作成',
    params: [
      { name: 'dx', desc: 'X方向の幅' },
      { name: 'dy', desc: 'Y方向の高さ' },
      { name: 'dz', desc: 'Z方向の奥行き' },
      { name: 'ltx', desc: '上面のX方向の幅' },
    ],
    example: 'wedge 20 10 15 5',
  },
  // 2D primitives
  rect: {
    signature: 'rect width height',
    desc: '2Dの矩形を作成',
    params: [
      { name: 'width', desc: '幅' },
      { name: 'height', desc: '高さ' },
    ],
    example: 'rect 50 30',
  },
  circle: {
    signature: 'circle radius',
    desc: '2Dの円を作成',
    params: [
      { name: 'radius', desc: '半径' },
    ],
    example: 'circle 10',
  },
  ellipse: {
    signature: 'ellipse rx ry',
    desc: '2Dの楕円を作成',
    params: [
      { name: 'rx', desc: 'X方向の半径' },
      { name: 'ry', desc: 'Y方向の半径' },
    ],
    example: 'ellipse 10 5',
  },
  polygon: {
    signature: 'polygon n r',
    desc: '2Dの正多角形を作成',
    params: [
      { name: 'n', desc: '頂点数' },
      { name: 'r', desc: '外接円半径' },
    ],
    example: 'polygon 6 10',
  },
  polyline: {
    signature: 'polyline points',
    desc: '頂点リストから閉じた2Dワイヤーを作成',
    params: [
      { name: 'points', desc: '頂点のリスト [(x,y), ...]' },
    ],
    example: 'polyline [(0,0), (10,0), (5,10)]',
  },
  text: {
    signature: 'text content size',
    desc: '2Dのテキスト形状を作成',
    params: [
      { name: 'content', desc: 'テキスト文字列 "..."' },
      { name: 'size', desc: 'フォントサイズ' },
    ],
    example: 'text "ABC" 10',
  },
  // Paths
  line: {
    signature: 'line start end',
    desc: '直線パスを作成',
    params: [
      { name: 'start', desc: '開始点 (x,y,z)' },
      { name: 'end', desc: '終了点 (x,y,z)' },
    ],
  },
  arc: {
    signature: 'arc start through end | arc start end center:(cx,cy) | arc start end radius:radius',
    desc: '円弧パスを作成（3点弧/中心指定/半径指定）',
    params: [
      { name: 'start', desc: '開始点 (x,y)' },
      { name: 'through / end', desc: '通過点または終了点' },
      { name: 'end / center: / radius:', desc: '終了点、中心点 center:(x,y)、または半径 radius:value' },
    ],
    example: 'arc (0,0) (5,5) (10,0)',
  },
  bezier: {
    signature: 'bezier points',
    desc: 'ベジェ曲線パスを作成',
    params: [
      { name: 'points', desc: '制御点のリスト [(x,y,z), ...]' },
    ],
  },
  helix: {
    signature: 'helix pitch height radius',
    desc: 'らせんパスを作成（sweep用）',
    params: [
      { name: 'pitch', desc: '1回転あたりの高さ' },
      { name: 'height', desc: '全体の高さ' },
      { name: 'radius', desc: 'らせんの半径' },
    ],
    example: 'helix 5 30 10',
  },
  spline: {
    signature: 'spline points',
    desc: 'スプライン曲線パスを作成（通過点を補間）',
    params: [
      { name: 'points', desc: '通過点のリスト [(x,y,z), ...]' },
    ],
    example: 'spline [(0,0,0), (10,5,5), (20,0,10)]',
  },
  sketch: {
    signature: 'sketch [segments]',
    desc: '線分・円弧・曲線を繋いだ閉じた2Dプロファイルを作成（自動close）',
    params: [
      { name: 'segments', desc: 'セグメントのリスト。タプル=直線、arc/bezier/spline も可。最初の要素が開始点' },
    ],
    example: 'sketch [(5,0), arc (5,0) (0,-5) (-5,0), (0,7), (5,0)]',
  },
  wire: {
    signature: 'wire [segments]',
    desc: 'sketchのopen版（自動closeなし）。sweepのpathに最適',
    params: [
      { name: 'segments', desc: 'セグメントのリスト。2D/3D両対応' },
    ],
    example: 'wire [(0,0), (10,0), arc (10,0) (15,5) radius:5]',
  },
  // Pipe operations
  fillet: {
    signature: '| fillet radius',
    desc: 'エッジを丸める（フィレット）',
    params: [
      { name: 'radius', desc: 'フィレット半径' },
    ],
    example: 'box 80 60 10 | fillet 2',
  },
  chamfer: {
    signature: '| chamfer distance',
    desc: 'エッジを面取りする',
    params: [
      { name: 'distance', desc: '面取り距離' },
    ],
    example: 'box 80 60 10 | chamfer 1',
  },
  shell: {
    signature: '| shell thickness [open:selector]',
    desc: '形状を中空にする',
    params: [
      { name: 'thickness', desc: '壁の厚み' },
      { name: 'open:', desc: '開放する面のセレクタ', optional: true },
    ],
    example: 'box 80 60 10 | shell 2 open:top',
  },
  diff: {
    signature: '| diff shape',
    desc: 'ブーリアン減算（形状を引く）',
    params: [
      { name: 'shape', desc: '引く形状' },
    ],
    example: 'box 50 50 10 | diff cylinder 5 10',
  },
  union: {
    signature: '| union shape',
    desc: 'ブーリアン和（形状を足す）',
    params: [
      { name: 'shape', desc: '足す形状' },
    ],
    example: 'box 50 50 10 | union sphere 5',
  },
  inter: {
    signature: '| inter shape',
    desc: 'ブーリアン交差',
    params: [
      { name: 'shape', desc: '交差する形状' },
    ],
  },
  extrude: {
    signature: '| extrude height [draft:angle]',
    desc: '2D形状を押し出して3Dにする',
    params: [
      { name: 'height', desc: '押し出し高さ' },
      { name: 'draft:', desc: 'ドラフト角度（度）', optional: true },
    ],
    example: 'rect 60 40 | extrude 15',
  },
  revolve: {
    signature: '| revolve axis [degrees]',
    desc: '2D形状を指定軸で回転して3Dにする（角度省略時360°）',
    params: [
      { name: 'axis', desc: '回転軸: X / Y / Z' },
      { name: 'degrees', desc: '回転角度（省略時360°）', optional: true },
    ],
    example: 'rect 10 30 at:(15, 0) | revolve Y',
  },
  sweep: {
    signature: '| sweep profile',
    desc: 'パスに沿って断面を押し出す（pipeline側がpath/spine、引数がprofile）',
    params: [
      { name: 'profile', desc: '断面となる2D形状（circle, rect等）' },
    ],
    example: 'helix 5 30 10 | sweep (circle 2)',
  },
  loft: {
    signature: '| loft [sections] height',
    desc: '複数断面を接続してソリッドを作る',
    params: [
      { name: 'sections', desc: '断面のリスト' },
      { name: 'height', desc: '断面間の高さ' },
    ],
    example: 'rect 20 20 | loft [rect 8 8] 10',
  },
  offset: {
    signature: '| offset distance',
    desc: 'ワイヤー/面の外形をオフセット（+で外側、-で内側）',
    params: [
      { name: 'distance', desc: 'オフセット量。負値で内側' },
    ],
    example: 'rect 50 30 | offset -10',
  },
  place: {
    signature: '| place shape',
    desc: '変数に格納した2D形状を選択面の上に配置する',
    params: [
      { name: 'shape', desc: '配置する2D形状（$var または式）' },
    ],
    example: 'box 10 10 10 | faces >Z | place $s | cut',
  },
  cut: {
    signature: '| cut [depth]',
    desc: '面上の2D形状でカット（省略時は貫通）',
    params: [
      { name: 'depth', desc: 'カット深さ（省略で貫通）', optional: true },
    ],
    example: '| faces top | rect 20 10 | cut 3',
  },
  hole: {
    signature: '| hole radius [at:x y] [depth:d] [origin:"world"|(x,y,z)]',
    desc: '穴を開ける（半径指定）',
    params: [
      { name: 'radius', desc: '穴の半径' },
      { name: 'at:', desc: '穴の位置 (2成分=WP基準, 3成分=ワールド)', optional: true },
      { name: 'depth:', desc: '穴の深さ（省略で貫通）', optional: true },
      { name: 'origin:', desc: '座標基準: "world", (x,y,z)', optional: true },
    ],
    example: '| faces top | hole 3 at: 5 5',
  },
  translate: {
    signature: '| translate x y z',
    desc: '形状を平行移動',
    params: [
      { name: 'x', desc: 'X方向の移動量' },
      { name: 'y', desc: 'Y方向の移動量' },
      { name: 'z', desc: 'Z方向の移動量' },
    ],
    example: '| translate 10 0 5',
  },
  rotate: {
    signature: '| rotate rx ry rz',
    desc: '形状を回転',
    params: [
      { name: 'rx', desc: 'X軸周りの回転角度' },
      { name: 'ry', desc: 'Y軸周りの回転角度' },
      { name: 'rz', desc: 'Z軸周りの回転角度' },
    ],
    example: '| rotate 0 0 45',
  },
  scale: {
    signature: '| scale s | scale sx sy sz',
    desc: '形状を拡大縮小（一様/非一様）',
    params: [
      { name: 's / sx sy sz', desc: '倍率。1つなら一様、3つなら軸ごと' },
      { name: 'origin:', desc: '基準: "world"(既定), "local"(BBox中心), (x,y,z)', optional: true },
    ],
    example: '| scale 2',
  },
  mirror: {
    signature: '| mirror "axis"',
    desc: '形状を鏡像反転',
    params: [
      { name: 'axis', desc: '反転軸: "X" / "Y" / "Z"（文字列）' },
    ],
    example: '| mirror "X"',
  },
  floor: {
    signature: '| floor',
    desc: '底面をz=0に揃える（プリミティブは原点中心なので接地させる時に使う）',
    params: [],
    example: 'box 10 10 10 | floor',
  },
  color: {
    signature: '| color name | color r g b [alpha:a]',
    desc: '形状に色を設定',
    params: [
      { name: 'name / r g b', desc: '色名 "red" またはRGB値' },
      { name: 'alpha:', desc: '透明度 0..1', optional: true },
    ],
    example: '| color "steel"',
  },
  faces: {
    signature: '| faces selector',
    desc: '面を選択（暗黙的にワークプレーンを作成）',
    params: [
      { name: 'selector', desc: 'top, bottom, >Z, <X 等' },
    ],
    example: '| faces top',
  },
  edges: {
    signature: '| edges selector',
    desc: 'エッジを選択',
    params: [
      { name: 'selector', desc: '>Z, =Z, <X 等' },
    ],
    example: '| edges =Z | fillet 3',
  },
  verts: {
    signature: '| verts',
    desc: '頂点を選択（2Dでは形状の頂点を返す）',
    params: [],
    example: 'rect 70 50 | verts | circle 1 | cut',
  },
  points: {
    signature: '| points positions',
    desc: '座標で点を指定',
    params: [
      { name: 'positions', desc: '座標リスト [(x,y), ...] または (polar ...) / (grid ...)' },
    ],
    example: '| points (polar 4 15) | hole 3',
  },
  grid: {
    signature: '| grid nx ny [pitch]',
    desc: '形状を矩形配列にコピー',
    params: [
      { name: 'nx', desc: '列数' },
      { name: 'ny', desc: '行数' },
      { name: 'pitch', desc: '間隔（デフォルト: 10）', optional: true },
    ],
    example: 'box 5 5 3 | grid 4 3 20',
  },
  polar: {
    signature: '| polar count radius',
    desc: '形状を円形配列にコピー',
    params: [
      { name: 'count', desc: 'コピー数' },
      { name: 'radius', desc: '配列の半径' },
    ],
    example: 'cylinder 5 10 | polar 6 20',
  },
  workplane: {
    signature: '| workplane ["XY"|"XZ"|"YZ"]',
    desc: 'ワークプレーンを明示的に設定',
    params: [
      { name: 'axis', desc: '軸の指定（省略時は面から自動設定）', optional: true },
    ],
  },
  move: {
    signature: '| move dx dy [origin:"world"|(x,y,z)]',
    desc: '2Dスケッチ上で相対移動',
    params: [
      { name: 'dx', desc: 'X方向の移動量' },
      { name: 'dy', desc: 'Y方向の移動量' },
      { name: 'origin:', desc: '座標基準: "world", (x,y,z)', optional: true },
    ],
  },
  moveto: {
    signature: '| moveto x y [origin:"world"|(x,y,z)]',
    desc: '2Dスケッチ上で絶対移動',
    params: [
      { name: 'x', desc: 'X座標' },
      { name: 'y', desc: 'Y座標' },
      { name: 'origin:', desc: '座標基準: "world", (x,y,z)', optional: true },
    ],
  },
};

function createTooltipDOM(sig: FuncSignature): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ps-tooltip';
  el.innerHTML = `<div class="ps-tooltip-sig">${sig.signature}</div>`
    + `<div class="ps-tooltip-desc">${sig.desc}</div>`
    + (sig.params.length > 0
      ? '<div class="ps-tooltip-params">'
        + sig.params.map(p =>
          `<div class="ps-tooltip-param">`
          + `<span class="ps-tooltip-pname">${p.name}</span>`
          + `${p.optional ? '<span class="ps-tooltip-opt">?</span>' : ''}`
          + ` — ${p.desc}</div>`
        ).join('')
        + '</div>'
      : '')
    + (sig.example
      ? `<div class="ps-tooltip-ex">${sig.example}</div>`
      : '');
  return el;
}

/** Where the tooltip's footer links to, and what it says. Unset: no footer. */
export interface PolyscriptDocsLink {
  url: string;
  label: string;
}

function appendDocsLink(el: HTMLElement, docs: PolyscriptDocsLink): void {
  const a = document.createElement('a');
  a.className = 'ps-tooltip-docs';
  a.href = docs.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = `${docs.label} ↗`;
  el.appendChild(a);
}

function hoverTooltipWith(docs?: PolyscriptDocsLink) {
  return (view: EditorView, pos: number, side: number): Tooltip | null => {
    const tip = polyscriptHoverTooltip(view, pos, side);
    if (!tip || !docs) return tip;
    return {
      ...tip,
      create(v) {
        const made = tip.create(v);
        appendDocsLink(made.dom, docs);
        return made;
      },
    };
  };
}

export function polyscriptHoverTooltip(view: EditorView, pos: number, side: number): Tooltip | null {
  const { from, to, text } = view.state.doc.lineAt(pos);
  // Find the word at the hover position
  let start = pos;
  let end = pos;
  while (start > from && /\w/.test(text[start - from - 1])) start--;
  while (end < to && /\w/.test(text[end - from])) end++;
  const word = text.slice(start - from, end - from);

  if (!word || !signatures[word]) return null;

  return {
    pos: start,
    end,
    above: true,
    create() {
      const dom = createTooltipDOM(signatures[word]);
      return { dom };
    },
  };
}

export const polyscriptHoverExtension = hoverTooltip(polyscriptHoverTooltip, { hoverTime: 300 });

// --- Completion item definitions ---

const primitives3d: Completion[] = [
  { label: 'box', type: 'function', info: '3D box: box w h d' },
  { label: 'cylinder', type: 'function', info: '3D cylinder: cylinder r h' },
  { label: 'sphere', type: 'function', info: '3D sphere: sphere r' },
  { label: 'cone', type: 'function', info: '3D cone: cone r1 r2 h' },
  { label: 'torus', type: 'function', info: '3D torus: torus r1 r2' },
  { label: 'wedge', type: 'function', info: '3D wedge: wedge dx dy dz ltx' },
];

const primitives2d: Completion[] = [
  { label: 'rect', type: 'function', info: '2D rectangle: rect w h' },
  { label: 'circle', type: 'function', info: '2D circle: circle r' },
  { label: 'ellipse', type: 'function', info: '2D ellipse: ellipse rx ry' },
  { label: 'polygon', type: 'function', info: '2D regular polygon: polygon n r' },
  { label: 'polyline', type: 'function', info: '2D closed wire from points: polyline points' },
  { label: 'text', type: 'function', info: '2D text: text "..." size' },
  { label: 'sketch', type: 'function', info: '2D closed profile: sketch [segments]' },
];

const paths: Completion[] = [
  { label: 'line', type: 'function', info: 'Path: line start end' },
  { label: 'arc', type: 'function', info: 'Path: arc start through end | arc start end center:(cx,cy) | arc start end radius:radius' },
  { label: 'bezier', type: 'function', info: 'Path: bezier points' },
  { label: 'spline', type: 'function', info: 'Path: spline points' },
  { label: 'helix', type: 'function', info: 'Path: helix pitch height radius' },
  { label: 'wire', type: 'function', info: 'Open wire (sketch without auto-close): wire [segments]' },
];

const pipeOps: Completion[] = [
  { label: 'fillet', type: 'method', info: 'Round edges: fillet r' },
  { label: 'chamfer', type: 'method', info: 'Chamfer edges: chamfer r' },
  { label: 'shell', type: 'method', info: 'Hollow out: shell t [open:selector]' },
  { label: 'diff', type: 'method', info: 'Boolean subtract: diff shape' },
  { label: 'union', type: 'method', info: 'Boolean union: union shape' },
  { label: 'inter', type: 'method', info: 'Boolean intersect: inter shape' },
  { label: 'extrude', type: 'method', info: 'Extrude 2D to 3D: extrude h [draft:deg]' },
  { label: 'revolve', type: 'method', info: 'Revolve 2D: revolve axis [deg]' },
  { label: 'sweep', type: 'method', info: 'Sweep profile along this path: sweep profile' },
  { label: 'loft', type: 'method', info: 'Loft through sections: loft [sections] h' },
  { label: 'offset', type: 'method', info: 'Offset wire/face outline: offset d' },
  { label: 'place', type: 'method', info: 'Place a 2D shape on the selected face: place shape' },
  { label: 'cut', type: 'method', info: 'Cut into face: cut [depth]' },
  { label: 'hole', type: 'method', info: 'Drill hole: hole r [at:x y] [origin:"world"]' },
  { label: 'translate', type: 'method', info: 'Move: translate x y z' },
  { label: 'rotate', type: 'method', info: 'Rotate: rotate rx ry rz' },
  { label: 'scale', type: 'method', info: 'Scale: scale s | scale sx sy sz' },
  { label: 'mirror', type: 'method', info: 'Mirror: mirror "X" | "Y" | "Z"' },
  { label: 'floor', type: 'method', info: 'Align bottom to z=0: floor' },
  { label: 'move', type: 'method', info: 'Move 2D sketch [origin:"world"]' },
  { label: 'moveto', type: 'method', info: 'Move 2D sketch to position [origin:"world"]' },
  { label: 'color', type: 'method', info: 'Set color: color "name" | color r g b' },
  { label: 'faces', type: 'method', info: 'Select faces: faces selector' },
  { label: 'edges', type: 'method', info: 'Select edges: edges selector' },
  { label: 'verts', type: 'method', info: 'Select vertices: verts selector' },
  { label: 'workplane', type: 'method', info: 'Set workplane on face' },
  { label: 'points', type: 'method', info: 'Select points: points [(x,y), ...]' },
  { label: 'grid', type: 'method', info: 'Grid array: grid nx ny pitch' },
  { label: 'polar', type: 'method', info: 'Polar array: polar count radius' },
  { label: 'as', type: 'method', info: 'Name selection: as $name' },
];

const selectors: Completion[] = [
  { label: 'top', type: 'constant', info: 'Alias for >Z (highest)' },
  { label: 'bottom', type: 'constant', info: 'Alias for <Z (lowest)' },
  { label: 'left', type: 'constant', info: 'Alias for <X' },
  { label: 'right', type: 'constant', info: 'Alias for >X' },
  { label: 'front', type: 'constant', info: 'Alias for <Y' },
  { label: 'back', type: 'constant', info: 'Alias for >Y' },
  { label: '>Z', type: 'constant', info: 'Max Z face/edge' },
  { label: '<Z', type: 'constant', info: 'Min Z face/edge' },
  { label: '>X', type: 'constant', info: 'Max X face/edge' },
  { label: '<X', type: 'constant', info: 'Min X face/edge' },
  { label: '>Y', type: 'constant', info: 'Max Y face/edge' },
  { label: '<Y', type: 'constant', info: 'Min Y face/edge' },
  { label: '=Z', type: 'constant', info: 'Parallel to Z axis' },
  { label: '=X', type: 'constant', info: 'Parallel to X axis' },
  { label: '=Y', type: 'constant', info: 'Parallel to Y axis' },
  { label: '+Z', type: 'constant', info: 'Perpendicular to Z' },
  { label: '+X', type: 'constant', info: 'Perpendicular to X' },
  { label: '+Y', type: 'constant', info: 'Perpendicular to Y' },
];

const annotations: Completion[] = [
  {
    label: '@param',
    type: 'keyword',
    info: 'Parameter annotation: @param min..max step:s desc:"..."',
  },
  {
    label: '@profile',
    type: 'keyword',
    info: 'Preset profile: @profile { "Name": { var: value, ... }, ... }',
    apply: '@profile {\n  "Default": {  },\n}',
  },
];

const keywords: Completion[] = [
  { label: 'def', type: 'keyword', info: 'Define function: def name($args) = ...' },
  { label: 'import', type: 'keyword', info: 'Import library: import "name"' },
  { label: 'assert', type: 'keyword', info: 'Check an intent: assert $g.solids == 1 / assert $g.volume ~ 3225 tol:1%' },
  { label: 'print', type: 'keyword', info: 'Report values: print "vol" $g.volume' },
  { label: 'if', type: 'keyword', info: 'Conditional: if cond then expr else expr' },
  { label: 'then', type: 'keyword', info: 'Then branch of if' },
  { label: 'else', type: 'keyword', info: 'Else branch of if' },
  { label: 'for', type: 'keyword', info: 'Loop: for $x in range($n)' },
  { label: 'in', type: 'keyword', info: 'Iterator keyword' },
  { label: 'range', type: 'keyword', info: 'Range: range(n) or range(start, end, step)' },
  { label: 'at', type: 'keyword', info: 'Placement: shape at $x $y [$z]' },
  { label: 'and', type: 'keyword', info: 'Logical AND' },
  { label: 'or', type: 'keyword', info: 'Logical OR' },
  { label: 'true', type: 'keyword', info: 'Boolean true' },
  { label: 'false', type: 'keyword', info: 'Boolean false' },
];

const builtinFunctions: Completion[] = [
  { label: 'clear', type: 'function', info: 'True when two solids do not intersect: clear($a, $b)', apply: 'clear(' },
  { label: 'sin', type: 'function', info: 'Sine (radians): sin(x)', apply: 'sin(' },
  { label: 'cos', type: 'function', info: 'Cosine (radians): cos(x)', apply: 'cos(' },
  { label: 'tan', type: 'function', info: 'Tangent (radians): tan(x)', apply: 'tan(' },
  { label: 'asin', type: 'function', info: 'Arcsine: asin(x)', apply: 'asin(' },
  { label: 'acos', type: 'function', info: 'Arccosine: acos(x)', apply: 'acos(' },
  { label: 'atan', type: 'function', info: 'Arctangent: atan(x)', apply: 'atan(' },
  { label: 'atan2', type: 'function', info: 'Two-arg arctangent: atan2(y, x)', apply: 'atan2(' },
  { label: 'sqrt', type: 'function', info: 'Square root: sqrt(x)', apply: 'sqrt(' },
  { label: 'radians', type: 'function', info: 'Degrees to radians: radians(x)', apply: 'radians(' },
  { label: 'degrees', type: 'function', info: 'Radians to degrees: degrees(x)', apply: 'degrees(' },
  { label: 'floor', type: 'function', info: 'Floor: floor(x)', apply: 'floor(' },
  { label: 'ceil', type: 'function', info: 'Ceiling: ceil(x)', apply: 'ceil(' },
  { label: 'pi', type: 'constant', info: 'Pi constant: 3.14159...' },
];


const keywordArgs: Completion[] = [
  { label: 'draft:', type: 'property', info: 'Draft angle for extrude (degrees)' },
  { label: 'X', type: 'keyword', info: 'X axis (revolve)' },
  { label: 'Y', type: 'keyword', info: 'Y axis (revolve)' },
  { label: 'Z', type: 'keyword', info: 'Z axis (revolve)' },
  { label: 'open:', type: 'property', info: 'Open face for shell: open:>Z' },
  { label: 'pitch:', type: 'property', info: 'Pitch distance (helix, grid)' },
  { label: 'height:', type: 'property', info: 'Height parameter (helix)' },
  { label: 'radius:', type: 'property', info: 'Radius parameter (helix, polar)' },
  { label: 'count:', type: 'property', info: 'Count parameter (polar)' },
  { label: 'nx:', type: 'property', info: 'Grid columns' },
  { label: 'ny:', type: 'property', info: 'Grid rows' },
  { label: 'step:', type: 'property', info: '@param step size' },
  { label: 'desc:', type: 'property', info: '@param description' },
  { label: 'min:', type: 'property', info: '@param minimum value' },
  { label: 'max:', type: 'property', info: '@param maximum value' },
  { label: 'choices:', type: 'property', info: '@param choice list' },
  { label: 'group:', type: 'property', info: '@param UI group name' },
  { label: 'type:', type: 'property', info: '@param type hint' },
  { label: 'hidden:', type: 'property', info: '@param hide from UI' },
  { label: 'depth:', type: 'property', info: 'Cut/hole depth' },
  { label: 'alpha:', type: 'property', info: 'Color transparency (0..1)' },
  { label: 'at:', type: 'property', info: 'Position: at:x y (2D=WP基準, 3D=ワールド)' },
  { label: 'origin:', type: 'property', info: 'Transform/placement origin: "world", "local", (x,y,z)' },
  { label: 'size:', type: 'property', info: 'Text size parameter' },
];

// --- Helpers ---

/** Check if cursor position is right after a pipe `|` (with optional whitespace). */
function isAfterPipe(line: string, pos: number): boolean {
  const before = line.slice(0, pos).trimEnd();
  // Matches "| " or just "|" at end, or "| word" where word is what we're typing
  // We look for the last pipe that isn't inside quotes
  let i = before.length - 1;
  // Skip back over the current word being typed
  while (i >= 0 && /\w/.test(before[i])) i--;
  // Skip whitespace
  while (i >= 0 && before[i] === ' ') i--;
  return i >= 0 && before[i] === '|';
}

/** Check if the cursor is right after `faces`, `edges`, or `verts`. */
function isAfterSelector(line: string, pos: number): boolean {
  const before = line.slice(0, pos).trimEnd();
  // Strip current word
  let i = before.length - 1;
  while (i >= 0 && /\w/.test(before[i])) i--;
  const prefix = before.slice(0, i + 1).trimEnd();
  return /\b(faces|edges|verts)\s*$/.test(prefix);
}


/** Check if cursor is at the start of meaningful content on a line. */
function isLineStart(line: string, pos: number): boolean {
  const before = line.slice(0, pos).trim();
  // At line start (possibly after whitespace), or nothing meaningful typed yet
  // Allow a partial word the user is typing
  return /^\w*$/.test(before);
}

// --- Main completion source ---

export function polyscriptCompletion(context: CompletionContext): CompletionResult | null {
  // Get the current word being typed (include @ for annotations)
  const word = context.matchBefore(/[@\w+><=:]+/);

  // If no word and not explicitly requested, don't show completions
  if (!word && !context.explicit) return null;

  const from = word ? word.from : context.pos;
  const text = word ? word.text : '';

  // Get the full line up to the cursor
  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text;
  const colPos = context.pos - line.from;

  // Determine context and build options
  let options: Completion[];

  if (isAfterSelector(lineText, colPos)) {
    // After faces/edges/verts -> show selectors
    options = selectors;
  } else if (isAfterPipe(lineText, colPos)) {
    // After pipe -> prioritize pipe operations, but include 2D primitives too (for workplane context)
    options = [
      ...pipeOps,
      ...primitives2d,
    ];
  } else if (isLineStart(lineText, colPos)) {
    // Line start -> primitives, keywords, paths, builtins, annotations
    options = [
      ...annotations,
      ...primitives3d,
      ...primitives2d,
      ...paths,
      ...keywords,
      ...builtinFunctions,
    ];
  } else {
    // General context -> everything
    options = [
      ...annotations,
      ...primitives3d,
      ...primitives2d,
      ...paths,
      ...pipeOps,
      ...keywords,
      ...builtinFunctions,
      ...keywordArgs,
    ];
  }

  // For keyword args (ending with ':'), match on the prefix before ':'
  // For selectors with symbols (>Z, <X, etc.), the matchBefore regex already captures them

  if (!text && !context.explicit) return null;

  // Filter by prefix match (not substring) to avoid "tru" matching "extrude"
  const prefix = text.toLowerCase();
  const filtered = prefix
    ? options.filter(o => o.label.toLowerCase().startsWith(prefix))
    : options;

  if (filtered.length === 0) return null;

  return {
    from,
    options: filtered,
    filter: false,  // disable CodeMirror's default substring matching
  };
}

// --- Tooltip theme (default styling) ---

const polyscriptTooltipTheme = EditorView.theme({
  '.cm-tooltip': { border: '1px solid #d1d5db', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' },
  '.ps-tooltip': { padding: '8px 10px', fontSize: '12px', lineHeight: '1.5', maxWidth: '360px' },
  '.ps-tooltip-sig': { fontFamily: "'JetBrains Mono', monospace", fontWeight: '600', color: '#1a1a2e', marginBottom: '4px' },
  '.ps-tooltip-desc': { color: '#4a5568', marginBottom: '4px' },
  '.ps-tooltip-params': { borderTop: '1px solid #e2e8f0', paddingTop: '4px', marginBottom: '4px' },
  '.ps-tooltip-param': { color: '#4a5568', fontSize: '11px' },
  '.ps-tooltip-pname': { fontFamily: "'JetBrains Mono', monospace", fontWeight: '600', color: '#2b6cb0' },
  '.ps-tooltip-opt': { color: '#a0aec0', fontSize: '10px', marginLeft: '1px' },
  '.ps-tooltip-ex': { fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#718096', borderTop: '1px solid #e2e8f0', paddingTop: '4px' },
  '.ps-tooltip-docs': { display: 'block', marginTop: '4px', fontSize: '11px', color: '#3182ce', textDecoration: 'none' },
  '.ps-tooltip-docs:hover': { textDecoration: 'underline' },
});

// --- Bundled extension ---


/**
 * Returns a CodeMirror Extension that provides PolyScript language support:
 * - Autocompletion (primitives, pipe ops, keywords, selectors, etc.)
 * - Hover tooltips with function signatures
 * - Tooltip styling
 *
 * `docs` adds a link at the foot of each hover tooltip. The tooltip stays
 * open while the pointer is over it, so the link can be clicked.
 */
export function polyscriptLanguageSupport(options: { docs?: PolyscriptDocsLink } = {}): Extension {
  return [
    autocompletion({
      override: [polyscriptCompletion],
      activateOnTyping: true,
      selectOnOpen: false,
    }),
    options.docs ? hoverTooltip(hoverTooltipWith(options.docs), { hoverTime: 300 }) : polyscriptHoverExtension,
    polyscriptTooltipTheme,
  ];
}
