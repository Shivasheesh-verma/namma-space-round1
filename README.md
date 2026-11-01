# Namma Space, Round 1

A walkable classroom. The picture is a Gaussian splat trained from an iPhone LiDAR capture. The plan is the measured floor, 8.95 m by 7.43 m, with the furniture from the LiDAR, a 2 m scale bar, the closed door, and you.

- **Walk it:** https://shivasheesh-verma.github.io/namma-space-round1/
- **Watch the video (3 min 57 s):** https://shivasheesh-verma.github.io/namma-space-round1/docs/Demonstration.mp4

Click the picture, then WASD. The mouse looks. Shift is faster. R returns to the start. Walls and the closed door stop you. Furniture does not. The page downloads 83 MB before the room appears; the line at the top left counts the download, then shows the frame rate.

GitHub's file page cannot preview the video, so open the link above. The browser plays it directly.

## What is where

| Path | Contents |
| --- | --- |
| [index.html](index.html) | The viewer page |
| [src/mushroom.js](src/mushroom.js) | Loads the room, draws the plan, handles walking |
| [src/collision.js](src/collision.js) | Wall and door test for each step |
| [vendor/](vendor) | Three.js 0.180.0 and Spark 2.3.1, served with the page, MIT licences included |
| [mushroom/](mushroom) | Walls, door, furniture plan, start point, and the splat the viewer loads |
| [docs/](docs) | Technical abstract, proof of concept, and the video |
| [docs/Technical-Abstract.pdf](docs/Technical-Abstract.pdf) | Architecture, pipeline, capture procedure, and the check (2 pages) |
| [docs/Proof-of-Concept.pdf](docs/Proof-of-Concept.pdf) | The viewer link and the video link |
| [docs/Demonstration.mp4](docs/Demonstration.mp4) | The video file, 3 min 57 s, 14 MB |
| [RECONSTRUCT.md](RECONSTRUCT.md) | How the model was trained |
| [pipeline/mushroom_classroom_1m.json](pipeline/mushroom_classroom_1m.json) | The train config |
| [test/sample/](test/sample) | Eight frames of the capture: photo, depth, pose |

## Run it on this machine

```
python3 -m http.server 8766
```

Open http://127.0.0.1:8766/

## The splat files

`mushroom/scene.ply` is 333,910 points, 83 MB, taken unchanged from the trained file so GitHub Pages can host it. The full trained file has 888,760 points and is 220 MB. It is `scene.ply` on the [round1 release](https://github.com/Shivasheesh-verma/namma-space-round1/releases/tag/round1).

## Credit

MuSHRoom classroom, iPhone 12 Pro Max, November 2023, CC BY 4.0. The photos and the depth belong to that release. Held-out check on 24 views: 22.9 dB PSNR, SSIM 0.739, depth error 7.0 cm.
