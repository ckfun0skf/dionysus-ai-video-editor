export interface GenerationRequest {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  referenceImages?: string[];
  signal?: AbortSignal;
}
export interface GenerationResponse { outputUrl: string; model?: string; raw: unknown }
/**
 * Calls a user-configured OpenAI-compatible image generation endpoint.
 * No API key is stored by this module; pass it per request and configure a trusted endpoint.
 */
export async function generateImage(request: GenerationRequest): Promise<GenerationResponse> {
  if (!request.endpoint.trim()) throw new Error("Configure an image-generation endpoint first.");
  if (!request.apiKey.trim()) throw new Error("An API key is required for the configured provider.");
  if (!request.model.trim() || !request.prompt.trim()) throw new Error("Model and prompt are required.");
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}` },
    signal: request.signal,
    body: JSON.stringify({ model: request.model, prompt: request.prompt, n: 1, size: "1024x1024", ...(request.referenceImages?.length ? { reference_images: request.referenceImages } : {}) })
  });
  if (!response.ok) throw new Error(`Image provider returned HTTP ${response.status}`);
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") throw new Error("Image provider returned an invalid response.");
  const data = (raw as { data?: Array<{ url?: string; b64_json?: string }>; output?: string; model?: string });
  const first = data.data?.[0];
  const outputUrl = first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : data.output);
  if (!outputUrl || typeof outputUrl !== "string") throw new Error("Provider response did not contain an image URL or base64 image.");
  return { outputUrl, model: data.model ?? request.model, raw };
}
