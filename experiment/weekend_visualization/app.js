const parseDate = d3.timeParse("%Y-%m-%d");
const formatDate = d3.timeFormat("%Y.%m.%d");
const formatShort = d3.timeFormat("%m.%d");
const weekStep = 7 * 864e5;
const colors = [
  "#9a6200", "#b47a00", "#765600", "#c59300", "#7f5d10", "#ab7100",
  "#6e4b00", "#b18516", "#8f6500", "#a77f10", "#5c4300", "#be8b00"
];
const pageStyle = getComputedStyle(document.documentElement);
const theme = Object.fromEntries([['background', '--paper'], ['ink', '--ink'], ['emphasis', '--emphasis'], ['light', '--light'],
  ['similarityLow', '--similarity-low'], ['similarityMid', '--similarity-mid'], ['similarityHigh', '--similarity-high']]
  .map(([key, property]) => [key, pageStyle.getPropertyValue(property).trim()]));
const palette = d3.scaleOrdinal(colors);
const tooltip = d3.select("#tooltip");
const chart = d3.select("#chart");
themes.forEach(d => d.date = parseDate(d.date));
const dates = themes.map(d => d.date);
const minDate = d3.min(dates);
const maxDate = d3.max(dates);
const state = {
  start: d3.timeWeek.offset(maxDate, -25),
  end: maxDate
};
const totalByProvider = d3.rollup(themes, rows => rows.length, d => d.provider);
const providerOrder = [...totalByProvider].sort((a, b) => b[1] - a[1]).map(d => d[0]);
palette.domain(providerOrder);
let currentView = [];

const chartCenter = { x: 500, y: 0 };
const pieRadius = 138;
const authorNameStyle = { min: 7, max: 11, step: .5, minSpan: .04, radius: 155 };
const cloudInner = 174;
const cloudTop = 1;
const cloudOuter = 460;
const pie = d3.pie().value(d => d.records.length).sort(null)
  .startAngle(Math.PI / 2).endAngle(Math.PI * 1.5);
const arc = d3.arc().innerRadius(91).outerRadius(pieRadius).padAngle(0).cornerRadius(0);
const similarityArc = d3.arc().innerRadius(140).outerRadius(170).padAngle(0).cornerRadius(0);
const guideArc = d3.arc().innerRadius(cloudInner).outerRadius(cloudOuter);
const chartRoot = chart.append("g")
  .attr("transform", `translate(${chartCenter.x},${chartCenter.y})`);
const guideLayer = chartRoot.append("g");
const cloudLayer = chartRoot.append("g");
const pieLayer = chartRoot.append("g");
const similarityLayer = chartRoot.append("g").attr("class", "similarity-layer");
const labelLayer = chartRoot.append("g");
const centerLayer = chartRoot.append("g");
const timeline = d3.select("#timeline");
let dragStartX = null;
let dragOrigin = null;
let frame = 0;
let chartTimer = 0;
let lastWheelAt = null;
let lastWheelDirection = 0;
let wheelFrequency = 4;
const textWidths = new Map();
const wordMeasures = new Map();
const measure = document.createElement("canvas").getContext("2d");
const fontFamily = '"Microsoft YaHei", "Noto Sans SC", sans-serif';
let semanticIndex = new Map();
let authorIndex = new Map();
let semanticMessage = "";
let selectedAuthor = null;
let hoveredAuthor = null;
let hoveredWord = null;
let focusWords = new Map();
let focusAuthors = new Map();
const focusCache = new Map();

function initializeSemantics() {
  try {
    semanticIndex = wordInteraction.createIndex(semanticEmbeddings);
    authorIndex = wordInteraction.createAuthorIndex(semanticEmbeddings);
    const terms = new Set(themes.flatMap(row => row.terms));
    const missing = [...terms].filter(term => !semanticIndex.has(term)).length;
    semanticMessage = semanticIndex.size
      ? `${semanticEmbeddings.model} · 余弦相似度连续高亮${missing ? ` · ${missing} 个词缺少向量` : ""}`
      : "尚未生成真实词向量；运行 python prepare_embeddings.py 后刷新，当前仅展示聚焦词。";
  } catch (error) {
    semanticMessage = `词向量加载失败：${error.message}`;
  }
  semanticStatus();
}

function semanticStatus(term = null, provider = null) {
  const ready = semanticIndex.size > 0;
  const missing = term && !semanticIndex.has(term);
  const label = term ? `词语：${term}` : provider ? `${selectedAuthor ? "已锁定" : "聚焦"}出题人：${provider}，点击空白处取消` : semanticMessage;
  const message = missing ? `“${term}”没有词向量，不推测它与其他词的语义关系。` : label;
  d3.select("#semantic-status").classed("ready", ready && !missing).text(message).attr("title", message);
}

function visibleThemes() {
  return themes.filter(d => d.date >= state.start && d.date <= state.end);
}

function groupThemes(rows) {
  return d3.rollups(rows, records => records, d => d.provider)
    .map(([provider, records]) => ({ provider, records }))
    .sort((a, b) => b.records.length - a.records.length || d3.ascending(a.provider, b.provider));
}

function buildWords(arcs) {
  return arcs.flatMap(sector => {
    const terms = d3.rollup(
      sector.data.records.flatMap(record => record.terms),
      values => values.length,
      term => term
    );
    const entries = [...terms].sort((a, b) => b[1] - a[1] || d3.ascending(a[0], b[0]));
    return entries.map(([term, count], index) => ({
      term, count, index, total: entries.length,
      provider: sector.data.provider,
      start: sector.startAngle,
      end: sector.endAngle
    }));
  });
}

function pieData(groups) {
  const records = new Map(groups.map(group => [group.provider, group.records]));
  const ranked = providerOrder.map(provider => ({ provider, records: records.get(provider) || [] }))
    .sort((a, b) => b.records.length - a.records.length);
  const [largest, ...rest] = ranked;
  const before = balancedBefore(rest);
  const first = rest.filter(group => group.records.length && before.has(group.provider)).reverse();
  const last = rest.filter(group => group.records.length && !before.has(group.provider));
  const hidden = rest.filter(group => !group.records.length);
  return [...first, largest, ...last, ...hidden];
}

