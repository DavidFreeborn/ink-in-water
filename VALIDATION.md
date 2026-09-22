# Validation

The 22 September 2026 audit used Chromium with hardware WebGL 2 on an NVIDIA RTX 4070 Laptop GPU. All nine suites pass. Run `npm test` with the local server running to reproduce them. Tests instrument the production solver to read fields and configure deterministic experiments; they do not replace its numerical operators.

| Check | Result |
| --- | --- |
| Initial shapes | Independently seeded shapes have distinct profiles; Reset reproduces them exactly. The single-ink initial concentration and tracer buffers retain their original values. The new current field changes subsequent motion. |
| Grid/tracer seeding | Both use the same concentration law. Sample errors are below 2.6 × 10⁻⁶; initial amounts agree within 0.14% at the tested grid. Shape variation produces no flow in neutral, still water. |
| Drop placement | Counts one through five: initial projected centre separation is at least 24 mm. Smoothed initial support fits inside every domain, including the conservative spherical voxel mask at grid 32. |
| Initial flow | Seeded reset is bit-identical; different seeds change the field. Initial divergence RMS is below 3.1 × 10⁻⁶ s⁻¹ across the four domains at grid 48. Periodic seams and ghost faces agree. Neutral ink in still water remains at rest. |
| Brownian transport | Two independent ink sequences: mean displacement below 0.11 μm per coordinate, variance error below 0.32%, and cross-ink covariance below 0.33% of the diffusion variance. |
| Cuboid and torus | 60 simulated seconds at 48 × 72 × 48 cells; conservation, wall flux, periodic ghosts and seam rendering pass. |
| Cylinder and sphere | 30 simulated seconds at 32 × 48 × 32 cells; conservation and containment pass, with zero wall flux, dye in solid cells or escaped tracers. |
| Fine pressure solve | 160 × 240 × 160 cells; cuboid/torus divergence RMS below 6.3 × 10⁻⁶ s⁻¹. |
| Independent inks | Three, four and five inks in a sphere conserve individual amounts within 1.1 × 10⁻⁷; the final ink independently drives buoyancy. Five inks at maximum initial current strength run for one simulated second in every domain, with individual mass drift below 4.2 × 10⁻⁸ and no escaped tracers. Two-ink five-second stress runs also pass. |
| Colour independence | Colour changes leave physical field hashes identical, including after subsequent evolution. |
| Controls and state | Seeded reset, live selected-ink edits, colour validation, stable identities, saved settings and migration pass. Adding is disabled at five inks, and older larger configurations retain their first five inks. |

Browser checks cover the grid-rendering fallback, full rotation, fullscreen, saved inline settings, keyboard access, reduced motion and responsive layouts. The controls and collapsed model description fit at 1280 × 720 and 653 × 612. Narrow screens place controls below the volume; the new domain labels and equations reflow without horizontal overflow at 320 pixels.

## Similar early motions

