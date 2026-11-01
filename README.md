# Namma Space, Round 1

A walkable classroom. The picture is a Gaussian splat trained from an iPhone LiDAR capture. The plan is the measured floor.

Walk it: https://shivasheesh-verma.github.io/namma-space-round1/

Click the picture, then WASD. Shift is faster. R returns to the start. Walls and the closed door stop you.

## What is where

| Path | Contents |
| --- | --- |
| `index.html` | The viewer |
| `mushroom/` | Floor, door, furniture plan, and the splat the viewer loads |
| `docs/Technical-Abstract.pdf` | Architecture, pipeline, and the capture procedure (2 pages) |
| `docs/Proof-of-Concept.pdf` | The viewer link |
| [docs/Demonstration.mp4](docs/Demonstration.mp4) | The video. Open that link and press play. 3 min 57 s |
| `RECONSTRUCT.md` | How the model was trained |
| `pipeline/mushroom_classroom_1m.json` | The train config |
| `test/sample/` | Eight frames of the capture: photo, depth, pose |

## Run it on this machine

```
python3 -m http.server 8766
```

Open http://127.0.0.1:8766/

`mushroom/scene.ply` is the trained classroom, thinned to 333,910 points so the page can host it and finish loading. The full 888,760-point file is the [round1 release](https://github.com/Shivasheesh-verma/namma-space-round1/releases/tag/round1).

## Credit

MuSHRoom classroom, iPhone 12 Pro Max, November 2023, CC BY 4.0. The photos and the depth belong to that release. Held-out check: 22.9 dB, SSIM 0.739, depth error 7.0 cm, 999,454 points.
