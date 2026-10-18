import { useState } from "react";
import { generateImage } from "./aiGenerationProvider";
interface Props { prompt: string; defaultModel?: string; onGenerated: (imageUrl: string, model: string, prompt: string) => void }
export default function AIGenerationPanel({prompt,defaultModel,onGenerated}:Props) {
  const [endpoint,setEndpoint]=useState("");
  const [apiKey,setApiKey]=useState("");
  const [model,setModel]=useState(defaultModel||"gpt-image-1");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function run() {
    setBusy(true);setError("");
    try { const result=await generateImage({endpoint,apiKey,model,prompt}); onGenerated(result.outputUrl,result.model??model,prompt); }
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
    <small>Calls the configured provider directly from this browser. Provider CORS support and credentials are required. Avoid untrusted endpoints.</small>
  </section>;
}
