# Room files

Shivasheesh Verma, Class 11, Gulmohar High School. Sarvagya Kaushik, Class 11, Gulmohar High School. Vidhi Arora, Class 11, Springdale Senior School.

The viewer reads these files. The public picture is the same 220 MB file, served from https://namma-space-viewer.vercel.app/

| File | What it is |
| --- | --- |
| `scene.ply` | A smaller copy kept in the repository, about 83 MB. The viewer loads the full 220 MB file. |
| `collision.json` | The floor polygon, the walls, and the closed door. These stop the walk. |
| `plan.json` | The furniture on the plan, from the LiDAR, in 10 cm cells. Drawn only. It does not stop the walk. |
| `spawn.json` | Where the walk starts. |
| `pois.json` | The places the search knows. A place is not confirmed until a person has put their name in `labeled_by`. |
| `plan-top.png`, `plan-top.json` | The flat surfaces of the splat seen from above, desk tops and seats, and where the picture sits on the plan. Made by `pipeline/plan_top.py`. Nothing is filled in. |
| `README.md` | This list. |
