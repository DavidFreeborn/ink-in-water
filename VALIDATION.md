# Validation

The September 2026 audit used Chromium with hardware WebGL 2 on an NVIDIA RTX 4070 Laptop GPU. Run `npm test` with the local server running to reproduce the numerical regressions. The tests instrument the production solver to read fields and configure deterministic experiments; they do not replace its numerical operators.

| Check | Result |
| --- | --- |
| Brownian transport in still, neutrally buoyant water | Mean displacement below 0.14 μm per coordinate; variance error below 0.2% |
| Cuboid and torus | 60 simulated seconds at a 48 × 72 × 48 grid; conservation, wall flux, periodic ghosts and seam rendering passed |
| Cylinder and sphere | 30 simulated seconds at a 32 × 48 × 32 grid; mass drift below 6.3 × 10⁻⁸; zero wall flux, dye in solid cells or escaped tracers |
| Fine pressure solve | 160 × 240 × 160 grid; cuboid/torus divergence RMS below 3.5 × 10⁻⁶ s⁻¹ |
| Two inks at maximum initial current strength | 5 simulated seconds in each of the four domains; each mass drift below 7 × 10⁻⁸; all tracer weights retained |
| Independent densities | Opposite ±0.4% contrasts in still water produced downward/upward displacement; two neutral inks left the water at rest |
| Colour independence | Changing colours left hashes of all physical fields identical, including after further evolution |
| Seeds and playback | Reset reproduced the seeded fields exactly; fresh loads selected new seeds; playback retained the fixed numerical timestep |

Additional checks covered curved containers at Standard and Fine resolution, both inks at Standard resolution, the grid-rendering fallback, fullscreen, saved inline settings, keyboard access, reduced motion and layouts from 320 to 1440 pixels wide. All desktop controls fit on one screen at the tested normal viewport sizes. Narrow screens place controls below the volume; touch targets remain at least 44 pixels high. The model equations also reflow without horizontal overflow.

At Standard resolution, the tested machine sustained approximately 60 frames per second at the default 1× playback. Higher requested speeds were GPU-limited to approximately 1.1–1.2 simulated seconds per real second at around 30 frames per second. A 6× selection is a requested rate, not a guarantee. Fine resolution and two inks require more computation.

Pressure ghost caching and shorter reduction chains were checked against the previous implementation with identical field hashes. A further batching experiment also preserved the results but offered no measured speed benefit, so it was not adopted. Grid resolution, molecular diffusivity, tracer counts and integration timesteps were preserved by the performance changes.

These checks establish conservation, containment and numerical consistency for the tested cases. They do not validate the visualiser against a particular laboratory ink or remove its finite-resolution and wall-geometry approximations; see [the model description](MODEL.md).
