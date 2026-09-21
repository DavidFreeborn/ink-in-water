# Ink in Water: model description

## How the ink stretches

Different parts of a drop move at different velocities, stretching the dye into sheets and filaments. Molecular diffusion gradually erases the concentration gradients across these structures.

The model follows dissolved dye in three dimensions. Each concentration cᵢ is scaled to equal one in the initial ink solution. For two inks, the fractional density change is b = β₁c₁ + β₂c₂, giving density ρ = ρ₀(1 + b), where ρ₀ is water density and βᵢ is each ink’s fractional density contrast. With one ink, c₂ = 0. The Boussinesq approximation retains these small density differences only in buoyancy.

```
∇ · u = 0
∂u/∂t + (u · ∇)u = −∇π + ν∇²u − gb e_y
∂cᵢ/∂t + ∇ · (cᵢu) = D∇²cᵢ
```

Here u is velocity, t is time, π is pressure divided by water density after subtracting hydrostatic pressure, and e_y is the upward unit vector. The equations conserve fluid volume, evolve velocity under pressure, viscosity and buoyancy, and transport each ink through the shared flow.

Kinematic viscosity is ν = 10⁻⁶ m² s⁻¹, dye diffusivity is D = 10⁻⁹ m² s⁻¹, and gravity is g = 9.81 m s⁻². Current strength multiplies an initial velocity field with amplitude parameter 4 mm s⁻¹ and wavelength 20 mm; zero starts at rest. Pressure projection adjusts the initial flow to the selected walls.

The staggered-grid solver uses bounded MacCormack velocity advection, explicit viscosity, conservative finite-volume dye transport with MC limiting and SSP-RK2, and approximate multigrid pressure projection. Each step uses three pressure V-cycles for curved containers and two for the cuboid or torus. Shared face fluxes preserve the total amount of each ink.

Speed sets the requested number of fixed steps per second without changing their duration or the physical parameters; hardware may limit the actual rate. Changing Currents sets a new initial flow and restarts the experiment. Positive Density contrast drives sinking, negative values drive rising, and zero removes that ink’s buoyancy contribution. Fine uses smaller grid cells and more tracer samples.

## What the boundaries do

The cuboid, cylinder and sphere are sealed containers. Water cannot cross their walls and can slide along them without friction (free-slip). Dye has zero flux through a wall. Curved containers are approximated by stair-step surfaces made from grid cells; the velocity, dye and reflected tracers use these same walls.

The cuboid measures 8 × 12 × 8 cm. The cylinder has radius 4 cm and height 12 cm; the sphere has radius 4 cm. Only cells whose corners lie inside the selected shape contain fluid.

The torus joins opposite faces of a cuboid: all fields are periodic, and tracers crossing a face re-enter opposite. Its buoyancy uses b − ⟨b⟩, where ⟨b⟩ is the volume mean, removing uniform acceleration of the whole fluid.

## How colour is formed

Grid concentrations determine buoyancy. The image uses finer tracer samples, each carrying a fixed amount of one ink. Away from walls, a tracer’s position X follows

```
dX = u_h(X,t) dt + √(2D) dW.
```

u_h is the interpolated grid velocity. Independent Brownian motion W represents molecular diffusion with the same D: each time step Δt adds a Gaussian displacement of variance 2DΔt per coordinate. Midpoint integration approximates advection.

Normalised Gaussian kernels spread the samples into an image of concentration integrated along viewing rays. Beer–Lambert absorption converts the two ink amounts into transmitted colour. Their absorption adds where they overlap. Colour choices set illustrative absorption coefficients and leave the dynamics unchanged.

## What limits the model

The fluid grid has 112 × 168 × 112 cells at Standard resolution and 160 × 240 × 160 at Fine. Flow advances in 0.01 s steps; dye transport uses smaller substeps when needed to keep the outgoing advective Courant number below 0.45. All fields use 32-bit floating-point values.

Fine optical filaments do not alter the coarser concentration field driving buoyancy. Grid spacing, numerical diffusion, tracer sampling and optical smoothing limit the detail. Velocity interpolation near stair-step corners introduces additional transport error. The model describes idealised miscible dye and omits pigment settling, surface chemistry, variable viscosity, refraction and light scattering.

Physical background: [Young et al. (2001)](https://doi.org/10.1017/S0022112001005870), buoyant miscible flow; [Arecchi et al. (1996)](https://doi.org/10.1103/PhysRevE.54.424), drop fragmentation; [Meunier & Villermaux (2022)](https://doi.org/10.1017/jfm.2022.771), scalar stretching and mixing.