function balancedBefore(groups) {
  const target = Math.floor(d3.sum(groups, group => group.records.length) / 2);
  const sums = new Map([[0, []]]);
  for (const group of groups) {
    if (!group.records.length) continue;
    for (const [sum, members] of [...sums]) {
      const next = sum + group.records.length;
      if (next <= target && !sums.has(next)) sums.set(next, [...members, group.provider]);
    }
  }
  return new Set(sums.get(Math.max(...sums.keys())));
}

function wordColor(provider) {
  return d3.color(palette(provider)).darker(.75).formatHex();
}

function animationDuration() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
}

function drawChart() {
  chart.attr("aria-busy", null);
  const rows = visibleThemes();
  const groups = groupThemes(rows);
  const sectors = pie(pieData(groups));
  const words = buildWords(sectors);
  currentView = { rows, groups, sectors };
  hideTooltip();
  semanticStatus();
  chartRoot.selectAll(".empty").remove();
  updateStats(rows, groups);
  drawGuides(sectors);
  drawWords(words);
  drawSectors(sectors);
  applyFocus();
  if (!rows.length) drawEmpty();
}

function drawGuides(sectors) {
  guideLayer.selectAll("path")
    .data(sectors)
    .join("path")
    .attr("class", "guide")
    .attr("d", guideArc)
    .attr("data-provider", d => d.data.provider);
}

function drawWords(words) {
  const nodes = layoutWords(words);
  currentView.words = nodes;
  currentView.cloudRadius = d3.max(nodes, word => word.outer) || cloudOuter;
  currentView.focusSafety = wordInteraction.scatterSafety(nodes.map(focusBox), currentView.sectors);
  const groups = cloudLayer.selectAll(".word-node")
    .data(nodes, d => `${d.provider}\0${d.term}`)
    .join(
      enter => enter.append("g").attr("opacity", 0),
      update => update,
      exit => exit.interrupt("layout").transition("layout").duration(animationDuration() / 2).attr("opacity", 0).remove()
    )
    .attr("class", "word-node")
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", d => `${d.term}，${d.provider}，聚焦查看语义相近词`)
    .on("focus", showWordTooltip)
    .on("blur", () => { highlight(null); hideTooltip(); });
  drawWordMarks(groups);
  groups.interrupt("layout").transition("layout").duration(animationDuration()).attr("opacity", 1);
  showOverflow(words, nodes);
}

function wordTransform(word) {
  return `translate(${word.x},${word.y}) rotate(${word.rotation})`;
}

function drawWordMarks(groups) {
  const hits = groups.selectAll("rect.word-hit").data(d => [d]).join(
    enter => enter.append("rect").attr("transform", wordTransform)
  ).attr("class", "word-hit")
    .attr("x", d => -(d.metrics.width + 1) / 2).attr("y", d => -(d.metrics.height + 1) / 2)
    .attr("width", d => d.metrics.width + 1).attr("height", d => d.metrics.height + 1);
  hits.interrupt("focus").interrupt("layout").transition("layout")
    .duration(animationDuration()).attr("transform", wordTransform);
  const marks = groups.selectAll("text.cloud-word").data(d => [d]).join(
    enter => enter.append("text").attr("transform", wordTransform).attr("opacity", 0)
  );
  marks.attr("class", "cloud-word")
    .attr("data-provider", d => d.provider)
    .attr("font-size", d => d.size)
    .attr("fill", d => wordColor(d.provider))
    .attr("text-anchor", "start")
    .attr("dominant-baseline", "alphabetic")
    .attr("x", d => d.metrics.dx).attr("y", d => d.metrics.dy)
    .text(d => d.term);
  marks.interrupt("focus").interrupt("layout")
    .transition("layout").duration(animationDuration()).ease(d3.easeCubicInOut)
    .attr("opacity", .72).attr("transform", wordTransform);
}

function layoutWords(words) {
  if (!words.length) return [];
  const profile = cloudProfile(words);
  let best = [];
  for (let base = profile.size; ; base = Math.max(10, base - 2)) {
    const placed = packWords(words, profile, base);
    if (placed.length > best.length) best = placed;
    if (placed.length === words.length || base === 10) return best;
  }
}

function cloudProfile(words) {
  const outer = Math.min(cloudOuter, 300 + words.length * 2.5);
  const area = Math.PI * (outer * outer - cloudInner * cloudInner) / 2;
  const units = d3.sum(words, word => textWidth(word.term, 10) / 10 * 1.12);
  const size = Math.max(10, Math.min(56, Math.floor(Math.sqrt(area * .26 / Math.max(1, units)))));
  return { outer, size, compact: words.length < 180 };
}

function packWords(words, profile, base) {
  const grid = new Map();
  const ordered = [...words].sort((a, b) => b.count - a.count || b.term.length - a.term.length);
  return ordered.flatMap(word => {
    const preferred = Math.min(64, Math.round(base * (1 + .12 * (Math.sqrt(word.count) - 1))));
    const placed = placeWord({ ...word, outer: profile.outer, compact: profile.compact }, preferred, grid);
    if (!placed) return [];
    gridKeys(placed).forEach(key => {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(placed);
    });
    return [placed];
  });
}

function placeWord(word, preferred, grid) {
  for (const slack of [0, .055, .12, .22, .35]) {
    for (let size = preferred; size >= 9; size -= 1) {
      const width = wordMetrics(word.term, size).width + 4;
      if (width > (word.outer || cloudOuter) - cloudInner - 8) continue;
      for (let attempt = 0; attempt < 520; attempt++) {
        const box = wordCandidate(word, size, width, attempt, slack);
        if (fitsCloud(box, word, slack) && !nearbyBoxes(box, grid).some(other => boxesOverlap(box, other))) {
          return box;
        }
      }
    }
  }
  return null;
}

