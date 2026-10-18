import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImage } from "./aiGenerationProvider";
afterEach(()=>vi.unstubAllGlobals());
describe("generateImage",()=>{
  it("validates provider settings before making a network request",async()=>{
    const fetchMock=vi.fn(); vi.stubGlobal("fetch",fetchMock);
    await expect(generateImage({endpoint:"",apiKey:"key",model:"m",prompt:"p"})).rejects.toThrow(/endpoint/);
    await expect(generateImage({endpoint:"https://provider.test/v1/images/generations",apiKey:"",model:"m",prompt:"p"})).rejects.toThrow(/API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends prompt/model and returns provider image URL",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:"image-v1",data:[{url:"https://cdn.test/generated.png"}]}),{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetchMock);
    const reference="data:image/png;base64,dGVzdA==";
    const result=await generateImage({endpoint:"https://provider.test/v1/images/generations",apiKey:"test-key",model:"image-v1",prompt:"cinematic skyline",referenceImages:[reference]});
    expect(fetchMock).toHaveBeenCalledWith("https://provider.test/v1/images/generations",expect.objectContaining({method:"POST",headers:expect.objectContaining({Authorization:"Bearer test-key"})}));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({model:"image-v1",prompt:"cinematic skyline",reference_images:[reference]});
    expect(result.outputUrl).toBe("https://cdn.test/generated.png");
  });
  it("surfaces HTTP and malformed provider responses",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("no", {status:503})));
    await expect(generateImage({endpoint:"https://provider.test",apiKey:"k",model:"m",prompt:"p"})).rejects.toThrow(/HTTP 503/);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[]}),{status:200})));
    await expect(generateImage({endpoint:"https://provider.test",apiKey:"k",model:"m",prompt:"p"})).rejects.toThrow(/did not contain/);
  });
});
