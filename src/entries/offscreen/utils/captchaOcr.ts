import * as ort from "onnxruntime-web/wasm";

const MODEL_URL = "ocr/common.onnx";
const CHARSETS_URL = "ocr/charsets.json";
const WASM_BASE_URL = "ocr/";
const TARGET_HEIGHT = 64;

let session: ort.InferenceSession | null = null;
let charsets: string[] | null = null;

function runtimeUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    ort.env.wasm.wasmPaths = runtimeUrl(WASM_BASE_URL);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.logLevel = "error";

    const response = await fetch(runtimeUrl(MODEL_URL));
    if (!response.ok) {
      throw new Error(`本地OCR模型加载失败: HTTP ${response.status}`);
    }
    session = await ort.InferenceSession.create(await response.arrayBuffer(), {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
  return session;
}

async function getCharsets(): Promise<string[]> {
  if (!charsets) {
    const response = await fetch(runtimeUrl(CHARSETS_URL));
    if (!response.ok) {
      throw new Error(`本地OCR字符集加载失败: HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("本地OCR字符集格式无效");
    }
    charsets = data.map((item) => String(item));
  }
  return charsets;
}

function toGrayscale(data: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    gray[i / 4] = Math.round(
      0.2126 * (data[i] * alpha + 255 * (1 - alpha)) +
        0.7152 * (data[i + 1] * alpha + 255 * (1 - alpha)) +
        0.0722 * (data[i + 2] * alpha + 255 * (1 - alpha)),
    );
  }
  return gray;
}

function resize(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(targetWidth * targetHeight);
  const xRatio = width / targetWidth;
  const yRatio = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const px = x * xRatio;
      const py = y * yRatio;
      const x1 = Math.floor(px);
      const x2 = Math.min(x1 + 1, width - 1);
      const y1 = Math.floor(py);
      const y2 = Math.min(y1 + 1, height - 1);
      const fx = px - x1;
      const fy = py - y1;
      result[y * targetWidth + x] = Math.round(
        data[y1 * width + x1] * (1 - fx) * (1 - fy) +
          data[y1 * width + x2] * fx * (1 - fy) +
          data[y2 * width + x1] * (1 - fx) * fy +
          data[y2 * width + x2] * fx * fy,
      );
    }
  }
  return result;
}

async function prepareImage(image: Blob): Promise<{ data: Float32Array; width: number }> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("本地OCR无法创建画布");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const gray = toGrayscale(context.getImageData(0, 0, canvas.width, canvas.height).data);
    const targetWidth = Math.max(1, Math.floor(canvas.width * (TARGET_HEIGHT / canvas.height)));
    const resized = resize(gray, canvas.width, canvas.height, targetWidth, TARGET_HEIGHT);
    const normalized = new Float32Array(resized.length);
    for (let i = 0; i < resized.length; i += 1) {
      normalized[i] = resized[i] / 255;
    }
    return { data: normalized, width: targetWidth };
  } finally {
    bitmap.close();
  }
}

function decodeOutput(output: ort.Tensor, chars: string[]): string {
  const decoded: string[] = [];
  let previous = -1;
  for (const raw of Array.from(output.data as Iterable<number | bigint>)) {
    const index = typeof raw === "bigint" ? Number(raw) : Math.round(raw);
    if (index === previous) {
      continue;
    }
    previous = index;
    if (index > 0 && index < chars.length && chars[index]) {
      decoded.push(chars[index]);
    }
  }
  return decoded.join("").trim();
}

export async function recognizeCaptchaOffline(image: Blob): Promise<string> {
  const [ocrSession, chars, prepared] = await Promise.all([getSession(), getCharsets(), prepareImage(image)]);
  const input = new ort.Tensor("float32", prepared.data, [1, 1, TARGET_HEIGHT, prepared.width]);
  const outputs = await ocrSession.run({ input1: input });
  const output = outputs.output ?? outputs[Object.keys(outputs)[0]];
  if (!output) {
    throw new Error("本地OCR输出为空");
  }
  const result = decodeOutput(output, chars);
  if (!result) {
    throw new Error("本地OCR未识别出验证码");
  }
  return result;
}
