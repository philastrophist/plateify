# Annealing Debug UI

Open `src/tools/anneal-debug-ui.html` in a browser (or serve the repo root with a static server) to interactively debug simulated annealing.

## Features

- Initialize with the default Bayesian plate fixture graph from the spec.
- Step one move at a time or run multiple steps.
- Inspect move acceptance/rejection logs and total cost over time.
- Tune all cost-function weights (`L`, `X`, `B`, `F_out`, `F_down`, `F`, `S_span`, `S_waste`, `S`) via sliders.
