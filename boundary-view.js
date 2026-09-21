/* Project the container outline with exactly the same camera as the ink. */
(() => {
  'use strict';
  const root = document.getElementById('ink-app');
  const outline = root?.querySelector('#boundary-outline');
  if (!outline) return;

  const vertices = Array.from({length: 8}, (_, i) => [
    (i & 1) ? .08 : 0,
    (i & 2) ? .12 : 0,
    (i & 4) ? .08 : 0
  ]);
  const namespace = 'http://www.w3.org/2000/svg';
  const groups = Object.fromEntries(['cuboid', 'cylinder', 'sphere'].map(shape => {
    const group = document.createElementNS(namespace, 'g');
    group.setAttribute('data-shape', shape);
    group.toggleAttribute('hidden', true);
    outline.appendChild(group);
    return [shape, group];
  }));
  const element = (shape, kind) => {
    const node = document.createElementNS(namespace, kind);
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    groups[shape].appendChild(node);
    return node;
  };
  const edges = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      edges.push({from: i, to: i | bit, line: element('cuboid', 'line')});
    }
  }
  const rings = [element('cylinder', 'path'), element('cylinder', 'path')];
  const generators = [element('cylinder', 'line'), element('cylinder', 'line')];
  const sphere = element('sphere', 'path');
  const circle = Array.from({length: 128}, (_, i) => {
    const theta = 2 * Math.PI * i / 128;
    return [Math.cos(theta), Math.sin(theta)];
  });
  const setLine = (line, from, to) => {
    line.setAttribute('x1', from[0]); line.setAttribute('y1', from[1]);
    line.setAttribute('x2', to[0]); line.setAttribute('y2', to[1]);
  };
  const setPath = (path, points) => {
    path.setAttribute('d', points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + ' Z');
  };
  let previous = null;
  let shown = false;

  window.updateInkBoundaryView = ({boundary, containerShape, shape, angle, cameraCenter, cameraSpan, width, height}) => {
    const visible = boundary === 'container';
    if (visible !== shown) {
      outline.toggleAttribute('hidden', !visible);
      shown = visible;
    }
    if (!visible || ![angle, cameraCenter, cameraSpan, width, height].every(Number.isFinite)
        || cameraSpan <= 0 || width <= 0 || height <= 0) return;
    const selected = containerShape || shape || 'cuboid';
    const geometry = Object.hasOwn(groups, selected) ? selected : 'cuboid';
    const current = [geometry, angle, cameraCenter, cameraSpan, width, height];
    if (previous && current.every((value, i) => value === previous[i])) return;
    previous = current;

    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const scale = height / cameraSpan;
    const project = ([x, y, z]) => {
      x -= .04; y -= cameraCenter; z -= .04;
      return [
        width / 2 + (x * cosine - z * sine) * scale,
        height / 2 - (.12 * x * sine + .9928 * y + .12 * z * cosine) * scale
      ];
    };
    outline.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const [name, group] of Object.entries(groups)) group.toggleAttribute('hidden', name !== geometry);
    if (geometry === 'cuboid') {
      const points = vertices.map(project);
      for (const {from, to, line} of edges) setLine(line, points[from], points[to]);
    } else if (geometry === 'cylinder') {
      for (let end = 0; end < 2; end++) {
        setPath(rings[end], circle.map(([cosine, sine]) => project([.04 + .04 * cosine, .12 * end, .04 + .04 * sine])));
      }
      // Tangency to the viewing direction gives the two silhouette generators.
      for (let side = 0; side < 2; side++) {
        const radius = side === 0 ? -.04 : .04;
        const x = .04 + radius * cosine, z = .04 - radius * sine;
        setLine(generators[side], project([x, 0, z]), project([x, .12, z]));
      }
    } else {
      const centre = project([.04, .06, .04]);
      // The shader's up vector is orthogonal to right but very slightly longer
      // than one. Retain its exact length rather than assuming a perfect circle.
      const upLength = Math.hypot(.12, .9928);
      setPath(sphere, circle.map(([cosine, sine]) => [
        centre[0] + .04 * scale * cosine,
        centre[1] - .04 * scale * upLength * sine
      ]));
    }
  };
})();
