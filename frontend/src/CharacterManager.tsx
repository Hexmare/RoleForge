import { useState, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';

interface Character {
  id: number;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, any>;
  character_book: any;
  avatarUrl?: string;
}

function CharacterManager({ onRefresh }: { onRefresh: () => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState<Character | null>(null);
  const [form, setForm] = useState<Partial<Character>>({});
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [showCropper, setShowCropper] = useState(false);

  async function fetchCharacters() {
    const res = await fetch('/api/characters');
    const data = await res.json();
    setCharacters(data);
  }

  useEffect(() => {
    fetchCharacters();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      await fetch(`/api/characters/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await fetchCharacters();
      onRefresh();
      setEditing(null);
      setForm({});
    } else {
      // create then, if an image is pending, open cropper for the new character
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      const newId = data.id;
      // fetch created character
      const createdRes = await fetch(`/api/characters/${newId}`);
      const created = await createdRes.json();
      await fetchCharacters();
      onRefresh();
      setEditing(created);
      setForm(created);
      // if an image was selected prior to creation, open cropper to upload it
      if (imageSrc) setShowCropper(true);
    }
  };

  const handleEdit = (char: Character) => {
    setEditing(char);
    setForm(char);
  };

  const removeAvatar = async (id: number) => {
    const res = await fetch(`/api/characters/${id}/avatar`, { method: 'DELETE' });
    if (res.ok) {
      fetchCharacters();
      onRefresh();
      alert('Avatar removed');
    } else {
      alert('Failed to remove avatar');
    }
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/characters/${id}`, { method: 'DELETE' });
    fetchCharacters();
    onRefresh();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          // Assume it's a single character or array
          const chars = Array.isArray(data) ? data : [data];
          for (const char of chars) {
            await fetch('/api/characters', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(char),
            });
          }
          fetchCharacters();
          onRefresh();
        } catch (err) {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      // only open cropper immediately if editing an existing character
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
    if (!editing) return alert('Select or create a character first');
    if (!imageSrc || !croppedAreaPixels) return alert('No crop data');
    const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
    if (!blob) return alert('Failed to crop image');
    const formData = new FormData();
    formData.append('avatar', blob, `avatar-${editing.id}.png`);
    const res = await fetch(`/api/characters/${editing.id}/avatar`, { method: 'POST', body: formData });
    if (res.ok) {
      setShowCropper(false);
      setImageSrc(null);
      fetchCharacters();
      onRefresh();
      alert('Avatar uploaded');
    } else {
      alert('Upload failed');
    }
  };

  return (
    <div className="manager">
      <h2>Character Manager</h2>
      <input type="file" accept=".json" onChange={handleImport} />
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
          placeholder="Personality"
          value={form.personality || ''}
          onChange={(e) => setForm({ ...form, personality: e.target.value })}
        />
        <textarea
          placeholder="Scenario"
          value={form.scenario || ''}
          onChange={(e) => setForm({ ...form, scenario: e.target.value })}
        />
        <textarea
          placeholder="First Message"
          value={form.first_mes || ''}
          onChange={(e) => setForm({ ...form, first_mes: e.target.value })}
        />
        <button type="submit">{editing ? 'Update' : 'Create'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm({}); }}>Cancel</button>}
      </form>
      {showCropper && imageSrc && (
        <div className="modal-overlay" onClick={() => setShowCropper(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720, height: 520 }}>
            <h3>Crop Avatar</h3>
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
        {characters.map((char) => (
          <li key={char.id}>
            {char.name}
            <button onClick={() => handleEdit(char)}>Edit</button>
            <button onClick={() => handleDelete(char.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CharacterManager;