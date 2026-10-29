# Explore the reconstruction

Interactive Gaussian rendering of GeoGSplat and the original TokenGS checkpoint. Drag either image to rotate, scroll to zoom, or play the shared camera tour. Each example uses the same four input views for both methods and retains all 65,536 predicted Gaussians. The rendering resolution is 256 × 256 per method.

Serve this directory with any static HTTP server:

```bash
python -m http.server 17889
```

Open the server on port 17889. All JavaScript, images, cameras and model outputs are local. No model inference, Viser service, external CDN or build step is needed. The same viewer is embedded in the project page using `index.html?embed`.

The examples are selected qualitative comparisons, not a benchmark average. No Gaussian selection or opacity prefilter is applied. Original appearance parameters are retained; removing their technical labels does not change rendering. The browser renderer and the evaluation rasterizer are different implementations, so the results need not be pixel-identical.

Four examples are available: Laughing Buddha, Carved dragon, Kitchen interior, and Kitchen workspace. Kitchen workspace uses a shared virtual orbit with ±16° horizontal motion, ±6° vertical motion, and up to 6% shorter camera-to-focus distance. The initial camera is unchanged; the tour includes virtual viewpoints rather than only interpolating the original reference cameras.

Spark and Three.js are vendored under `vendor/` with their licenses. Automatic LoD is disabled. Pre-rendered images remain available if WebGL cannot initialize.
