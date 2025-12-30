
import { GoogleGenAI, Type } from "@google/genai";
import { GeminiCropResponse } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const detectShippingLabel = async (base64Image: string): Promise<GeminiCropResponse | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image.split(',')[1],
              },
            },
            {
              text: "Identify the bounding box of the shipping label on this document. Return the coordinates as percentages (0-100) of the image width and height. For example {x: 10, y: 10, width: 80, height: 40}. Ensure the crop includes all barcodes and text necessary for delivery.",
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            label_found: { type: Type.BOOLEAN },
            crop_area: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER },
              },
              required: ["x", "y", "width", "height"],
            },
            explanation: { type: Type.STRING },
          },
          required: ["label_found", "crop_area"],
        },
      },
    });

    const result = JSON.parse(response.text);
    return result as GeminiCropResponse;
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};
