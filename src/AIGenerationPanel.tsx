import { useState } from "react";
import { generateImage } from "./aiGenerationProvider";
import { isStoredMediaPath, loadMediaBlobFromPath } from "./mediaAssetStore";
interface Props { prompt: string; defaultModel?: string; referenceImages?: string[]; onGenerated: (imageUrl: string, model: string, prompt: string) => void | Promise<void> }
export default function AIGenerationPanel({prompt,defaultModel,referenceImages=[],onGenerated}:Props) {
  const [endpoint,setEndpoint]=useState("");
  const [apiKey,setApiKey]=useState("");
  const [model,setModel]=useState(defaultModel||"gpt-image-1");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function toProviderReference(path:string):Promise<string> {
    if(path.startsWith("data:image/")) return path;
    let blob:Blob;
    if(isStoredMediaPath(path)) blob=await loadMediaBlobFromPath(path);
    else {
      const response=await fetch(path);
      if(!response.ok) throw new Error("Could not load a reference image for the configured AI provider.");
      blob=await response.blob();
    }
    if(!blob.type.startsWith("image/")) throw new Error("A selected generation reference is not an image.");
    return await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):reject(new Error("Could not encode a reference image."));
      reader.onerror=()=>reject(new Error("Could not encode a reference image."));
      reader.readAsDataURL(blob);
    });
  }
  async function run() {
    setBusy(true);setError("");
    try {
      const preparedReferences=await Promise.all(referenceImages.map(toProviderReference));
      const result=await generateImage({endpoint,apiKey,model,prompt,referenceImages:preparedReferences});
      await onGenerated(result.outputUrl,result.model??model,prompt);
    }
    catch(e) { setError(e instanceof Error?e.message:"Image generation failed."); }
    finally { setBusy(false); }
  }
  return <section className="ai-generation-panel" aria-label="AI image generation">
    <h4>AI image generation / regenerate</h4>
    <label>OpenAI-compatible image endpoint<input className="text-field" type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="https://provider.example/v1/images/generations" /></label>
    <label>API key (kept in memory only)<input className="text-field" type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Provider API key" /></label>
    <label>Model<input className="text-field" value={model} onChange={e=>setModel(e.target.value)} /></label>
    <button className="button button-primary button-small" type="button" disabled={busy||!prompt.trim()||!endpoint.trim()||!apiKey.trim()||!model.trim()} onClick={()=>void run()}>{busy?"Generating…":"Generate / regenerate image"}</button>
    {error&&<p role="alert" className="error-text">{error}</p>}
    <small>Calls the configured provider directly from this browser. {referenceImages.length ? `${referenceImages.length} image reference(s) will be sent with the prompt. ` : "No image references selected. "}Provider CORS support and credentials are required. Avoid untrusted endpoints.</small>
  </section>;
}
