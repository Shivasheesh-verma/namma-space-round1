# Room files

The viewer reads these five files.

| File | What it is |
| --- | --- |
| `scene.ply` | The picture. 333,910 Gaussian splat points, 83 MB, a subset of the 888,760-point trained file. The full file is on the `round1` release. |
| `collision.json` | The floor polygon, the walls, and the closed door. These stop the walk. |
| `plan.json` | The furniture on the plan, from the LiDAR, in 10 cm cells. Drawn only. It does not stop the walk. |
| `spawn.json` | Where the walk starts. |
| `README.md` | This list. |
