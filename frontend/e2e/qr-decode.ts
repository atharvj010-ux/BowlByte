import { createHash } from "node:crypto";

import {
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";
import type { Page } from "@playwright/test";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashQrLuminance(luminance: number[], width: number, height: number): string {
  const source = new RGBLuminanceSource(Uint8ClampedArray.from(luminance), width, height);
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new QRCodeReader();
  let failure: unknown;
  for (const binarizer of [new HybridBinarizer(source), new GlobalHistogramBinarizer(source)]) {
    try {
      return sha256(reader.decode(new BinaryBitmap(binarizer), hints).getText());
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error ? new Error("QR image could not be decoded.") : failure;
}

async function captureQr(page: Page, testId: string, scale: number) {
  return page.getByTestId(testId).locator("svg").first().evaluate(async (svg, scale) => {
    if (!svg.getAttribute("xmlns")) {
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const base = Number(svg.getAttribute("width")) || img.naturalWidth || 232;
      const size = base * scale;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("QR canvas was unavailable.");
      }
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.drawImage(img, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      const luminance = new Array<number>(size * size);
      let dark = 0;
      for (let index = 0; index < luminance.length; index += 1) {
        const offset = index * 4;
        const value = Math.round((pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3);
        luminance[index] = value;
        if (value < 128) {
          dark += 1;
        }
      }
      if (dark < 100) {
        throw new Error("QR image was blank.");
      }
      return { width: size, height: size, luminance };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, scale);
}

export async function qrImageHash(page: Page, testId = "pickup-qr"): Promise<string> {
  let failure: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const scale of [1, 2, 3]) {
      try {
        const image = await captureQr(page, testId, scale);
        return hashQrLuminance(image.luminance, image.width, image.height);
      } catch (error) {
        failure = error;
      }
    }
    await page.waitForTimeout(300);
  }
  throw failure instanceof Error ? failure : new Error("QR image could not be decoded.");
}