The preceding initial water field was an equal-amplitude ABC flow with a 20 mm spatial period. The former 18 mm lattice of drop positions placed neighbouring drops in nearly repeated local flow. For a displacement of 18 mm along one axis, the analytic velocity-gradient tensors have cosine similarity (2 + cos(0.2π))/3 = 0.9363, before pressure projection. ABC flow is a valid incompressible field and can have chaotic particle trajectories; its repeated cells made it an unnecessarily restrictive initial condition for this demonstration. See [Dombre et al. (1986), *Chaotic streamlines in the ABC flows*](https://www.cambridge.org/core/journals/journal-of-fluid-mechanics/article/abs/chaotic-streamlines-in-the-abc-flows/7139EDCF0CC8A9B4D9D749B1FAA6CE54).

The production-field comparison uses a periodic 48 × 72 × 48 grid and seeds 125, 4718593 and 20260922. Fixed probe locations isolate the flow change from the new drop placement. Local strain-profile cosine similarities across 18 mm axial separations were 0.888–0.946 in the previous field and −0.666–0.264 in the revised field. Translation and rigid rotation do not contribute to this strain comparison. At exactly 20 mm, the old velocity repeat is reproduced to floating-point accuracy; it disappears with the new modes. These are results for the stated probes and seeds, not a guarantee that every pair of nearby fluid regions has dissimilar strain.

The replacement uses sixteen seeded transverse Fourier modes, with wavelengths of 18–30 mm and the same full-box RMS speed before projection. Their phases, wavevectors and polarisations are generated only at reset. The flow then evolves through the existing momentum solver. A CPU audit of 1,000 seeds checks transverse unit polarisations, distinct modes, full-box periodicity, RMS normalisation and absence of additional exact subcell translations in these samples. Run `node scripts/audit-current-modes.cjs` to reproduce it. The spectrum changes: its median gradient RMS is 1.424 s⁻¹, compared with 1.539 s⁻¹ previously. Equal kinetic energy does not imply identical stretching strength.

No copied flow or animation was found. Every ink samples one shared velocity field. A test of the production tracer shader at identical positions gives the same advective displacement across all five ink identities to within 9.4 × 10⁻¹⁰ m after isolating their independent diffusion samples. Five actual tracer clouds show distinct early centroid movements. Equally sized, equally dense drops can still have similar broad sinking behaviour, especially when initial currents are zero.

## Performance

The release permits up to five inks. Rendering the additional tracer clouds accounts for most of the increased cost: completed Standard step cost stays near 7–8 ms, while render cost rises from about 5 to 19 ms between one and five inks. A fifth ink also allocates another four-channel concentration group, which increases texture storage more than adding the second, third or fourth ink.

The final release was benchmarked again with all supported counts. Rates below are medians of three approximately one-second playback windows per case. “Actual rate” is simulated seconds per real second; FPS measures animation-frame cadence. Higher requested speed retains the fixed 0.01 s timestep and may reduce frame rate.

| Resolution | Inks | FPS at 1× | Actual rate at 1× | Actual rate at 6× | Texture storage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 1 | 59.8 | 0.93× | 1.16× | 363 MiB |
| Standard | 2 | 59.7 | 0.60× | 0.93× | 382 MiB |
| Standard | 3 | 50.3 | 0.50× | 0.77× | 400 MiB |
| Standard | 4 | 42.0 | 0.42× | 0.59× | 419 MiB |
| Standard | 5 | 35.6 | 0.36× | 0.47× | 509 MiB |
| Fine | 1 | 35.8 | 0.36× | 0.36× | 992 MiB |
| Fine | 2 | 29.3 | 0.29× | 0.29× | 1025 MiB |
| Fine | 3 | 24.2 | 0.24× | 0.22× | 1059 MiB |
| Fine | 4 | 20.3 | 0.20× | 0.20× | 1093 MiB |
| Fine | 5 | 17.4 | 0.17× | 0.17× | 1328 MiB |

The benchmark uses a fresh page per case, a 1280 × 800 viewport at device-pixel ratio 1, seed 125, cuboid walls, current strength 1 and density contrast 0.04% for every ink. Each playback phase resets and warms up for 20 steps. Step and render timings include a blocking pixel readback to await GPU completion; they include synchronization overhead. Playback uses the normal animation loop without injected synchronization. Texture storage excludes driver overhead and temporary allocation peaks. These short, controlled measurements are specific to this machine and workload.

Fine is a quality/performance tradeoff even with one ink. More inks slow playback; the five-ink limit gives a wider choice without reducing grid resolution, molecular diffusivity, tracer detail or integration accuracy. Initial-shape and current randomisation occur only when the experiment is seeded.

Run `npm run benchmark -- --mode both --fast` to reproduce the supported-count benchmark. JSON reports retain samples, ranges, hardware identity and the tested source hash in `qa/`. Optional `--source` and `--counts` arguments support comparisons against earlier releases. A failed case or graphics/browser error returns a nonzero exit status.

These checks establish numerical consistency for the tested cases. They do not validate a particular laboratory ink or remove the finite-resolution and wall-geometry approximations described in [MODEL.md](MODEL.md).