function textWidth(term, size, weight = 600) {
  const key = `${weight}:${size}\0${term}`;
  if (textWidths.has(key)) return textWidths.get(key);
  measure.font = `${weight} ${size}px ${fontFamily}`;
  const width = measure.measureText(term).width;
  textWidths.set(key, width);
  return width;
}

function wordMetrics(term, size) {
  const key = `${size}\0${term}`;
  if (!wordMeasures.has(key)) {
    measure.font = `600 ${size}px ${fontFamily}`;
    measure.textAlign = "left";
    measure.textBaseline = "alphabetic";
    const bounds = measure.measureText(term);
    const left = bounds.actualBoundingBoxLeft ?? 0;
    const right = bounds.actualBoundingBoxRight ?? bounds.width;
    const ascent = bounds.actualBoundingBoxAscent ?? size * .8;
    const descent = bounds.actualBoundingBoxDescent ?? size * .2;
    wordMeasures.set(key, { width: Math.max(1, left + right), height: Math.max(1, ascent + descent),
      dx: (left - right) / 2, dy: (ascent - descent) / 2 });
  }
  return wordMeasures.get(key);
}

function focusBox(word) {
  return makeBox(word, word.metrics.width + 1, word.metrics.height + 1);
}

function wordCandidate(word, size, width, attempt, slack) {
  const metrics = wordMetrics(word.term, size);
  const fraction = attempt ? (attempt * .61803398875) % 1 : (word.index + .5) / word.total;
  const start = Math.max(Math.PI / 2, word.start - slack);
  const end = Math.min(Math.PI * 1.5, word.end + slack);
  const angle = start + fraction * (end - start);
  const near = cloudInner + width / 2 + 4;
  const far = (word.outer || cloudOuter) - width / 2 - 4;
  const fractionRadius = (attempt * .754877666 + word.index * .381966) % 1;
  const radius = near + (word.compact ? fractionRadius ** 2 : fractionRadius) * (far - near);
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  return makeBox({ ...word, size, angle, x, y, metrics }, width, metrics.height + 4);
}

