const OUTPUT_SIZE = 512;
const OUTPUT_QUALITY = 0.92;
const OUTPUT_TYPE = "image/webp";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，请重试"));
    image.src = src;
  });
}

/**
 * Renders the user-selected crop region to a 512x512 WebP File, ready for upload.
 * `crop` is the pixel region reported by react-easy-crop's onCropComplete.
 */
export async function createCroppedAvatarFile(
  imageSrc: string,
  crop: { x: number; y: number; width: number; height: number }
): Promise<File> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法处理图片");
  }
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY)
  );
  if (!blob) {
    throw new Error("当前浏览器无法处理图片");
  }
  return new File([blob], "avatar.webp", { type: OUTPUT_TYPE });
}
