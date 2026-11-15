# Room files, 27 October capture

Shivasheesh Verma, Class 11, Gulmohar High School. Sarvagya Kaushik, Class 11, Gulmohar High School. Vidhi Arora, Class 11, Springdale Senior School.

Our own capture: one walk with Record3D on an iPhone with LiDAR, 27 October 2026, 94 seconds, 5,648 frames. A corridor, an opening, then a room.

| File | What it is |
| --- | --- |
| `collision.json` | The rectangle around the floor, the floor height, the eye height, and the body radius. |
| `plan.json` | In 10 cm cells, everything that is not free floor: walls, furniture, and floor the capture never measured. These cells stop the walk. |
| `spawn.json` | Where the walk starts: the first position of the phone, and the way it faced. |
| `pois.json` | The places the search knows. It is empty. A person names the places. |
| `scene.ply` | The splat, 999,429 gaussians, about 207 MB. Not in the repository: here it is a link to the trainer's export on this machine. `oct27.html` reads it from this folder. |

`collision.json`, `plan.json` and `spawn.json` are made by `pipeline/free_floor.py` from the LiDAR depth and the phone's own path. A cell is free floor when the LiDAR saw floor there with nothing standing on it, or when the phone was carried within 25 cm of it. Nothing else is walkable, and nothing was drawn by hand.

There is no top-down picture of the scan on this plan. `pipeline/plan_top.py` was run on this splat: a corridor has no desk tops, and the floor alone came out in patches, so the plan shows the measured floor cells only.

## Credit

- Capture: Record3D on an iPhone with LiDAR, by the team.
- Training: the team's `m4recon` trainer in `experiments/m4-reconstruction`, on metal-gauss 0.2.1 (MIT) with the gsplat 1.4 densification strategy (Apache-2.0).
- Viewer: Spark 2.3.1 by World Labs (MIT) on three.js (MIT).
- No paid service is used.