function makeBox(word, width, height) {
  const rotation = readableAngle(word);
  const radians = rotation * Math.PI / 180;
  const axes = [[Math.cos(radians), Math.sin(radians)], [-Math.sin(radians), Math.cos(radians)]];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    word.x + u * axes[0][0] * width / 2 + v * axes[1][0] * height / 2,
    word.y + u * axes[0][1] * width / 2 + v * axes[1][1] * height / 2
  ]);
  const xs = corners.map(point => point[0]);
  const ys = corners.map(point => point[1]);
  return { ...word, rotation, axes, corners, width, height,
    left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function fitsCloud(box, word, slack) {
  const middle = (word.start + word.end) / 2;
  return box.corners.every(([x, y]) => {
    const radius = Math.hypot(x, y);
    const angle = middle + angleDifference(Math.atan2(x, -y), middle);
    return y >= cloudTop && radius >= cloudInner && radius <= (word.outer || cloudOuter) &&
      angle >= word.start - slack && angle <= word.end + slack;
  });
}

function angleDifference(angle, reference) {
  return Math.atan2(Math.sin(angle - reference), Math.cos(angle - reference));
}

function gridKeys(box) {
  const keys = [];
  for (let x = Math.floor(box.left / 48); x <= Math.floor(box.right / 48); x++) {
    for (let y = Math.floor(box.top / 48); y <= Math.floor(box.bottom / 48); y++) {
      keys.push(`${x},${y}`);
    }
  }
  return keys;
}

function nearbyBoxes(box, grid) {
  return [...new Set(gridKeys(box).flatMap(key => grid.get(key) || []))];
}

function boxesOverlap(a, b) {
  if (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom) return false;
  return [...a.axes, ...b.axes].every(([x, y]) => {
    const project = box => box.corners.map(point => point[0] * x + point[1] * y);
    const first = project(a);
    const second = project(b);
    return Math.max(...first) > Math.min(...second) && Math.max(...second) > Math.min(...first);
  });
}

function showOverflow(words, placed) {
  const visible = new Set(placed.map(word => `${word.provider}\0${word.term}`));
  const remaining = words.filter(word => !visible.has(`${word.provider}\0${word.term}`));
  d3.select("#overflow").property("hidden", !remaining.length);
  d3.select("#overflow-words").text(remaining.map(word => `${word.provider}：${word.term}`).join("；"));
}

function readableAngle(word) {
  const degrees = word.angle * 180 / Math.PI - 90;
  return ((degrees + 90) % 180 + 180) % 180 - 90;
}

function sectorAngles(sector) {
  return { startAngle: sector.startAngle, endAngle: sector.endAngle, padAngle: sector.padAngle || 0 };
}

function tweenArc(node, sector, shape) {
  const target = sectorAngles(sector);
  const previous = node.__arc || { ...target, endAngle: target.startAngle };
  const interpolate = d3.interpolateObject(previous, target);
  return progress => {
    node.__arc = interpolate(progress);
    return shape(node.__arc);
  };
}

function arcTween(sector) {
  return tweenArc(this, sector, arc);
}

function similarityArcTween(sector) {
  return tweenArc(this, sector, similarityArc);
}

function similarityBandColor(score) {
  const strength = wordInteraction.strength(score);
  if (strength === null) return theme.background;
  return d3.interpolateRgbBasis([theme.similarityLow, theme.similarityMid, theme.similarityHigh])(strength);
}

function similarityGradientId(provider) {
  return `author-similarity-${providerOrder.indexOf(provider)}`;
}

function similarityStops(provider) {
  return [
    { radius: 0, score: true },
    { radius: 140, score: true },
    { radius: 170, score: false }
  ].map(stop => ({ ...stop, provider }));
}

function authorAt(point, sectors, preferred = null, outer = cloudOuter) {
  const [x, y] = point;
  const radius = Math.hypot(x, y);
  if (y < 0 || radius < 76 || radius > outer + 32) return null;
  const angle = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
  const contains = sector => {
    const pad = Math.min(.015, (sector.endAngle - sector.startAngle) * .12);
    return sector.value > 0 && angle >= sector.startAngle - pad && angle <= sector.endAngle + pad;
  };
  const sector = sectors.find(item => item.data.provider === preferred && contains(item)) || sectors.find(contains);
  return sector?.data.provider || null;
}

function sectorTextColor() {
  return theme.emphasis;
}

function cropName(name, size, available) {
  if (textWidth(name, size, 700) <= available) return name;
  const chars = Array.from(name);
  while (chars.length && textWidth(chars.join("") + "…", size, 700) > available) chars.pop();
  return chars.length ? chars.join("") + "…" : "";
}

function radialName(text, size) {
  const radius = authorNameStyle.radius;
  return { text, size, radial: true, available: Math.min(radius - 140, 170 - radius) * 2 - 1 };
}

function labelFitsSector(sector, label) {
  if (!label.text || textWidth(label.text, label.size, 700) > label.available) return false;
  const angle = (sector.startAngle + sector.endAngle) / 2;
  const box = makeBox({ x: Math.sin(angle) * authorNameStyle.radius, y: -Math.cos(angle) * authorNameStyle.radius, angle },
  textWidth(label.text, label.size, 700) + 1, label.size * 1.25);
  return box.corners.every(([x, y]) => {
    const radius = Math.hypot(x, y);
    const theta = angle + angleDifference(Math.atan2(x, -y), angle);
    return y >= 0 && radius >= 140 && radius <= 170 && theta >= sector.startAngle && theta <= sector.endAngle;
  });
}

function sectorLabelFit(sector) {
  const hidden = radialName("", authorNameStyle.min);
  if (sector.endAngle - sector.startAngle < authorNameStyle.minSpan) return hidden;
  for (let size = authorNameStyle.max; size >= authorNameStyle.min; size -= authorNameStyle.step) {
    const label = radialName(sector.data.provider, size);
    if (labelFitsSector(sector, label)) return label;
  }
  const label = radialName(cropName(sector.data.provider, hidden.size, hidden.available), hidden.size);
  return labelFitsSector(sector, label) ? label : hidden;
}

function drawSectors(sectors) {
  pieLayer.selectAll("path")
    .data(sectors, d => d.data.provider)
    .join("path")
    .attr("class", "sector")
    .attr("fill", d => palette(d.data.provider))
    .attr("tabindex", d => d.value ? 0 : -1)
    .attr("aria-hidden", d => d.value ? null : "true")
    .attr("pointer-events", d => d.value ? "auto" : "none")
    .attr("role", "button")
    .attr("aria-label", d => sectorLabel(d))
    .on("click", (event, d) => { event.stopPropagation(); lockAuthor(d.data.provider); })
    .on("keydown", (event, d) => authorKey(event, d.data.provider))
    .on("focus", (event, d) => highlight(d.data.provider))
    .on("blur", () => highlight(null))
    .interrupt("pie").transition("pie").duration(animationDuration()).ease(d3.easeCubicInOut)
    .attrTween("d", arcTween);
  drawSimilarityBand(sectors);
  drawSectorLabels(sectors);
}

function drawSimilarityGradients(sectors) {
  const gradients = chart.selectAll("defs.similarity-defs").data([null]).join("defs").attr("class", "similarity-defs")
    .selectAll("radialGradient").data(sectors, d => d.data.provider).join("radialGradient")
    .attr("id", d => similarityGradientId(d.data.provider)).attr("gradientUnits", "userSpaceOnUse")
    .attr("cx", 0).attr("cy", 0).attr("r", 170);
  gradients.selectAll("stop").data(sector => similarityStops(sector.data.provider))
    .join("stop").attr("offset", d => d.radius / 170).attr("class", d => d.score ? "similarity-score-stop" : null)
    .attr("stop-color", d => d.score ? similarityBandColor(focusAuthors.get(d.provider)) : theme.background);
}

function drawSimilarityBand(sectors) {
  drawSimilarityGradients(sectors);
  similarityLayer.selectAll("path.similarity-band").data(sectors, d => d.data.provider)
    .join(enter => enter.append("path").attr("opacity", 0).attr("pointer-events", "none"))
    .attr("class", "similarity-band").attr("fill", d => `url(#${similarityGradientId(d.data.provider)})`)
    .interrupt("band-geometry").transition("band-geometry").duration(animationDuration()).ease(d3.easeCubicInOut)
    .attrTween("d", similarityArcTween);
}

function sectorLabel(d) {
  const count = d.data.records.length;
  return `${d.data.provider}，${count}期主题题，占${d3.format(".1%")(currentView.rows.length ? d.value / currentView.rows.length : 0)}`;
}

function drawSectorLabels(sectors) {
  const labels = sectors.map(sector => ({ ...sector, label: sectorLabelFit(sector) })).filter(d => d.label.text);
  labelLayer.selectAll("text")
    .data(labels, d => d.data.provider).join(
      enter => enter.append("text").attr("transform", sectorLabelTransform).attr("opacity", 0),
      update => update,
      exit => exit.transition("pie-label").duration(animationDuration() / 2).attr("opacity", 0).remove()
    )
    .attr("class", "sector-label")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .on("click", (event, d) => { event.stopPropagation(); lockAuthor(d.data.provider); })
    .attr("fill", d => sectorTextColor(d.data.provider))
    .text(d => d.label.text)
    .interrupt("pie-label").transition("pie-label").duration(animationDuration()).ease(d3.easeCubicInOut)
    .attr("font-size", d => d.label.size)
    .attr("transform", sectorLabelTransform).attr("opacity", 1);
}

function sectorLabelTransform(sector) {
  const angle = (sector.startAngle + sector.endAngle) / 2;
  const x = Math.sin(angle) * authorNameStyle.radius;
  const y = -Math.cos(angle) * authorNameStyle.radius;
  return `translate(${x},${y}) rotate(${readableAngle({ angle })})`;
}

function centerText(name, y) {
  return centerLayer.selectAll(`text.${name}`).data([null]).join("text")
    .attr("class", name).attr("text-anchor", "middle").attr("y", y);
}

function renderCenter(kicker, value, label) {
  centerLayer.selectAll("circle").data([null]).join("circle").attr("r", 76).attr("fill", theme.background);
  centerText("center-kicker", 16).text(kicker);
  centerText("center-name", 68).text(label);
  centerText("center-value", 46).interrupt("count").transition("count")
    .duration(animationDuration() / 2).tween("number", function () {
      const interpolate = d3.interpolateNumber(this.__number || 0, value);
      return progress => { this.__number = interpolate(progress); this.textContent = Math.round(this.__number); };
    });
}

function drawCenter(rows, groups) {
  renderCenter("当前区间", rows.length, `${groups.length} 位出题人`);
}

function drawEmpty() {
  chartRoot.append("text")
    .attr("class", "empty")
    .attr("y", 210)
    .attr("text-anchor", "middle")
    .text("这个区间没有主题题");
}

function highlight(provider, term = null) {
  if (hoveredAuthor === provider && hoveredWord === term) return;
  hoveredAuthor = provider;
  hoveredWord = term;
  applyFocus();
}

function handleChartPointer(event) {
  if (!currentView.sectors) return;
  const word = event.target.closest?.(".word-node");
  if (word) {
    const data = d3.select(word).datum();
    if (hoveredWord !== data.term || hoveredAuthor !== data.provider) showWordTooltip(event, data);
    else moveTooltip(event);
    return;
  }
  const point = d3.pointer(event, chartRoot.node());
  const target = event.target.closest?.(".sector, .sector-label");
  const provider = target ? d3.select(target).datum().data.provider
    : authorAt(point, currentView.sectors, hoveredAuthor, currentView.cloudRadius);
  highlight(provider);
  const sector = currentView.sectors.find(item => item.data.provider === provider);
  if (sector && (target || Math.hypot(...point) < pieRadius + 20)) showSectorTooltip(event, sector);
  else hideTooltip();
}

function lockAuthor(provider) {
  selectedAuthor = provider;
  hoveredAuthor = provider;
  hoveredWord = null;
  applyFocus();
  hideTooltip();
}

function clearAuthor() {
  selectedAuthor = null;
  hoveredAuthor = null;
  hoveredWord = null;
  applyFocus();
  hideTooltip();
}

function authorKey(event, provider) {
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  lockAuthor(provider);
}

function clearBlank(event) {
  if (event.target.closest?.(".sector, .sector-label, .word-node, .timeline-bar, .presets, .selection, #overflow")) return;
  clearAuthor();
}

function meanAuthorScores(words) {
  const totals = new Map();
  for (const row of themes) {
    const total = totals.get(row.provider) || { sum: 0, count: 0 };
    for (const term of row.terms) {
      const value = words.get(term);
      if (Number.isFinite(value)) { total.sum += value; total.count++; }
    }
    totals.set(row.provider, total);
  }
  return new Map([...totals].filter(([, total]) => total.count)
    .map(([provider, total]) => [provider, total.sum / total.count]));
}

function semanticFocus(provider, term) {
  if (!provider && !term) return { words: new Map(), authors: new Map() };
  const key = term ? `word\0${term}` : `author\0${provider}`;
  if (!focusCache.has(key)) {
    const vector = term ? semanticIndex.get(term) : authorIndex.get(provider);
    const words = wordInteraction.scores(vector, semanticIndex);
    const stored = !term && semanticEmbeddings.authorScores?.[provider];
    const authors = stored ? new Map(Object.entries(stored)) : meanAuthorScores(words);
    focusCache.set(key, { words, authors });
  }
  return focusCache.get(key);
}

function authorOpacity(target, source) {
  if (!source || target === source && !hoveredWord) return 1;
  const score = focusAuthors.get(target);
  return score === undefined ? .22 : .16 + .84 * wordInteraction.strength(score);
}

function applyHistogramFocus() {
  const provider = selectedAuthor || hoveredAuthor;
  timeline.selectAll(".timeline-bar").classed("hist-dim", false)
    .style("opacity", d => provider ? histogramOpacity(d) * authorOpacity(d.provider, provider) : null);
}

function applySimilarityBand() {
  const active = Boolean(selectedAuthor || hoveredAuthor || hoveredWord);
  similarityLayer.selectAll(".similarity-band")
    .attr("pointer-events", "none")
    .interrupt("band-emphasis").transition("band-emphasis").duration(animationDuration() / 2)
    .attr("opacity", d => active && d.value && Number.isFinite(focusAuthors.get(d.data.provider)) ? 1 : 0);
  chart.selectAll(".similarity-score-stop").interrupt("band-color")
    .transition("band-color").duration(animationDuration() / 2)
    .attr("stop-color", d => similarityBandColor(focusAuthors.get(d.provider)));
}

function applyFocus() {
  if (!currentView.sectors) return;
  const provider = selectedAuthor || hoveredAuthor;
  const term = hoveredWord;
  const scores = semanticFocus(provider, term);
  focusWords = scores.words;
  focusAuthors = scores.authors;
  const sector = currentView.sectors.find(d => d.data.provider === provider);
  pieLayer.selectAll(".sector")
    .classed("dim", false).classed("locked", d => d.data.provider === selectedAuthor)
    .attr("aria-pressed", d => d.data.provider === selectedAuthor ? "true" : "false")
    .interrupt("emphasis").transition("emphasis").duration(animationDuration() / 2)
    .attrTween("opacity", function (sector) {
      const interpolate = d3.interpolateNumber(Number(this.getAttribute("opacity") ?? 1), authorOpacity(sector.data.provider, provider));
      return progress => {
        const opacity = interpolate(progress);
        return opacity;
      };
    });
  animateWords(sector, term);
  guideLayer.selectAll(".guide")
    .classed("active", d => d.data.provider === provider);
  applyHistogramFocus();
  applySimilarityBand();
  semanticStatus(term, provider);
  if (provider) updateCenter(provider);
  else drawCenter(currentView.rows, currentView.groups);
}

function focusOpacity(word, sector, term) {
  if (term) {
    if (word.term === term) return 1;
    return wordInteraction.wordOpacity(focusWords.get(word.term) ?? null);
  }
  return !sector ? .72 : wordInteraction.wordOpacity(focusWords.get(word.term) ?? null);
}

function focusColor(word, term) {
  if (!term && !selectedAuthor && !hoveredAuthor) return wordColor(word.provider);
  const cosine = focusWords.get(word.term) ?? null;
  const value = word.term === term ? 1 : wordInteraction.strength(cosine) || 0;
  return d3.interpolateRgb(wordColor(word.provider), theme.emphasis)(value * .85);
}

function animateWords(sector, term) {
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
  const motion = cloudLayer.selectAll(".cloud-word, .word-hit").interrupt("layout").interrupt("focus")
    .transition("focus").duration(duration).ease(d3.easeCubicOut)
    .attr("transform", word => wordTransform(wordInteraction.scatter(word, sector, currentView.focusSafety)));
  motion.filter(".cloud-word")
    .attr("opacity", word => focusOpacity(word, sector, term))
    .attr("fill", word => focusColor(word, term));
}

function updateCenter(provider) {
  const group = currentView.groups.find(d => d.provider === provider);
  renderCenter(selectedAuthor ? "已锁定" : "主题题", group ? group.records.length : 0, provider);
}

function updateStats(rows, groups) {
  d3.select("#stat-themes").text(rows.length);
  d3.select("#stat-setters").text(groups.length);
  d3.select("#stat-weeks").text(Math.round((state.end - state.start) / weekStep) + 1);
  d3.select("#range-label").text(`${formatDate(state.start)} — ${formatDate(state.end)}`);
  const days = Math.round((state.end - state.start) / weekStep) + 1;
  d3.select("#range-label").attr("title", `${days} 个周次窗口`);
}

function showSectorTooltip(event, sector) {
  const rows = sector.data.records;
  const terms = [...new Set(rows.flatMap(d => d.terms))].slice(0, 9);
  const score = focusAuthors.get(sector.data.provider);
  const detail = Number.isFinite(score) ? `<br><small>全量词组平均余弦相似度：${score.toFixed(3)}</small>` : "";
  tooltip.html(
    `<b>${escapeHtml(sector.data.provider)}</b> · ${rows.length} 期<br>` +
    `<small>最新词群：${terms.map(escapeHtml).join("、")}</small>${detail}`
  ).classed("show", true);
  moveTooltip(event);
}

function showWordTooltip(event, word) {
  highlight(word.provider, word.term);
  const related = nearestWords(word.term);
  const detail = related.length ? `<br><small>相近词（余弦）：${related.join("、")}</small>` : "";
  tooltip.html(
    `<b>${escapeHtml(word.term)}</b><br>` +
    `<small>${escapeHtml(word.provider)} · 在该区间出现 ${word.count} 次</small>${detail}`
  ).classed("show", true);
  moveTooltip(event);
}

function nearestWords(term) {
  const terms = [...new Set(currentView.words.map(word => word.term))];
  return terms.filter(other => other !== term)
    .map(other => ({ term: other, score: wordInteraction.similarity(semanticIndex, term, other) }))
    .filter(item => item.score !== null)
    .sort((a, b) => b.score - a.score).slice(0, 3)
    .map(item => `${escapeHtml(item.term)} ${item.score.toFixed(2)}`);
}

function moveTooltip(event) {
  const width = tooltip.node().getBoundingClientRect().width;
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = Number.isFinite(event.clientX) ? event.clientX : bounds.x + bounds.width / 2;
  const y = Number.isFinite(event.clientY) ? event.clientY : bounds.y;
  tooltip
    .style("left", `${Math.max(8, Math.min(innerWidth - width - 28, x + 12))}px`)
    .style("top", `${Math.max(8, Math.min(innerHeight - 120, y + 12))}px`);
}

function hideTooltip() {
  tooltip.classed("show", false);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function shorten(value, limit) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function clampRange(start, end) {
  const maxStart = d3.timeWeek.offset(maxDate, -2);
  const boundedStart = d3.max([minDate, d3.min([maxStart, start])]);
  return {
    start: boundedStart,
    end: d3.min([maxDate, d3.max([d3.timeWeek.offset(boundedStart, 2), end])])
  };
}

function setRange(start, end) {
  cancelAnimationFrame(frame);
  clearTimeout(chartTimer);
  lastWheelAt = null;
  const next = clampRange(start, end);
  state.start = next.start;
  state.end = next.end;
  drawChart();
  drawTimeline();
}

function shiftWeeks(weeks) {
  const nextStart = d3.timeWeek.offset(state.start, weeks);
  const nextEnd = d3.timeWeek.offset(state.end, weeks);
  if (nextStart < minDate || nextEnd > maxDate) return;
  setRange(nextStart, nextEnd);
}

function extendEnd(weeks) {
  const next = resizeRange(weeks * weekStep);
  setRange(next.start, next.end);
}

function timelineScale(start = state.start, end = state.end) {
  const center = (+start + +end) / 2;
  const linear = 14 * 864e5;
  const extent = linear * Math.expm1(Math.log1p((end - start) / 2 / linear) * 572 / 300);
  const scale = d3.scaleSymlog().constant(linear).domain([-extent, extent]).range([28, 1172]);
  return {
    scale, center,
    dateAt: x => new Date(center + scale.invert(x)),
    xAt: date => scale(+date - center)
  };
}

function calendarPriority(date) {
  if (date.getDate() === 1) return date.getMonth() === 0 ? 3 : 2;
  return date.getDay() === 1 ? 1 : 0;
}

function calendarTicks(axis) {
  const first = d3.timeDay.ceil(d3.max([minDate, axis.dateAt(28)]));
  const last = d3.timeDay.floor(d3.min([maxDate, axis.dateAt(1172)]));
  const candidates = d3.timeDay.range(first, d3.timeDay.offset(last, 1));
  candidates.sort((a, b) => calendarPriority(b) - calendarPriority(a) ||
    Math.abs(a - axis.center) - Math.abs(b - axis.center) || a - b);
  const chosen = [];
  for (const date of candidates) {
    const x = axis.xAt(date);
    if (chosen.every(other => Math.abs(x - axis.xAt(other)) >= 88)) chosen.push(date);
  }
  return chosen.sort((a, b) => a - b);
}

function calendarScale(axis) {
  const scale = date => axis.xAt(date);
  scale.copy = () => calendarScale(axis);
  scale.range = () => [28, 1172];
  scale.domain = () => [axis.dateAt(28), axis.dateAt(1172)];
  return scale;
}

function calendarLabel(date) {
  return d3.timeFormat(date.getDate() === 1 ? "%Y.%m" : "%m.%d")(date);
}

function axisClip() {
  timeline.selectAll("defs.timeline-defs").data([null]).join("defs").attr("class", "timeline-defs")
    .selectAll("clipPath").data([null]).join("clipPath").attr("id", "timeline-axis-clip")
    .selectAll("rect").data([null]).join("rect")
    .attr("x", 0).attr("y", -24).attr("width", 1200).attr("height", 48);
}

function drawTimeAxis() {
  const axis = timelineScale();
  const top = d3.axisTop(calendarScale(axis))
    .tickValues(calendarTicks(axis)).tickSize(7).tickSizeOuter(0).tickFormat(calendarLabel);
  axisClip();
  const layer = timeline.selectAll("g.calendar-axis").data([null]).join("g")
    .attr("class", "calendar-axis").attr("transform", "translate(0,24)")
    .attr("clip-path", "url(#timeline-axis-clip)");
  layer.interrupt("calendar");
  layer.selectAll("*").interrupt("calendar");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!layer.node().__axis || reduced) layer.call(top);
  else layer.transition("calendar").duration(dragOrigin ? 90 : 220).ease(d3.easeCubicOut).call(top);
  layer.selectAll(".tick").classed("calendar-major", date => date.getDate() === 1);
  timeline.selectAll("line.track").data([null]).join("line").attr("class", "track")
    .attr("x1", 28).attr("x2", 1172)
    .attr("y1", 64).attr("y2", 64);
}

function drawTimeline() {
  drawTimeAxis();
  drawHistogram();
  const selection = timeline.selectAll("g.selection").data([null]).join(createRange);
  selection.attr("aria-valuetext", `${formatDate(state.start)} 到 ${formatDate(state.end)}`);
  selection.select(".selection-label").text(`${formatShort(state.start)} / ${formatShort(state.end)}`);
  applyHistogramFocus();
}

function createRange(enter) {
  const selection = enter.append("g")
    .attr("class", "selection")
    .attr("tabindex", 0)
    .attr("role", "slider")
    .attr("aria-label", "时间区间")
    .call(d3.drag()
      .on("start", timelineDragStart)
      .on("drag", timelineDrag)
      .on("end", timelineDragEnd));
  drawRange(selection);
  selection.on("wheel", timelineWheel, { passive: false }).on("keydown", timelineKey);
  return selection;
}

function drawRange(selection) {
  selection.append("rect").attr("class", "selection-zone")
    .attr("x", 300).attr("y", 184)
    .attr("width", 600).attr("height", 32).attr("rx", 2);
  selection.append("text").attr("class", "selection-label")
    .attr("x", 600).attr("y", 236)
    .attr("text-anchor", "middle")
    .text(`${formatShort(state.start)} / ${formatShort(state.end)}`);
  addHandle(selection, 300, "start");
  addHandle(selection, 900, "end");
}

function addHandle(parent, x, edge) {
  const handle = parent.append("circle")
    .attr("class", "handle")
    .attr("cx", x).attr("cy", 200).attr("r", 7)
    .attr("tabindex", 0)
    .attr("aria-label", edge === "start" ? "区间起点" : "区间终点")
    .on("keydown", event => resizeKey(event, edge));
  handle.call(d3.drag()
    .on("start", timelineDragStart)
    .on("drag", event => resizeDrag(event, edge))
    .on("end", timelineDragEnd));
}

function timelineDragStart(event) {
  dragStartX = event.x;
  dragOrigin = { start: state.start, end: state.end, axis: timelineScale() };
}

function histogramData(axis, rows = themes) {
  const months = d3.rollups(rows, records => records, row => +d3.timeMonth.floor(row.date))
    .map(([value, records]) => ({ date: new Date(value), records,
      end: d3.timeMonth.offset(new Date(value), 1) }))
    .filter(month => axis.xAt(month.end) > 28 && axis.xAt(month.date) < 1172)
    .sort((a, b) => a.date - b.date);
  const peak = d3.max(months, month => month.records.length) || 1;
  return months.flatMap(month => histogramSegments(month, axis, peak));
}

function histogramSegments(month, axis, peak) {
  const left = Math.max(28, axis.xAt(month.date));
  const right = Math.min(1172, axis.xAt(month.end));
  if (right - left < 2) return [];
  const groups = d3.rollups(month.records, records => ({ count: records.length,
    selectedCount: records.filter(row => row.date >= state.start && row.date <= state.end).length
  }), row => row.provider).sort((a, b) => providerOrder.indexOf(a[0]) - providerOrder.indexOf(b[0]));
  let y = 150 - month.records.length / peak * 84;
  return groups.map(([provider, counts]) => {
    const height = counts.count / peak * 84;
    const segment = { key: `${+month.date}\0${provider}`, date: month.date, provider, ...counts,
      totalCount: month.records.length, x: left + 1, width: right - left - 2, y, height };
    y += height;
    return segment;
  });
}

function histogramOpacity(segment) {
  return segment.selectedCount ? .45 + .55 * segment.selectedCount / segment.count : .15;
}

function histogramClip() {
  timeline.selectAll("defs.histogram-defs").data([null]).join("defs").attr("class", "histogram-defs")
    .selectAll("clipPath").data([null]).join("clipPath").attr("id", "timeline-histogram-clip")
    .selectAll("rect").data([null]).join("rect")
    .attr("x", 28).attr("y", 60).attr("width", 1144).attr("height", 96);
}

function drawHistogram() {
  histogramClip();
  timeline.selectAll("text.histogram-caption").data([null]).join("text")
    .attr("class", "histogram-caption").attr("x", 28).attr("y", 49)
    .text("每月主题题数 · 按出题人堆叠");
  const layer = timeline.selectAll("g.monthly-histogram").data([null]).join("g")
    .attr("class", "monthly-histogram").attr("clip-path", "url(#timeline-histogram-clip)");
  const bars = layer.selectAll("rect.timeline-bar").data(histogramData(timelineScale()), d => d.key)
    .join(
      enter => enter.append("rect").attr("x", d => d.x).attr("width", d => d.width).attr("y", 150).attr("height", 0),
      update => update,
      exit => exit.transition("histogram").duration(animationDuration() / 2).attr("y", 150).attr("height", 0).remove()
    ).attr("class", "timeline-bar").attr("fill", d => palette(d.provider)).attr("tabindex", 0)
    .attr("role", "img").attr("aria-label", d => `${d3.timeFormat("%Y年%m月")(d.date)}，${d.provider}，${d.count}道主题题，其中${d.selectedCount}道在所选区间`)
    .on("pointerenter", showHistogramTooltip).on("pointermove", moveTooltip)
    .on("click", (event, d) => { event.stopPropagation(); lockAuthor(d.provider); })
    .on("keydown", (event, d) => authorKey(event, d.provider))
    .on("pointerleave", () => { highlight(null); hideTooltip(); })
    .on("focus", showHistogramTooltip).on("blur", () => { highlight(null); hideTooltip(); });
  bars.interrupt("histogram").transition("histogram").duration(animationDuration()).ease(d3.easeCubicOut)
    .attr("x", d => d.x).attr("width", d => d.width).attr("y", d => d.y)
    .attr("height", d => d.height).attr("opacity", histogramOpacity);
}

function showHistogramTooltip(event, segment) {
  highlight(currentView.groups.some(group => group.provider === segment.provider) ? segment.provider : null);
  tooltip.html(`<b>${escapeHtml(segment.provider)}</b> · ${d3.timeFormat("%Y.%m")(segment.date)}<br>` +
    `<small>当月 ${segment.count} 道主题题，所选区间内 ${segment.selectedCount} 道</small>`).classed("show", true);
  moveTooltip(event);
}

function timelineDrag(event) {
  if (!dragOrigin) return;
  const shift = Math.max(minDate - dragOrigin.start,
    Math.min(maxDate - dragOrigin.end, dragOffset(event.x)));
  scheduleRange(new Date(+dragOrigin.start + shift), new Date(+dragOrigin.end + shift));
}

function timelineDragEnd() {
  dragOrigin = null;
  dragStartX = null;
}

function timelineWheel(event) {
  if (event.ctrlKey || !event.deltaY) return;
  event.preventDefault();
  const direction = Math.sign(event.deltaY);
  const speed = wheelSpeed(event.timeStamp, direction);
  const units = Math.min(2, Math.abs(event.deltaY) / (event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100));
  const change = Math.max(864e5, (state.end - state.start) * Math.expm1(.035 * speed * units));
  const delta = direction * Math.round(change / 864e5) * 864e5;
  const next = resizeRange(delta);
  scheduleRange(next.start, next.end);
}

function wheelSpeed(time, direction) {
  const gap = lastWheelAt === null ? Infinity : Math.max(8, time - lastWheelAt);
  const reset = gap > 260 || direction !== lastWheelDirection;
  wheelFrequency = reset ? 4 : .65 * wheelFrequency + .35 * (1000 / gap);
  lastWheelAt = time;
  lastWheelDirection = direction;
  return Math.max(1, Math.min(6, wheelFrequency / 4));
}

function resizeRange(delta) {
  const span = Math.max(2 * weekStep, Math.min(maxDate - minDate, state.end - state.start + delta));
  if (+state.end === +maxDate || +state.start + span > +maxDate) {
    return { start: new Date(+maxDate - span), end: maxDate };
  }
  return { start: state.start, end: new Date(+state.start + span) };
}

function timelineKey(event) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "ArrowLeft") shiftWeeks(-1);
  if (event.key === "ArrowRight") shiftWeeks(1);
  if (event.key === "ArrowUp" || event.key === "+") extendEnd(1);
  if (event.key === "ArrowDown" || event.key === "-") extendEnd(-1);
}

