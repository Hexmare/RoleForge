import React, { useEffect, useState } from 'react';

type Props = { visible: boolean; onClose: () => void; isModal?: boolean };

const pow2Options = (() => {
  const res: number[] = [];
  for (let v = 64; v <= 2048; v *= 2) res.push(v);
  // include intermediate powers (128,256,512,1024,2048) already included
  return res;
})();

export default function ComfyConfigModal({ visible, onClose, isModal = true }: Props) {
  const [endpoint, setEndpoint] = useState<string>('http://192.168.88.135:8188');
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [vaes, setVaes] = useState<string[]>([]);
  const [samplers, setSamplers] = useState<string[]>([]);
  const [schedulers, setSchedulers] = useState<string[]>([]);

  // sliders / fields
  const [steps, setSteps] = useState<number>(20);
  const [height, setHeight] = useState<number>(512);
  const [width, setWidth] = useState<number>(512);
  const [clipSkip, setClipSkip] = useState<number>(1);
  const [denoise, setDenoise] = useState<number>(1);
  const [cfgScale, setCfgScale] = useState<number>(8);
  const [seed, setSeed] = useState<number>(-1);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedVae, setSelectedVae] = useState<string | null>(null);
  const [selectedSampler, setSelectedSampler] = useState<string | null>(null);
  const [selectedScheduler, setSelectedScheduler] = useState<string | null>(null);
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [positivePrompt, setPositivePrompt] = useState<string>('');
  const [comfyStatus, setComfyStatus] = useState<string | null>(null);
  const [lastCounts, setLastCounts] = useState<{ models?: number; vaes?: number; samplers?: number; schedulers?: number } | null>(null);

  const refreshComfyLists = async (ep?: string | any) => {
    const useEp = (typeof ep === 'string') ? ep : endpoint;
    setComfyStatus('Querying ComfyUI...');
    try {
      const res = await fetch('/api/comfyui/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: useEp }) });
      if (res.ok) {
        const data = await res.json();
        console.debug('ComfyUI list response', data);
        setModels((data.models || []).map((m: any) => (typeof m === 'object' && m.name) ? m.name : String(m)));
        setVaes((data.vaes || []).map((v: any) => (typeof v === 'object' && v.name) ? v.name : String(v)));
        setSamplers((data.samplers || []).map((s: any) => String(s)));
        setSchedulers((data.schedulers || []).map((s: any) => String(s)));
        if (!selectedModel && data.models && data.models.length) setSelectedModel(data.models[0].name || data.models[0]);
        if (!selectedVae && data.vaes && data.vaes.length) setSelectedVae(data.vaes[0].name || data.vaes[0]);
        if (!selectedSampler && data.samplers && data.samplers.length) setSelectedSampler(data.samplers[0]);
        if (!selectedScheduler && data.schedulers && data.schedulers.length) setSelectedScheduler(data.schedulers[0]);
        setLastCounts({ models: (data.models || []).length, vaes: (data.vaes || []).length, samplers: (data.samplers || []).length, schedulers: (data.schedulers || []).length });
        setComfyStatus('OK');
      } else {
        const text = await res.text();
        setComfyStatus(`Error: ${res.status} ${text}`);
      }
    } catch (e: any) {
      console.warn('Failed to query ComfyUI', e);
      setComfyStatus(`Failed: ${e?.message || e}`);
    }
  };

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const res = await fetch('/api/workflows');
        if (res.ok) {
          const data = await res.json();
          setWorkflows(data || []);
          if (data && data.length) setSelectedWorkflow(data[0]);
        }
        const cfgRes = await fetch('/api/settings/comfyui');
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg) {
            const ep = cfg.endpoint || cfg.url || endpoint;
            setEndpoint(ep);
            setSelectedWorkflow(cfg.workflow || selectedWorkflow);
            setSelectedModel(cfg.model || selectedModel);
            setSelectedVae(cfg.vae || selectedVae);
            setSelectedSampler(cfg.sampler || selectedSampler);
            setSelectedScheduler(cfg.scheduler || selectedScheduler);
            setSteps(cfg.steps ?? steps);
            setHeight(cfg.height ?? height);
            setWidth(cfg.width ?? width);
            setClipSkip(cfg.clip_skip ?? clipSkip);
            setDenoise(cfg.denoise ?? denoise);
            setCfgScale(cfg.cfg_scale ?? cfgScale);
            setSeed(cfg.seed ?? seed);
            setNegativePrompt(cfg.negative_prompt || negativePrompt);
            setPositivePrompt(cfg.positive_prompt || positivePrompt);
            // auto-refresh lists now that endpoint is set
            await refreshComfyLists(ep);
          }
        }
      } catch (e) {
        console.warn('Failed to load workflows or comfy settings', e);
      }
    })();
  }, [visible]);

  

  const saveSettings = async () => {
    const payload: any = {
      endpoint,
      workflow: selectedWorkflow,
      model: selectedModel,
      vae: selectedVae,
      sampler: selectedSampler,
      scheduler: selectedScheduler,
      steps,
      height,
      width,
      clip_skip: clipSkip,
      denoise,
      cfg_scale: cfgScale,
      seed,
        negative_prompt: negativePrompt,
        positive_prompt: positivePrompt
    };
    try {
      await fetch('/api/settings/comfyui', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      onClose();
    } catch (e) {
      console.warn('Failed to save comfy settings', e);
    }
  };

  if (!visible) return null;

  const content = (
    <div className={isModal ? "modal comfy-modal" : "comfy-full"}>
      <h3>ComfyUI Configuration</h3>
      <div className="modal-row">
        <label>ComfyUI URL</label>
        <input value={endpoint} onChange={e => setEndpoint(e.target.value)} style={{ width: '100%' }} />
      </div>

      <div className="modal-row" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label>Workflow (from backend/workflows)</label>
          <select value={selectedWorkflow || ''} onChange={e => setSelectedWorkflow(e.target.value)} style={{ width: '100%' }}>
            {workflows.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button onClick={() => refreshComfyLists()}>Refresh from ComfyUI</button>
          <div style={{ marginLeft: 8, color: '#9fb' }}>{comfyStatus ? comfyStatus : ''}</div>
        </div>
      </div>

      <div className="modal-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label>Model</label>
          <select value={selectedModel || ''} onChange={e => setSelectedModel(e.target.value)} style={{ width: '100%' }}>
            {(models.length ? models : ['(none)']).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>VAE</label>
          <select value={selectedVae || ''} onChange={e => setSelectedVae(e.target.value)} style={{ width: '100%' }}>
            {(vaes.length ? vaes : ['(none)']).map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label>Sampler</label>
          <select value={selectedSampler || ''} onChange={e => setSelectedSampler(e.target.value)} style={{ width: '100%' }}>
            {(samplers.length ? samplers : ['euler']).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label>Scheduler</label>
          <select value={selectedScheduler || ''} onChange={e => setSelectedScheduler(e.target.value)} style={{ width: '100%' }}>
            {(schedulers.length ? schedulers : ['normal']).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="modal-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label>Steps: {steps}</label>
          <input type="range" min={1} max={40} value={steps} onChange={e => setSteps(Number(e.target.value))} />
          <input value={steps} onChange={e => setSteps(Number(e.target.value||0))} style={{ width: 80 }} />
        </div>
        <div>
          <label>Seed: {seed}</label>
          <input value={seed} onChange={e => setSeed(Number(e.target.value||-1))} style={{ width: '100%' }} />
        </div>
        <div>
          <label>Width: {width}</label>
          <input type="range" min={64} max={2048} step={64} value={width} onChange={e => setWidth(Number(e.target.value))} />
          <input value={width} onChange={e => setWidth(Number(e.target.value||512))} style={{ width: 80 }} />
        </div>
        <div>
          <label>Height: {height}</label>
          <input type="range" min={64} max={2048} step={64} value={height} onChange={e => setHeight(Number(e.target.value))} />
          <input value={height} onChange={e => setHeight(Number(e.target.value||512))} style={{ width: 80 }} />
        </div>
      </div>

      <div className="modal-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <label>Clip skip: {clipSkip}</label>
          <input type="range" min={1} max={12} value={clipSkip} onChange={e => setClipSkip(Number(e.target.value))} />
          <input value={clipSkip} onChange={e => setClipSkip(Number(e.target.value||1))} style={{ width: 80 }} />
        </div>
        <div>
          <label>Denoise: {denoise}</label>
          <input type="range" min={0} max={1} step={0.01} value={denoise} onChange={e => setDenoise(Number(e.target.value))} />
          <input value={denoise} onChange={e => setDenoise(Number(e.target.value||1))} style={{ width: 80 }} />
        </div>
        <div>
          <label>CFG Scale: {cfgScale}</label>
          <input type="range" min={1} max={20} step={0.1} value={cfgScale} onChange={e => setCfgScale(Number(e.target.value))} />
          <input value={cfgScale} onChange={e => setCfgScale(Number(e.target.value||8))} style={{ width: 80 }} />
        </div>
      </div>

      <div className="modal-row">
        <label>Positive prompt (AI prompt will be appended)</label>
        <input value={positivePrompt} onChange={e => setPositivePrompt(e.target.value)} style={{ width: '100%' }} />
      </div>

      <div className="modal-row">
        <label>Negative prompt</label>
        <input value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} style={{ width: '100%' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={onClose}>{isModal ? 'Cancel' : 'Back to Chat'}</button>
        <button onClick={saveSettings}>Save</button>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="modal-backdrop">
        {content}
      </div>
    );
  } else {
    return content;
  }
}
