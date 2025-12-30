
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PDFMetadata {
  numPages: number;
  fileName: string;
}

export interface GeminiCropResponse {
  label_found: boolean;
  crop_area: CropArea;
  explanation?: string;
}
