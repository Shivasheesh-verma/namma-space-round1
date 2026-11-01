# Namma Space, Round 1

Shivasheesh Verma, Sarvagya, and Vidhi.

A walkable classroom. The picture is a Gaussian splat trained from an iPhone LiDAR capture. The plan is the measured floor, 8.95 m by 7.43 m, with the furniture from the LiDAR, a 2 m scale bar, the closed door, and you.

The viewer stays online. It does not need this computer to be awake.

- **Viewer:** https://namma-space-viewer.vercel.app/
- **Video, 3 min 59 s:** [docs/Demonstration.mp4](docs/Demonstration.mp4). This file plays on its own.
- **Code:** https://github.com/Shivasheesh-verma/namma-space-round1

Click the picture, then WASD. The mouse looks. Shift is faster. R returns to the start. Walls and the closed door stop you. Furniture does not. The top left counts the download, then shows the frame rate.

## What is where

| Path | Contents |
| --- | --- |
| [index.html](index.html) | The viewer page |
| [assets/](assets) | The renderer. This is what the page loads |
| [mushroom/](mushroom) | Walls, door, furniture plan, start point, and the splat |
| [docs/](docs) | Technical abstract, proof of concept, and the video |
| [docs/Technical-Abstract.pdf](docs/Technical-Abstract.pdf) | Architecture, pipeline, capture procedure, and the check (2 pages) |
| [docs/Proof-of-Concept.pdf](docs/Proof-of-Concept.pdf) | The viewer link and the video link |
| [docs/Demonstration.mp4](docs/Demonstration.mp4) | The video, 3 min 59 s. |
| [RECONSTRUCT.md](RECONSTRUCT.md) | How the model was trained |
| [pipeline/mushroom_classroom_1m.json](pipeline/mushroom_classroom_1m.json) | The train config |
| [test/sample/](test/sample) | Eight frames of the capture: photo, depth, pose |

## Run it on this machine

```
python3 -m http.server 8766
```

Open http://127.0.0.1:8766/

## The splat files

The picture on the viewer link is the 888,760-point export, about 220 MB. GitHub cannot store that file in the repository.

## Credit

MuSHRoom classroom, iPhone 12 Pro Max, November 2023, CC BY 4.0. The photos and the depth belong to that release. Held-out check on 24 views: 22.9 dB PSNR, SSIM 0.739, depth error 7.0 cm.
