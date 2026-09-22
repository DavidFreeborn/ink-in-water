# Validation

The 22 September 2026 audit used Chromium with hardware WebGL 2 on an NVIDIA RTX 4070 Laptop GPU. All seven numerical suites pass. Run `npm test` with the local server running to reproduce them. Tests instrument the production solver to read fields and configure deterministic experiments; they do not replace its numerical operators.

| Check | Result |
| --- | --- |
| Initial shapes | The former centred profiles were identical. Independently seeded shapes have distinct profiles; Reset reproduces them exactly. Ink 1’s initial grid and complete tracer buffers remain bit-identical to the preceding release. |
| Grid/tracer seeding | Both use the same concentration law. Sample errors are below 2.4 × 10⁻⁶; initial amounts agree within 0.10% at the tested grid. Shape variation produces no flow in neutral, still water. |
| Brownian transport | Two independent ink sequences: mean displacement below 0.11 μm per coordinate, variance error below 0.32%, and cross-ink covariance below 0.33% of the diffusion variance. |
| Cuboid and torus | 60 simulated seconds at 48 × 72 × 48 cells; conservation, wall flux, periodic ghosts and seam rendering pass. |
| Cylinder and sphere | 30 simulated seconds at 32 × 48 × 32 cells; mass drift below 5.3 × 10⁻⁸; zero wall flux, dye in solid cells or escaped tracers. |
| Fine pressure solve | 160 × 240 × 160 cells; cuboid/torus divergence RMS below 3.5 × 10⁻⁶ s⁻¹. |
| Independent inks | Two inks at maximum initial current strength run for five simulated seconds in each domain; mass drift below 5.1 × 10⁻⁸. Three inks in a sphere conserve each mass within 1.2 × 10⁻⁷; the final ink independently drives buoyancy. |
| Colour independence | Colour changes leave physical field hashes identical, including after subsequent evolution. |
| Controls and state | Seeded reset, live selected-ink edits, colour validation, stable identities, saved settings and migration pass. Adding is disabled at three inks, and older larger configurations retain their first three inks. |

Browser checks cover the grid-rendering fallback, full rotation, fullscreen, saved inline settings, keyboard access, reduced motion and responsive layouts. The controls and collapsed model description fit at 1280 × 720 and 653 × 612. Narrow screens place controls below the volume; the new domain labels and equations reflow without horizontal overflow at 320 pixels.

## Performance

The release now permits at most three inks. Measurements of the preceding release at Standard resolution gave roughly 60, 60, 52, 44, 32 and 26 frames/s for one, two, three, four, six and eight inks respectively. Rendering the additional tracer clouds accounts for most of the increase: completed step cost remained near 7–8 ms for one to four inks, while render cost rose from about 5 to 16 ms. Successful allocation of sixteen inks did not establish acceptable playback performance.

The final release was benchmarked again with all supported counts. Rates below are medians of three approximately one-second playback windows per case. “Actual rate” is simulated seconds per real second; FPS measures animation-frame cadence. Higher requested speed retains the fixed 0.01 s timestep and may reduce frame rate.

| Resolution | Inks | FPS at 1× | Actual rate at 1× | Actual rate at 6× | Texture storage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 1 | 59.8 | 0.98× | 1.21× | 363 MiB |
| Standard | 2 | 59.6 | 0.60× | 1.00× | 382 MiB |
| Standard | 3 | 51.4 | 0.51× | 0.88× | 400 MiB |
| Fine | 1 | 35.8 | 0.36× | 0.37× | 992 MiB |
| Fine | 2 | 27.8 | 0.28× | 0.29× | 1025 MiB |
| Fine | 3 | 23.7 | 0.24× | 0.24× | 1059 MiB |

The benchmark uses a fresh page per case, a 1280 × 800 viewport at device-pixel ratio 1, seed 125, cuboid walls, current strength 1 and density contrast 0.04% for every ink. Each playback phase resets and warms up for 20 steps. Step and render timings include a blocking pixel readback to await GPU completion; they include synchronization overhead. Playback uses the normal animation loop without injected synchronization. Texture storage excludes driver overhead and temporary allocation peaks. These short, controlled measurements are specific to this machine and workload.

Fine is a quality/performance tradeoff even with one ink. The three-ink limit improves the available playback range without reducing grid resolution, molecular diffusivity, tracer detail or integration accuracy. Initial-shape randomization occurs only when the experiment is seeded.

Run `npm run benchmark -- --mode both --fast` to reproduce the supported-count benchmark. JSON reports retain samples, ranges, hardware identity and the tested source hash in `qa/`. Optional `--source` and `--counts` arguments support comparisons against earlier releases. A failed case or graphics/browser error returns a nonzero exit status.

These checks establish numerical consistency for the tested cases. They do not validate a particular laboratory ink or remove the finite-resolution and wall-geometry approximations described in [MODEL.md](MODEL.md).
