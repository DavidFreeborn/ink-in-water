# Ink in Water: model description

## Fluid model

Different parts of a drop move at different velocities, stretching the dye into sheets and filaments. Molecular diffusion gradually erases the concentration gradients across these structures.

The model follows dissolved dye in three dimensions. Each concentration cᵢ is scaled to equal one in the initial ink solution. The fractional density change is b = ∑ᵢ βᵢcᵢ, summed over all inks, giving density ρ = ρ₀(1 + b). Here ρ₀ is water density and βᵢ is each ink’s fractional density contrast. The Boussinesq approximation retains these small density differences only in buoyancy.

```
∇ · u = 0
∂u/∂t + (u · ∇)u = −∇π + ν∇²u − gb e_y
∂cᵢ/∂t + ∇ · (cᵢu) = D∇²cᵢ
```

Here u is velocity, t is time, π is pressure divided by water density after subtracting hydrostatic pressure, and e_y is the upward unit vector. The equations conserve fluid volume, evolve velocity under pressure, viscosity and buoyancy, and transport each ink through the shared flow.

Kinematic viscosity is ν = 10⁻⁶ m² s⁻¹, dye diffusivity is D = 10⁻⁹ m² s⁻¹, and gravity is g = 9.81 m s⁻².

The staggered-grid solver uses bounded MacCormack velocity advection, explicit viscosity, conservative finite-volume dye transport with MC limiting and SSP-RK2, and approximate multigrid pressure projection. Each step uses three pressure V-cycles for curved containers and two for the cuboid or torus. Shared face fluxes preserve the total amount of each ink.

Speed changes the requested rate of fixed time steps without changing their duration or the physical parameters; hardware may limit the achieved rate. Currents changes the initial flow and restarts the experiment. Adding or removing ink also restarts it; density and colour edits apply immediately. Positive density contrast drives sinking, negative values drive rising, and zero makes ink neutrally buoyant. Fine uses smaller cells and more tracer samples.

## Initial conditions

The seed selects sixteen distinct Fourier wavevectors kₘ = 2π(nₓ/0.08, nᵧ/0.12, n_z/0.08), with integer indices and wavelengths from 18 to 30 mm. Opposite wavevectors count as the same mode. Each mode has a seeded phase φₘ and a unit polarisation eₘ perpendicular to kₘ. Before pressure projection, the initial velocity is

```
u₀(x) = a √(3/16) ∑ₘ₌₁¹⁶ eₘ sin(kₘ · (x − x₀) + φₘ),
kₘ · eₘ = 0,     a = 0.004 × current strength  m s⁻¹.
```

Here x₀ is the box centre. Perpendicular polarisations make each continuous mode divergence-free. The integer indices match the full periodic box. The full-box root-mean-square speed is √(3/2) a, or 4.90 mm s⁻¹ at the default strength. Components are sampled at their respective staggered cell faces; pressure projection removes the sampling error in divergence and imposes container walls, changing the initial energy. Zero current strength starts at rest. The modes specify the initial condition only; the momentum equation evolves the flow thereafter.

The seed independently selects each ink’s shape phases and spatial orientation. Drops have nominal radius 6.5 mm and the same 13% surface perturbation amplitude. Three to five drops form a balanced arrangement with shallow depth variation, separated in the initial view and contained within every domain. Similar size and density can produce similar broad sinking behaviour, while different local velocity gradients stretch each drop differently. Reset reproduces the initial conditions within this version of the model.

## Boundary conditions

The cuboid, cylinder and sphere are sealed containers. Water cannot cross their walls and can slide along them without friction (free-slip). Dye has zero flux through a wall. Curved containers are approximated by stair-step surfaces made from grid cells; the velocity, dye and reflected tracers use these same walls.

The cuboid measures 8 × 12 × 8 cm. The cylinder has radius 4 cm and height 12 cm; the sphere has radius 4 cm. Only cells whose corners lie inside the selected shape contain fluid.

The flat 3-torus identifies opposite cuboid faces in all three directions. It has no boundary. The displayed box is a repeating cell: fields satisfy periodic boundary conditions, and ink crossing one face re-enters through the opposite face. Its buoyancy uses b − ⟨b⟩, where ⟨b⟩ is the volume mean, removing uniform acceleration of the whole fluid.

## Colour

Grid concentrations determine buoyancy. The image uses finer tracer samples, each carrying a fixed amount of one ink. Away from walls, a tracer’s position X follows

```
dX = u_h(X,t) dt + √(2D) dW.
```

u_h is the interpolated grid velocity. Independent Brownian motion W represents molecular diffusion with the same D: each time step Δt adds a Gaussian displacement of variance 2DΔt per coordinate. Midpoint integration approximates advection.

Normalised Gaussian kernels spread the samples into concentration integrated along viewing rays. For RGB channel k, the transmitted intensity is I_k = I₀,k exp(−∑ᵢ κᵢ,k ∫cᵢ ds), where I₀,k is the background intensity and κᵢ,k is ink i’s absorption coefficient. The coefficients are illustrative and leave the dynamics unchanged.

Picker RGB values specify relative transmittance through a 2 mm reference column: κ = −ln(RGB/255)/(0.002 m). Black uses a finite transmittance floor of 1/65535; white has zero absorption. The default blue #3657b2 retains the original coefficients [780, 540, 180] m⁻¹.

Up to five inks have separate concentration fields and weighted tracer samples, sharing the velocity field and diffusivity. Each ink uses independent Brownian sequences.

## Limitations

The fluid grid has 112 × 168 × 112 cells at Standard resolution and 160 × 240 × 160 at Fine. Flow advances in 0.01 s steps; dye transport uses smaller substeps when needed to keep the outgoing advective Courant number below 0.45. All fields use 32-bit floating-point values.

Fine optical filaments do not alter the coarser concentration field driving buoyancy. Grid spacing, numerical diffusion, tracer sampling and optical smoothing limit the detail. Velocity interpolation near stair-step corners introduces additional transport error. The prescribed initial spectrum and near-spherical drops define an idealised experiment. The model omits pipette injection, pigment settling, surface chemistry, variable viscosity, refraction and light scattering.

## References

Young, Y.-N., et al. (2001). [On the miscible Rayleigh–Taylor instability: two and three dimensions.](https://doi.org/10.1017/S0022112001005870) *Journal of Fluid Mechanics* 447, 377–408.

Arecchi, F. T., et al. (1996). [Fragmentation of a drop as it falls in a lighter miscible fluid.](https://doi.org/10.1103/PhysRevE.54.424) *Physical Review E* 54, 424–429.

Meunier, P., & Villermaux, E. (2022). [The diffuselet concept for scalar mixing.](https://doi.org/10.1017/jfm.2022.771) *Journal of Fluid Mechanics* 951, A33.
