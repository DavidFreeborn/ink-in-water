# Validation

The 22 September 2026 audit used Chromium with hardware WebGL 2 on an NVIDIA RTX 4070 Laptop GPU. Run `npm test` with the local server running to reproduce the numerical regressions. The tests instrument the production solver to read fields and configure deterministic experiments; they do not replace its numerical operators.

| Check | Result |
| --- | --- |
| Brownian transport in still, neutrally buoyant water | Two inks with independent random sequences; mean displacement below 0.11 μm per coordinate, variance error below 0.25%, and cross-ink covariance below 0.3% of the diffusion variance |
| Cuboid and torus | 60 simulated seconds at a 48 × 72 × 48 grid; conservation, wall flux, periodic ghosts and seam rendering passed |
| Cylinder and sphere | 30 simulated seconds at a 32 × 48 × 32 grid; mass drift below 5.3 × 10⁻⁸; zero wall flux, dye in solid cells or escaped tracers |
| Fine pressure solve | 160 × 240 × 160 grid; cuboid/torus divergence RMS below 3.5 × 10⁻⁶ s⁻¹ |
| Two inks at maximum initial current strength | 5 simulated seconds in each of the four domains; each mass drift below 1.1 × 10⁻⁷; all tracer weights retained |
| Five and sixteen inks | One simulated second in a sphere; every ink conserved within 1.2 × 10⁻⁷, with all tracer weights retained and no escaped tracers |
| Independent densities | Opposite ±0.4% contrasts in still water produced downward/upward displacement; two neutral inks left the water at rest; the last of sixteen inks independently contributed buoyancy |
| Colour independence | Changing colours left hashes of all physical fields identical, including after further evolution |
| Seeds and playback | Reset reproduced the seeded fields exactly; fresh loads selected new seeds; playback retained the fixed numerical timestep; selected edits, stable ink IDs, exact hex validation, saved settings and migration passed |

Additional allocation and initial-step checks passed with sixteen inks at both Standard and Fine resolution, retaining 8.6 million and 15.6 million active tracers respectively. The grid-rendering fallback accumulated all five or sixteen colours; changing only the final ink changed the image without advancing time. Further checks covered full 360° rotation, fullscreen, saved inline settings, keyboard access, reduced motion and layouts from 320 to 1440 pixels wide. All desktop controls fit on one screen at the tested normal viewport sizes. Narrow screens place controls below the volume; touch targets remain at least 44 pixels high. The model equations also reflow without horizontal overflow.

At Standard resolution, a controlled 200-step comparison measured 8.06 ms per physics step in the previous version and 8.13 ms in this release on the tested GPU. The default tracer count was identical, and default dye mass and maximum velocity agreed within floating-point roundoff after 100 steps. In short playback samples, the revised interface rendered about 59 frames per second at 1× (advancing about 0.85 simulated seconds per real second) and about 30 frames per second at 6× (advancing about 1.06). These rates depend on hardware, scene and workload. Fine resolution and additional inks require more memory and computation; a requested speed is not guaranteed.

Pressure ghost caching and shorter reduction chains were checked against the previous implementation with identical field hashes. A further batching experiment also preserved the results but offered no measured speed benefit, so it was not adopted. Grid resolution, molecular diffusivity, tracer counts and integration timesteps were preserved by the performance changes.

These checks establish conservation, containment and numerical consistency for the tested cases. They do not validate the visualiser against a particular laboratory ink or remove its finite-resolution and wall-geometry approximations; see [the model description](MODEL.md).
