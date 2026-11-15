# Room files, 27 October capture

Shivasheesh Verma, Class 11, Gulmohar High School. Sarvagya Kaushik, Class 11, Gulmohar High School. Vidhi Arora, Class 11, Springdale Senior School.

Our own capture: one walk with Record3D on an iPhone with LiDAR, 27 October 2026, 94 seconds, 5,648 frames. A corridor, an opening, then a room.

| File | What it is |
| --- | --- |
| `collision.json` | The rectangle around the floor, the floor height, the eye height, and the body radius. |
| `plan.json` | In 10 cm cells, everything that is not free floor: walls, furniture, and floor the capture never measured. These cells stop the walk. |
| `spawn.json` | Where the walk starts: the first position of the phone. The view looks down the walk. The phone's own first frame faced a wall 0.6 m away. |
| `pois.json` | The places the search knows. It is empty. A person names the places. |
| `scene.ply` | The splat, 836,110 gaussians, about 198 MB. Not in the repository: here it is a link to the trainer's export on this machine. `oct27.html` reads it from this folder. |

`collision.json`, `plan.json` and `spawn.json` are made by `pipeline/free_floor.py` from the LiDAR depth and the phone's own path. A cell is free floor when the LiDAR saw floor there with nothing standing on it, or when the phone was carried within 25 cm of it. Nothing else is walkable, and nothing was drawn by hand.

`plan-top.png` is a top-down of the phone's own depth and photos, made by `pipeline/plan_lidar.py`. Colour is kept within 0.4 m of the free or walked floor. An overhead render of the splat is fog, because the gaussians face the walking cameras, and `pipeline/plan_top.py` on this splat found no desk tops and only patches of floor. The plan still draws the measured floor cells, with this picture under them.

## Credit

- Capture: Record3D on an iPhone with LiDAR, by the team.
- Training: the team's `m4recon` trainer in `experiments/m4-reconstruction`, on metal-gauss 0.2.1 (MIT) with the gsplat 1.4 densification strategy (Apache-2.0).
- Viewer: Spark 2.3.1 by World Labs (MIT) on three.js (MIT).
- No paid service is used.
