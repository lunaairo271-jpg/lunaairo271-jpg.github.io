// 纯函数：高斯形变与连续语义强度，不依赖页面 DOM。
const wordInteraction = (() => {
  const spreadScale = 1.002;
  const gaussianAmplitude = 24;
  const minimumSigma = .2;

  function gaussian(x) {
    return Math.exp(-x * x);
  }

  function gaussianShift(word, sector) {
    const middle = (sector.startAngle + sector.endAngle) / 2;
    const delta = Math.atan2(Math.sin(word.angle - middle), Math.cos(word.angle - middle));
    const sigma = Math.max(minimumSigma, (sector.endAngle - sector.startAngle) / 2);
    const weight = gaussian(delta / sigma);
    return { x: Math.sin(word.angle) * gaussianAmplitude * weight, y: -Math.cos(word.angle) * gaussianAmplitude * weight };
  }

  function scatter(word, sector, safety = 1) {
    if (!sector) return word;
    const shift = gaussianShift(word, sector);
    return { ...word,
      x: word.x * spreadScale + shift.x * safety,
      y: word.y * spreadScale + shift.y * safety
    };
  }

  function dot(first, second) {
    return first[0] * second[0] + first[1] * second[1];
  }

  function projectionRadius(word, axis) {
    return (Math.abs(dot(word.axes[0], axis)) * word.width + Math.abs(dot(word.axes[1], axis)) * word.height) / 2;
  }

  function axisSafety(first, second, fields, i, j, axis) {
    const distance = (second.x - first.x) * axis[0] + (second.y - first.y) * axis[1];
    const radius = projectionRadius(first, axis) + projectionRadius(second, axis);
    if (Math.abs(distance) < radius) return 0;
    const room = spreadScale * Math.abs(distance) - radius - .01;
    if (room >= gaussianAmplitude * 2) return 1;
    const sign = distance < 0 ? -1 : 1;
    let adverse = 0;
    for (const field of fields) {
      const relative = (field[j].x - field[i].x) * axis[0] + (field[j].y - field[i].y) * axis[1];
      adverse = Math.max(adverse, -sign * relative);
    }
    return adverse > 1e-12 ? room / adverse : 1;
  }

  function scatterSafety(words, sectors) {
    if (words.length < 2) return 1;
    const sources = sectors || words.map(word => ({ startAngle: word.start, endAngle: word.end }));
    const unique = new Map(sources.map(sector => [`${sector.startAngle}:${sector.endAngle}`, sector]));
    const fields = [...unique.values()].map(sector => words.map(word => gaussianShift(word, sector)));
    let safe = 1;
    // 用完整的连续高斯场计算相对位移，保留分离轴并涵盖焦点切换插值。
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const axes = [...words[i].axes, ...words[j].axes];
        const limit = Math.max(...axes.map(axis => axisSafety(words[i], words[j], fields, i, j, axis)));
        safe = Math.min(safe, limit);
      }
    }
    return Math.max(0, Math.min(1, safe) * .98);
  }

  function createIndex(data) {
    const index = new Map();
    if (!data || !data.model || !Array.isArray(data.terms) || !Array.isArray(data.vectors)) return index;
    if (data.terms.length !== data.vectors.length) throw new Error("词语和向量数量不一致");
    data.terms.forEach((term, i) => {
      const vector = data.vectors[i];
      if (!Array.isArray(vector) || vector.length !== data.dimensions || !vector.every(Number.isFinite)) {
        throw new Error(`词向量无效：${term}`);
      }
      const norm = Math.hypot(...vector);
      if (!norm || index.has(term)) throw new Error(`词向量为零或词语重复：${term}`);
      index.set(term, Float32Array.from(vector, value => value / norm));
    });
    return index;
  }

  function similarity(index, first, second) {
    return cosine(index.get(first), index.get(second));
  }

  function cosine(a, b) {
    if (!a || !b) return null;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(-1, Math.min(1, dot));
  }

  function createAuthorIndex(data) {
    const features = data?.authorFeatures || {};
    return createIndex({ model: data?.model, dimensions: data?.dimensions,
      terms: Object.keys(features), vectors: Object.values(features) });
  }

  function scores(source, index) {
    return new Map([...index].map(([term, vector]) => [term, cosine(source, vector)]));
  }

  function smoothstep(first, last, value) {
    const t = Math.max(0, Math.min(1, (value - first) / (last - first)));
    return t * t * (3 - 2 * t);
  }

  function strength(similarity) {
    return Number.isFinite(similarity) ? smoothstep(.3, .8, similarity) : null;
  }

  function wordOpacity(similarity) {
    const value = strength(similarity);
    return value === null ? .3 : .08 + .92 * value;
  }

  const motion = Object.freeze({ baselineScale: spreadScale, amplitude: gaussianAmplitude, minimumSigma });
  return { motion, gaussian, scatter, scatterSafety, createIndex, createAuthorIndex, cosine, scores, similarity, smoothstep, strength, wordOpacity };
})();
