import type { ImageSegmenter } from "@mediapipe/tasks-vision";

// Pin to the installed package version — drift between the JS and the WASM
// runtime files surfaces as cryptic "magic word" errors at load time.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function getSegmenter(): Promise<ImageSegmenter> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import(
      "@mediapipe/tasks-vision"
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  })().catch((err) => {
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
}

/**
 * Returns a canvas of the same dimensions as the source image, with everything
 * outside the person silhouette painted pure white. Selfie segmenter category
 * mask: index 0 = person, non-zero = background.
 *
 * Throws if the model can't load or segmentation fails — callers should
 * fail-soft and use the original photo so a single bad inference never blocks
 * a print.
 */
export async function removeBackgroundToWhite(
  img: HTMLImageElement,
): Promise<HTMLCanvasElement> {
  const segmenter = await getSegmenter();
  const result = segmenter.segment(img);
  const mask = result.categoryMask;
  if (!mask) {
    result.close();
    throw new Error("segmenter returned no category mask");
  }

  // The mask is sized to the segmenter's internal resolution, not the source.
  // Render the photo at the source resolution and upscale the mask via a
  // smaller offscreen canvas so we don't lose photo detail.
  const outW = img.naturalWidth;
  const outH = img.naturalHeight;
  const mw = mask.width;
  const mh = mask.height;
  const maskData = mask.getAsUint8Array();
  result.close();

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mw;
  maskCanvas.height = mh;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("mask 2D context unavailable");
  const maskImage = maskCtx.createImageData(mw, mh);
  for (let i = 0; i < maskData.length; i++) {
    const pi = i * 4;
    // Person pixels stay transparent (we'll paint photo through). Background
    // pixels become opaque white.
    if (maskData[i] === 0) {
      maskImage.data[pi + 3] = 0;
    } else {
      maskImage.data[pi] = 255;
      maskImage.data[pi + 1] = 255;
      maskImage.data[pi + 2] = 255;
      maskImage.data[pi + 3] = 255;
    }
  }
  maskCtx.putImageData(maskImage, 0, 0);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);
  // Smooth scale of the mask to the photo resolution covers small misalignment
  // at the edges. Browser bilinear sampling here is the cheap version of mask
  // dilation and looks fine on 1-bit thermal output.
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(maskCanvas, 0, 0, outW, outH);

  return out;
}
