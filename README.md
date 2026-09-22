# Ink in Water

A three-dimensional model of ink stretching into sheets and filaments in water. The visualiser uses native WebGL 2 with no runtime dependencies or external resources.

[Open the simulation](https://davidfreeborn.github.io/ink-in-water/) · [Model description](MODEL.md) · [Validation](VALIDATION.md)

Open `index.html` in a modern browser, or serve this directory:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then visit http://127.0.0.1:8765. WebGL 2 and floating-point render targets are required; hardware acceleration is recommended. Fine resolution uses more graphics memory and computation. Unsupported floating-point blending falls back to volume rendering the fluid-grid concentration.

Choose a cuboid, cylinder or sphere with sealed, free-slip walls, or a flat three-dimensional torus with opposite cuboid faces identified. Curved walls are approximated by an inscribed voxel surface shared by the fluid, dye and tracers. The camera shows the whole volume, with a full 360° viewing angle and fullscreen option.

Initial current strength varies continuously from still water to three times the default. Density contrast can be positive, zero or negative. Add up to three inks, each with an independent density and colour, moving through the same fluid. Select an ink to edit it using the colour picker or an exact six-digit hex value. Colour changes absorption only. More inks increase graphics memory and computation; the solver retains the selected resolution and tracer detail. The default remains a single blue ink.

`index.html` and `styles.css` provide the interface; `ink.js` contains the solver and rendering, `boundary-view.js` projects the container outline, and `interface.js` handles fullscreen. Read `MODEL.md` for equations, methods, references and limitations. The visual style follows David Freeborn's Scholarly Instrumental Modernism and Scholarly Typographic Rationalism.

The seed is random on first load. Reset repeats the current seed; New seed starts a different realisation. Playback speed ranges from 0.25× to 6× and requests more fixed physics steps per second, subject to available GPU performance. It never increases the numerical timestep or reduces resolution. Changes to initial currents, shape, topology, resolution or the number of inks restart the physical setup. Density, colour, speed and viewing angle can change during a run.

For development, install the test tools with `npm ci` and `npx playwright install chromium`. Run `npm start` to serve the project and, in another terminal, `npm test` to reproduce the numerical and interaction checks in `tests/`. The tests cover conservation, pressure projection, Brownian diffusion, wall containment, torus seams, repeatable seeds, playback and independent ink densities/colours and reproducible per-ink initial shapes. Measurements are written to `qa/`. To benchmark the supported ink counts at both resolutions, run `npm run benchmark -- --mode both --fast`. The report includes playback frame rate, achieved simulation speed, synchronized step/render timings and texture storage. The Windows test configuration requests the D3D11 graphics backend; use your platform's hardware backend when adapting it elsewhere.

Run `npm run build` to copy the public static assets into `dist/`. GitHub Actions publishes that directory to Pages after a push to `main`. `npm run build:inline -- <output-directory>` assembles the self-contained conversation version, using `dist/` by default.
