import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Draw mode: freehand red lines. Crop mode: drag a rectangle to crop. */
type Mode = "draw" | "crop";

/**
 * A single drawn line composed of raw-image-coordinate points.
 */
type Line = { points: { x: number; y: number }[] };

/**
 * Props for the ScreenshotEditor component.
 */
export interface ScreenshotEditorProps {
  /** Data URL (or object URL) for the image to annotate. */
  image: string;
  /** Called with a new PNG File whenever the image is mutated (draw stroke finished or crop applied). */
  onImageChange: (file: File) => void;
  /** Called when the user requests a fresh screen capture. */
  onRecapture: () => void;
}

/**
 * Canvas-based screenshot annotation widget.
 *
 * Supports two modes:
 * - **Draw**: freehand red-line annotation painted at display scale, exported at full resolution.
 * - **Crop**: drag a rectangle; on mouse-up the selection is cut out and exported as a new PNG.
 *
 * The displayed canvas is scaled to fit within 650×420 px.
 * All export operations use an off-screen canvas at the image's original pixel dimensions.
 */
export const ScreenshotEditor = (props: ScreenshotEditorProps) => {
  const { image, onImageChange, onRecapture } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("draw");
  const [lines, setLines] = useState<Line[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [cropping, setCropping] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Load image whenever the `image` prop changes.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
      setLines([]);
    };
    img.src = image;
  }, [image]);

  /**
   * Returns the display dimensions and the scale factor applied to fit the
   * image within 650×420 px without upscaling.
   */
  const getCanvasSize = useCallback(() => {
    const img = imgRef.current;
    if (!img) return { width: 0, height: 0, scale: 1 };
    const maxWidth = 650;
    const maxHeight = 420;
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    return {
      width: img.width * scale,
      height: img.height * scale,
      scale,
    };
  }, []);

  // Re-render the canvas whenever image, lines, or crop state change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;

    const { width, height, scale } = getCanvasSize();
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, width, height);

    // Draw annotation lines (scaled to display size).
    for (const line of lines) {
      if (line.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(line.points[0].x * scale, line.points[0].y * scale);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x * scale, line.points[i].y * scale);
      }
      ctx.stroke();
    }

    // Draw crop overlay when a crop selection is active.
    if (cropStart && cropEnd) {
      const x = Math.min(cropStart.x, cropEnd.x) * scale;
      const y = Math.min(cropStart.y, cropEnd.y) * scale;
      const w = Math.abs(cropEnd.x - cropStart.x) * scale;
      const h = Math.abs(cropEnd.y - cropStart.y) * scale;

      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(0, 0, width, y);
      ctx.fillRect(0, y + h, width, height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, width - x - w, h);

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }, [imgLoaded, lines, cropStart, cropEnd, getCanvasSize]);

  /**
   * Translates a mouse event position to image-space coordinates (un-scaled).
   */
  const getCoords = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale } = getCanvasSize();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    const coords = getCoords(e);
    if (mode === "draw") {
      setDrawing(true);
      setLines((prev) => [...prev, { points: [coords] }]);
    } else {
      setCropping(true);
      setCropStart(coords);
      setCropEnd(coords);
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const coords = getCoords(e);
    if (mode === "draw" && drawing) {
      setLines((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last) {
          updated[updated.length - 1] = { points: [...last.points, coords] };
        }
        return updated;
      });
    } else if (mode === "crop" && cropping) {
      setCropEnd(coords);
    }
  };

  const handleMouseUp = () => {
    if (mode === "draw") {
      setDrawing(false);
      exportImage();
    } else if (mode === "crop" && cropStart && cropEnd) {
      setCropping(false);
      applyCrop();
    }
  };

  /**
   * Cuts the crop selection out of the image at full resolution.
   * Redraws any annotation lines that were inside the crop region.
   * Calls `onImageChange` with the new PNG file.
   */
  const applyCrop = () => {
    const img = imgRef.current;
    if (!img || !cropStart || !cropEnd) return;

    const x = Math.min(cropStart.x, cropEnd.x);
    const y = Math.min(cropStart.y, cropEnd.y);
    const w = Math.abs(cropEnd.x - cropStart.x);
    const h = Math.abs(cropEnd.y - cropStart.y);

    // Ignore tiny selections.
    if (w < 10 || h < 10) {
      setCropStart(null);
      setCropEnd(null);
      return;
    }

    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d")!;

    // Draw the original image, cropped to the selection.
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

    // Redraw annotation lines that overlap with the crop area, offset to local coords.
    for (const line of lines) {
      if (line.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(line.points[0].x - x, line.points[0].y - y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x - x, line.points[i].y - y);
      }
      ctx.stroke();
    }

    offscreen.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "screenshot.png", { type: "image/png" });
      const url = URL.createObjectURL(blob);

      // Reset annotation and crop state, then load the cropped image.
      setLines([]);
      setCropStart(null);
      setCropEnd(null);

      const newImg = new Image();
      newImg.onload = () => {
        imgRef.current = newImg;
        // Toggle imgLoaded to force a re-render after the new image is ready.
        setImgLoaded((v) => !v);
        setTimeout(() => setImgLoaded(true), 0);
      };
      newImg.src = url;
      onImageChange(file);
    }, "image/png");
  };

  /**
   * Exports the current annotation at full image resolution using an off-screen
   * canvas.  Points are stored in image-space so no scale factor is needed here.
   */
  const exportImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = imgRef.current;
    if (!img) return;

    const offscreen = document.createElement("canvas");
    offscreen.width = img.width;
    offscreen.height = img.height;
    const ctx = offscreen.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    for (const line of lines) {
      if (line.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      ctx.stroke();
    }

    offscreen.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "screenshot.png", { type: "image/png" });
      onImageChange(file);
    }, "image/png");
  };

  return (
    <div className="sigil-editor">
      <div className="sigil-editor__toolbar">
        <div
          className="sigil-editor__mode-group"
          role="group"
          aria-label="Annotation mode"
        >
          <button
            type="button"
            className={`sigil-btn sigil-btn--mode${mode === "crop" ? " sigil-btn--active" : ""}`}
            onClick={() => setMode("crop")}
            aria-pressed={mode === "crop"}
          >
            Crop
          </button>
          <button
            type="button"
            className={`sigil-btn sigil-btn--mode${mode === "draw" ? " sigil-btn--active" : ""}`}
            onClick={() => setMode("draw")}
            aria-pressed={mode === "draw"}
          >
            Draw
          </button>
        </div>
        <button
          type="button"
          className="sigil-btn sigil-btn--outline"
          onClick={onRecapture}
        >
          Recapture
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="sigil-editor__canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
};
