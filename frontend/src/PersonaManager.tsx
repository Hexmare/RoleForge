import { useState, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';

interface Persona {
  id: number;
  name: string;
  species: string;
  race: string;
  gender: string;
  age: string;
  appearance: {
    height: string;
    weight: string;
    build: string;
    eyeColor: string;
    hairColor: string;
    hairStyle: string;
    attractiveness: string;
    distinctiveFeatures?: string;
  };
  aesthetic: string;
  currentOutfit: string;
  personality: string;
  skills: string;
  powers?: string;
  occupation: string;
  workplace?: string;
  sexualOrientation: string;
  relationshipStatus: string;
  relationshipPartner?: string;
  likes: string;
  turnOns: string;
  dislikes: string;
  turnOffs: string;
  kinks: string;
  backstory?: string;
  scenario?: string;
  description: string;
  avatarUrl?: string;
  extensions?: Record<string, any>;
}

function PersonaManager() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editing, setEditing] = useState<Persona | 'new' | null>(null);
  const [form, setForm] = useState<Partial<Persona>>({});
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [generateName, setGenerateName] = useState('');
  const [generateDescription, setGenerateDescription] = useState('');
  const [generateInstructions, setGenerateInstructions] = useState('');
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copySource, setCopySource] = useState<Persona | null>(null);
  const [copyName, setCopyName] = useState('');
  const [showRegenerateAll, setShowRegenerateAll] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [showFieldRegenDialog, setShowFieldRegenDialog] = useState(false);
  const [regenField, setRegenField] = useState<string | null>(null);
  const [regenInstructions, setRegenInstructions] = useState('');

  async function fetchPersonas() {
    const res = await fetch('/api/personas');
    const data = await res.json();
    setPersonas(data.map((p: any) => ({ ...p.data, id: p.id, avatarUrl: p.avatarUrl })));
  }

  useEffect(() => {
    fetchPersonas();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing && editing !== 'new') {
      await fetch(`/api/personas/${(editing as Persona).id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await fetchPersonas();
    } else {
      // create
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      const newId = data.id;
      // fetch created persona
      const createdRes = await fetch(`/api/personas/${newId}`);
      const created = await createdRes.json();
      await fetchPersonas();
      setEditing(created);
      setForm(created);
      // if an image was selected prior to creation, open cropper to upload it
      if (imageSrc) setShowCropper(true);
    }
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

  const handleGenerate = async () => {
    try {
      const res = await fetch('/api/personas/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: generateName, description: generateDescription, instructions: generateInstructions }),
      });
      if (res.ok) {
        await fetchPersonas();
        setShowGenerateDialog(false);
        setGenerateName('');
        setGenerateDescription('');
        setGenerateInstructions('');
      } else {
        alert('Generate failed');
      }
    } catch (err) {
      alert('Generate error');
    }
  };

  const handleCopy = async () => {
    if (!copySource || !copyName) return;
    try {
      const newPersona = { ...copySource, name: copyName };
      delete newPersona.id; // remove id so new one is assigned
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPersona),
      });
      if (res.ok) {
        await fetchPersonas();
        setShowCopyDialog(false);
        setCopySource(null);
        setCopyName('');
      } else {
        alert('Copy failed');
      }
    } catch (err) {
      alert('Copy error');
    }
  };

  const handleRegenerateAll = async () => {
    if (!editing || editing === 'new') return;
    try {
      const res = await fetch(`/api/personas/${(editing as Persona).id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: regenInstructions, selectedFields }),
      });
      if (res.ok) {
        const updated = await fetch(`/api/personas/${(editing as Persona).id}`).then(r => r.json());
        setEditing(updated);
        setForm(updated);
        await fetchPersonas();
        setShowRegenerateAll(false);
        setSelectedFields([]);
        setRegenInstructions('');
      } else {
        alert('Regenerate failed');
      }
    } catch (err) {
      alert('Regenerate error');
    }
  };

  const handleFieldRegen = async () => {
    if (!editing || editing === 'new' || !regenField) return;
    try {
      const res = await fetch(`/api/personas/${(editing as Persona).id}/field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: regenField, instructions: regenInstructions }),
      });
      if (res.ok) {
        const updated = await fetch(`/api/personas/${(editing as Persona).id}`).then(r => r.json());
        setEditing(updated);
        setForm(updated);
        await fetchPersonas();
        setShowFieldRegenDialog(false);
        setRegenField(null);
        setRegenInstructions('');
      } else {
        alert('Field regenerate failed');
      }
    } catch (err) {
      alert('Field regenerate error');
    }
  };

  const allFields = [
    'name', 'species', 'race', 'gender', 'appearance', 'aesthetic', 'currentOutfit', 'personality', 'skills', 'powers', 'occupation', 'workplace', 'sexualOrientation', 'relationshipStatus', 'relationshipPartner', 'likes', 'turnOns', 'dislikes', 'turnOffs', 'kinks', 'backstory', 'scenario', 'description'
  ];

  return (
    <div className="manager">
      <h2>Persona Manager</h2>
      {editing ? (
        // Edit/Create Form
        <>
          <button onClick={() => { setEditing(null); setForm({}); }}>Back to List</button>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 8 }}>
              <label>Upload Avatar: </label>
              <input type="file" accept="image/*" onChange={onFileChange} />
            </div>
            {editing !== 'new' && (editing as Persona).avatarUrl && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <img src={(editing as Persona).avatarUrl} style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} alt="avatar" />
                <button type="button" onClick={() => removeAvatar((editing as Persona).id)}>Remove Avatar</button>
              </div>
            )}
            {/* Form fields with labels and regen buttons */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Name: The persona's full name</label>
              <input
                type="text"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('name'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Species: The persona's species (e.g., human, elf)</label>
              <input
                type="text"
                value={form.species || ''}
                onChange={(e) => setForm({ ...form, species: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('species'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Race: The persona's race or ethnicity</label>
              <input
                type="text"
                value={form.race || ''}
                onChange={(e) => setForm({ ...form, race: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('race'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Gender: The persona's gender identity</label>
              <input
                type="text"
                value={form.gender || ''}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('gender'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Age: The persona's age or age range</label>
              <input
                type="text"
                value={form.age || ''}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('age'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <fieldset style={{ marginBottom: 8 }}>
              <legend>Appearance: Physical description of the persona</legend>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Height:</label>
                <input
                  type="text"
                  value={form.appearance?.height || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, height: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Weight:</label>
                <input
                  type="text"
                  value={form.appearance?.weight || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, weight: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Build:</label>
                <input
                  type="text"
                  value={form.appearance?.build || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, build: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Eye Color:</label>
                <input
                  type="text"
                  value={form.appearance?.eyeColor || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, eyeColor: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Hair Color:</label>
                <input
                  type="text"
                  value={form.appearance?.hairColor || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, hairColor: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Hair Style:</label>
                <input
                  type="text"
                  value={form.appearance?.hairStyle || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, hairStyle: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Attractiveness:</label>
                <input
                  type="text"
                  value={form.appearance?.attractiveness || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, attractiveness: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Distinctive Features:</label>
                <input
                  type="text"
                  value={form.appearance?.distinctiveFeatures || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, distinctiveFeatures: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Skin Tone:</label>
                <input
                  type="text"
                  value={form.appearance?.skinTone || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, skinTone: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('appearance'); setShowFieldRegenDialog(true); }}>Regenerate Appearance</button>}
            </fieldset>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Aesthetic: Overall style or vibe of the persona</label>
              <input
                type="text"
                value={form.aesthetic || ''}
                onChange={(e) => setForm({ ...form, aesthetic: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('aesthetic'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Current Outfit: What the persona is currently wearing</label>
              <input
                type="text"
                value={form.currentOutfit || ''}
                onChange={(e) => setForm({ ...form, currentOutfit: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('currentOutfit'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Personality: Traits and behavior patterns</label>
              <textarea
                value={form.personality || ''}
                onChange={(e) => setForm({ ...form, personality: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('personality'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Skills: Abilities and competencies</label>
              <textarea
                value={form.skills || ''}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('skills'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Powers: Special abilities or supernatural powers</label>
              <input
                type="text"
                value={form.powers || ''}
                onChange={(e) => setForm({ ...form, powers: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('powers'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Occupation: The persona's job or role</label>
              <input
                type="text"
                value={form.occupation || ''}
                onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('occupation'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Workplace: Where the persona works</label>
              <input
                type="text"
                value={form.workplace || ''}
                onChange={(e) => setForm({ ...form, workplace: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('workplace'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Sexual Orientation: The persona's sexual orientation</label>
              <input
                type="text"
                value={form.sexualOrientation || ''}
                onChange={(e) => setForm({ ...form, sexualOrientation: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('sexualOrientation'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Relationship Status: Current relationship status</label>
              <input
                type="text"
                value={form.relationshipStatus || ''}
                onChange={(e) => setForm({ ...form, relationshipStatus: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('relationshipStatus'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Relationship Partner: Name of partner if applicable</label>
              <input
                type="text"
                value={form.relationshipPartner || ''}
                onChange={(e) => setForm({ ...form, relationshipPartner: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('relationshipPartner'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Likes: Things the persona enjoys</label>
              <textarea
                value={form.likes || ''}
                onChange={(e) => setForm({ ...form, likes: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('likes'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Turn Ons: What arouses the persona</label>
              <textarea
                value={form.turnOns || ''}
                onChange={(e) => setForm({ ...form, turnOns: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('turnOns'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Dislikes: Things the persona dislikes</label>
              <textarea
                value={form.dislikes || ''}
                onChange={(e) => setForm({ ...form, dislikes: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('dislikes'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Turn Offs: What repels the persona</label>
              <textarea
                value={form.turnOffs || ''}
                onChange={(e) => setForm({ ...form, turnOffs: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('turnOffs'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Kinks: Sexual preferences and fetishes</label>
              <textarea
                value={form.kinks || ''}
                onChange={(e) => setForm({ ...form, kinks: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('kinks'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Backstory: The persona's history and background</label>
              <textarea
                value={form.backstory || ''}
                onChange={(e) => setForm({ ...form, backstory: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('backstory'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Scenario: Initial scenario or setting for the persona</label>
              <textarea
                value={form.scenario || ''}
                onChange={(e) => setForm({ ...form, scenario: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('scenario'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Description: A summary description of the persona</label>
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('description'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ marginTop: 16 }}>
              {editing !== 'new' && <button type="button" onClick={() => setShowRegenerateAll(true)}>Regenerate All</button>}
              <button type="submit">{editing === 'new' ? 'Create' : 'Update'}</button>
              {editing !== 'new' && <button type="button" onClick={() => { setEditing(null); setForm({}); }}>Cancel</button>}
            </div>
          </form>
        </>
      ) : (
        // List View
        <>
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => { setEditing('new'); setForm({}); }}>New Persona</button>
            <button onClick={() => setShowGenerateDialog(true)}>Generate Persona</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {personas.map((p) => (
              <div key={p.id} style={{ border: '1px solid #ccc', padding: 16, borderRadius: 8 }}>
                <img src={p.avatarUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiNFNUU1RTUiLz4KPHBhdGggZD0iTTMyIDI0QzM1LjMxMzcgMjQgMzggMjcuMzEzNyAzOCAzMUMzOCAzNC42ODYzIDM1LjMxMzcgMzggMzIgMzhDMjguNjg2MyAzOCAyNiAzNC42ODYzIDI2IDMxQzI2IDI3LjMxMzcgMjguNjg2MyAyNCAzMiAyNFoiIGZpbGw9IiM5Q0E0QUYiLz4KPHBhdGggZD0iTTQ2IDUwSDR2LTJDNDYgNDYuODg2MyA0My4xMTM3IDQ0IDQwIDQ0SDR2NnoiIGZpbGw9IiM5Q0E0QUYiLz4KPC9zdmc+'} style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', marginBottom: 8 }} alt="avatar" />
                <h3>{p.name}</h3>
                <p>{p.description || 'No description'}</p>
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => handleEdit(p)}>Edit</button>
                  <button onClick={() => { setCopySource(p); setShowCopyDialog(true); }}>Copy</button>
                  <button onClick={() => handleDelete(p.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
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
      {showGenerateDialog && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 500 }}>
            <h3>Generate New Persona</h3>
            <input
              type="text"
              placeholder="Name"
              value={generateName}
              onChange={(e) => setGenerateName(e.target.value)}
              style={{ width: '100%', marginBottom: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <textarea
              placeholder="Description"
              value={generateDescription}
              onChange={(e) => setGenerateDescription(e.target.value)}
              rows={3}
              style={{ width: '100%', marginBottom: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <textarea
              placeholder="Instructions for generation"
              value={generateInstructions}
              onChange={(e) => setGenerateInstructions(e.target.value)}
              rows={4}
              style={{ width: '100%', marginBottom: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowGenerateDialog(false)}>Cancel</button>
              <button onClick={() => { setGenerateName(''); setGenerateDescription(''); setGenerateInstructions(''); }}>Reset Fields</button>
              <button onClick={handleGenerate}>Generate</button>
            </div>
          </div>
        </div>
      )}
      {showCopyDialog && copySource && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <h3>Copy Persona</h3>
            <p>Copying: {copySource.name}</p>
            <input
              type="text"
              placeholder="New Name"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              style={{ width: '100%', marginBottom: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowCopyDialog(false); setCopySource(null); setCopyName(''); }}>Cancel</button>
              <button onClick={() => setCopyName('')}>Reset Fields</button>
              <button onClick={handleCopy}>Copy</button>
            </div>
          </div>
        </div>
      )}
      {showRegenerateAll && editing !== 'new' && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 600 }}>
            <h3>Regenerate All Fields</h3>
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => setSelectedFields(allFields)}>Check All</button>
              <button onClick={() => setSelectedFields([])}>Uncheck All</button>
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10 }}>
              {allFields.map(field => (
                <label key={field} style={{ display: 'block', color: '#e6eef2' }}>
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(field)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFields([...selectedFields, field]);
                      } else {
                        setSelectedFields(selectedFields.filter(f => f !== field));
                      }
                    }}
                    style={{ marginRight: 8 }}
                  />
                  {field}
                </label>
              ))}
            </div>
            <textarea
              placeholder="Instructions for regeneration"
              value={regenInstructions}
              onChange={(e) => setRegenInstructions(e.target.value)}
              rows={4}
              style={{ width: '100%', marginBottom: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowRegenerateAll(false); setSelectedFields([]); setRegenInstructions(''); }}>Cancel</button>
              <button onClick={() => { setSelectedFields([]); setRegenInstructions(''); }}>Reset Fields</button>
              <button onClick={handleRegenerateAll}>Proceed</button>
            </div>
          </div>
        </div>
      )}
      {showFieldRegenDialog && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 500 }}>
            <h3>Regenerate Field: {regenField}</h3>
            <textarea
              placeholder="Instructions for regeneration"
              value={regenInstructions}
              onChange={(e) => setRegenInstructions(e.target.value)}
              rows={4}
              style={{ width: '100%', marginBottom: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowFieldRegenDialog(false); setRegenField(null); setRegenInstructions(''); }}>Cancel</button>
              <button onClick={() => setRegenInstructions('')}>Reset Fields</button>
              <button onClick={handleFieldRegen}>Regenerate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PersonaManager;