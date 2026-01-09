ComfyUI exposes a built-in HTTP API on its server, which is perfect for programmatic queries like listing available **models** (checkpoints), **VAEs**, **samplers**, and more. This fits seamlessly into your **RoleForge** project, where your Node.js backend can fetch these dynamically from a local or remote ComfyUI instance to populate dropdowns or validate workflows before triggering image/video generation.

### Server Address
The ComfyUI server runs by default on `http://127.0.0.1:8188` (most common for manual installs) or `http://127.0.0.1:8000` (some desktop/portable builds).  
- For local access → use `localhost` or `127.0.0.1`.  
- For remote/LAN access → start ComfyUI with `--listen 0.0.0.0` (or set it in settings) and use your machine's IP, e.g., `http://192.168.1.100:8188`.  
All API endpoints are relative to this base URL.

### Key Endpoint for Querying Models, VAEs, Samplers, etc.
The primary way to discover available options is the **GET /object_info** endpoint (or **/object_info/{node_class}** for a specific node).

- **GET /object_info** — Returns a JSON object describing **all loaded nodes**, including their input types and valid values (e.g., dropdown lists populated from your installed files).
- **GET /object_info/CheckpointLoaderSimple** — Returns just the info for that node.

This dynamically reflects whatever models/VAEs you have in your `ComfyUI/models/` folders—no hardcoding needed.

#### Examples of What You'll Get
Here are the relevant nodes and the fields that contain the lists:

| Node Class                  | Endpoint Example                              | Key Field with List                  | What It Contains                          |
|--------------------------------|-----------------------------------------------|--------------------------------------|-------------------------------------------|
| CheckpointLoaderSimple        | /object_info/CheckpointLoaderSimple          | input.required.ckpt_name            | Array of all checkpoint model filenames (e.g., SD 1.5, SDXL, Flux, etc.) |
| VAELoader                     | /object_info/VAELoader                       | input.required.vae_name             | Array of all VAE filenames (e.g., vae-ft-mse-840000-ema-pruned.safetensors, sdxl_vae.safetensors) |
| KSampler / KSamplerAdvanced   | /object_info/KSampler                        | input.required.sampler_name         | Array of all available samplers (e.g., euler, dpmpp_2m, lcm, etc.) |
| KSampler                      | /object_info/KSampler                        | input.required.scheduler           | Array of all schedulers (normal, karras, exponential, etc.) |
| CLIPTextEncode (for embeddings) | /object_info/CLIPTextEncode                | (Check for embedding-related if needed) | Embeddings via separate /embeddings endpoint if required |

The structure looks like this (truncated example for checkpoints):
```json
{
  "CheckpointLoaderSimple": {
    "input": {
      "required": {
        "ckpt_name": [
          [
            "model1.safetensors",
            "model2.ckpt",
            "flux1-dev.safetensors",
            // ... all your installed checkpoints
          ],
          {}
        ]
      }
    }
  }
}
```

#### Node.js Example (using fetch)
Here's a quick async function you can drop into your backend to fetch available checkpoints:
```javascript
async function getAvailableCheckpoints(comfyBaseUrl = 'http://127.0.0.1:8188') {
  const response = await fetch(`${comfyBaseUrl}/object_info/CheckpointLoaderSimple`);
  if (!response.ok) throw new Error('ComfyUI not reachable');
  const data = await response.json();
  return data.CheckpointLoaderSimple.input.required.ckpt_name[0];
}

// Usage
getAvailableCheckpoints().then(models => console.log(models));
```

Do the same for VAEs (`VAELoader`), samplers (`KSampler` → `sampler_name`), etc.

### Other Useful API Endpoints
- **GET /embeddings** → Returns a list of textual inversion embedding names.
- **POST /prompt** → Queue a workflow for generation (core for triggering images/videos).
- **GET /history/{prompt_id}** → Poll for results.
- WebSocket at **/ws** → For real-time progress updates (great for UI feedback in RoleForge).

This API approach is lightweight, doesn't require extra wrappers, and works with any OpenAI-compatible setup you're bridging to (though ComfyUI itself handles Stable Diffusion-style generation natively).

If you're running ComfyUI headless or on a separate machine, just ensure the `--listen` flag is set and firewall ports are open. Let me know if you want help wiring this into a full Node.js service for RoleForge!