function resizeKey(event, edge) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const delta = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
  if (edge === "start") {
    setRange(d3.timeWeek.offset(state.start, delta), state.end);
  } else {
    extendEnd(delta);
  }
}

function resizeDrag(event, edge) {
  if (!dragOrigin) return;
  const delta = dragOffset(event.x);
  if (edge === "start") {
    const start = d3.min([new Date(+dragOrigin.start + delta), d3.timeWeek.offset(dragOrigin.end, -2)]);
    scheduleRange(start, dragOrigin.end);
  } else {
    scheduleRange(dragOrigin.start, new Date(+dragOrigin.end + delta));
  }
}

function dragOffset(x) {
  const elapsed = dragOrigin.axis.dateAt(x) - dragOrigin.axis.dateAt(dragStartX);
  return Math.round(elapsed / 864e5) * 864e5;
}

function scheduleRange(start, end) {
  Object.assign(state, clampRange(start, end));
  cancelAnimationFrame(frame);
  clearTimeout(chartTimer);
  frame = requestAnimationFrame(() => {
    drawTimeline();
    const rows = visibleThemes();
    updateStats(rows, groupThemes(rows));
    hideTooltip();
    chart.attr("aria-busy", "true");
  });
  chartTimer = setTimeout(drawChart, 100);
}

d3.select("#recent").on("click", () => setRange(d3.timeWeek.offset(maxDate, -25), maxDate));
d3.select("#all").on("click", () => setRange(minDate, maxDate));
chart.on("pointermove.authors", handleChartPointer)
  .on("pointerleave.authors", () => { highlight(null); hideTooltip(); });
d3.select(document).on("click.selection", clearBlank)
  .on("keydown.selection", event => { if (event.key === "Escape") clearAuthor(); });
initializeSemantics();
document.fonts.ready.then(() => { drawChart(); drawTimeline(); });
