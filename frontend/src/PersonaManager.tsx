import { useState, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';

interface Persona {
  id: number;
  name: string;
  description: string;
  details: Record<string, any>;
  avatarUrl?: string;
}

function PersonaManager() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [form, setForm] = useState<Partial<Persona>>({});
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [showCropper, setShowCropper] = useState(false);

  async function fetchPersonas() {
    const res = await fetch('/api/personas');
    const data = await res.json();
    setPersonas(data);
  }

  useEffect(() => {
    fetchPersonas();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      await fetch(`/api/personas/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }
    fetchPersonas();
    setEditing(null);
    setForm({});
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      if (editing) setShowCropper(true);
    };
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_: any, croppedAreaPixelsParam: any) => {
    setCroppedAreaPixels(croppedAreaPixelsParam);
  }, []);

  const getCroppedImg = async (imageSrc: string, pixelCrop: any) => {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.src = imageSrc;
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
    const canvas = document.createElement('canvas');
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  };

  const applyCropAndUpload = async () => {
    if (!editing) return alert('Select or create a persona first');
    if (!imageSrc || !croppedAreaPixels) return alert('No crop data');
    const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
    if (!blob) return alert('Failed to crop image');
    const formData = new FormData();
    formData.append('avatar', blob, `avatar-persona-${editing.id}.png`);
    const res = await fetch(`/api/personas/${editing.id}/avatar`, { method: 'POST', body: formData });
    if (res.ok) {
      setShowCropper(false);
      setImageSrc(null);
      fetchPersonas();
      alert('Avatar uploaded');
    } else {
      alert('Upload failed');
    }
  };

  const removeAvatar = async (id: number) => {
    const res = await fetch(`/api/personas/${id}/avatar`, { method: 'DELETE' });
    if (res.ok) { fetchPersonas(); alert('Avatar removed'); } else { alert('Failed to remove avatar'); }
  };

  const handleEdit = (p: Persona) => {
    setEditing(p);
    setForm(p);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/personas/${id}`, { method: 'DELETE' });
    fetchPersonas();
  };

  return (
    <div className="manager">
      <h2>Persona Manager</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8 }}>
          <label>Upload Avatar: </label>
          <input type="file" accept="image/*" onChange={onFileChange} />
        </div>
        {editing && editing.avatarUrl && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <img src={editing.avatarUrl} style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} alt="avatar" />
            <button type="button" onClick={() => removeAvatar(editing.id)}>Remove Avatar</button>
          </div>
        )}

        <input
          type="text"
          placeholder="Name"
          value={form.name || ''}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <textarea
          placeholder="Description"
          value={form.description || ''}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <textarea
          placeholder="Details (JSON)"
          value={JSON.stringify(form.details || {}, null, 2)}
          onChange={(e) => {
            try {
              setForm({ ...form, details: JSON.parse(e.target.value) });
            } catch {}
          }}
        />
        <button type="submit">{editing ? 'Update' : 'Create'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm({}); }}>Cancel</button>}
      </form>
      {showCropper && imageSrc && (
        <div className="modal-overlay" onClick={() => setShowCropper(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720, height: 520 }}>
            <h3>Crop Persona Avatar</h3>
            <div style={{ position: 'relative', width: '100%', height: 400, background: '#333' }}>
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={() => setShowCropper(false)}>Cancel</button>
              <button onClick={applyCropAndUpload}>Apply & Upload</button>
            </div>
          </div>
        </div>
      )}
      <ul>
        {personas.map((p) => (
          <li key={p.id}>
            {p.name}
            <button onClick={() => handleEdit(p)}>Edit</button>
            <button onClick={() => handleDelete(p.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PersonaManager;