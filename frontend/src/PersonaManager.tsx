import { useState, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';

interface Persona {
  // Core Fields (identity)
  id: number;
  name: string;
  species: string;
  race: string;
  gender: string;
  description: string;  // Short bio (merged backstory/scenario)

  // Appearance & Style (consolidated)
  appearance: {
    physical?: string;   // e.g., "tall, athletic build"
    aesthetic?: string;  // e.g., "gothic, mysterious"
  };
  currentOutfit: string;  // Initial clothing; updates via state

  // Personality & Traits (merged)
  personality: string;    // Brief overview
  traits: {
    likes?: string[];     // Merged likes/turn-ons
    dislikes?: string[];  // Merged dislikes/turn-offs
    kinks?: string[];     // Sexual preferences
  };

  // Abilities & Role (merged)
  abilities: string[];    // Combined skills/powers
  occupation: string;     // Include workplace if relevant

  // Relationships (consolidated)
  sexualOrientation: string;
  relationshipStatus: string;  // e.g., "single" or "partnered with [name]"

  // Optional/Extension
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
  const [newLike, setNewLike] = useState('');
  const [newDislike, setNewDislike] = useState('');
  const [newKink, setNewKink] = useState('');
  const [newAbility, setNewAbility] = useState('');

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
    'name', 'species', 'race', 'gender', 'description', 'appearance', 'currentOutfit', 'personality', 'abilities', 'occupation', 'sexualOrientation', 'relationshipStatus', 'likes', 'dislikes', 'kinks'
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
              <label style={{ flex: 1 }}>Description: Short bio or summary of the persona</label>
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('description'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <fieldset style={{ marginBottom: 8 }}>
              <legend>Appearance: Physical description and style</legend>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Physical: e.g., "tall, athletic build"</label>
                <textarea
                  value={form.appearance?.physical || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, physical: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ flex: 1 }}>Aesthetic: e.g., "gothic, mysterious"</label>
                <textarea
                  value={form.appearance?.aesthetic || ''}
                  onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, aesthetic: e.target.value } })}
                  style={{ flex: 2 }}
                />
              </div>
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('appearance'); setShowFieldRegenDialog(true); }}>Regenerate Appearance</button>}
            </fieldset>
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
            <fieldset style={{ marginBottom: 8 }}>
              <legend>Abilities: Combined skills, powers, and competencies</legend>
              {(form.abilities || []).map((ability, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                  <input
                    type="text"
                    value={ability}
                    onChange={(e) => {
                      const newAbilities = [...(form.abilities || [])];
                      newAbilities[index] = e.target.value;
                      setForm({ ...form, abilities: newAbilities });
                    }}
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={() => {
                    const newAbilities = [...(form.abilities || [])];
                    newAbilities.splice(index, 1);
                    setForm({ ...form, abilities: newAbilities });
                  }}>Remove</button>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                <input
                  type="text"
                  value={newAbility}
                  onChange={(e) => setNewAbility(e.target.value)}
                  placeholder="Enter ability"
                  style={{ flex: 1, marginRight: 8 }}
                />
                <button type="button" onClick={() => {
                  if (newAbility.trim()) {
                    const newAbilities = [...(form.abilities || []), newAbility.trim()];
                    setForm({ ...form, abilities: newAbilities });
                    setNewAbility('');
                  }
                }}>Add</button>
                {editing !== 'new' && <button type="button" onClick={() => { setRegenField('abilities'); setShowFieldRegenDialog(true); }}>Generate</button>}
              </div>
            </fieldset>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Occupation: The persona's job or role (include workplace if relevant)</label>
              <input
                type="text"
                value={form.occupation || ''}
                onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('occupation'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
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
              <label style={{ flex: 1 }}>Relationship Status: e.g., "single" or "partnered with [name]"</label>
              <input
                type="text"
                value={form.relationshipStatus || ''}
                onChange={(e) => setForm({ ...form, relationshipStatus: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('relationshipStatus'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <fieldset style={{ marginBottom: 8 }}>
              <legend>Traits: Personality traits and preferences</legend>
              <fieldset style={{ marginBottom: 8 }}>
                <legend>Likes: Things the persona enjoys (merged likes/turn-ons)</legend>
                {((form.traits?.likes || []) as string[]).map((like, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <input
                      type="text"
                      value={like}
                      onChange={(e) => {
                        const currentTraits = form.traits || {};
                        const newLikes = [...(currentTraits.likes || [])];
                        newLikes[index] = e.target.value;
                        setForm({ ...form, traits: { ...currentTraits, likes: newLikes } });
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => {
                      const currentTraits = form.traits || {};
                      const newLikes = [...(currentTraits.likes || [])];
                      newLikes.splice(index, 1);
                      setForm({ ...form, traits: { ...currentTraits, likes: newLikes } });
                    }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    value={newLike}
                    onChange={(e) => setNewLike(e.target.value)}
                    placeholder="Enter like"
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <button type="button" onClick={() => {
                    if (newLike.trim()) {
                      const currentTraits = form.traits || {};
                      const newLikes = [...(currentTraits.likes || []), newLike.trim()];
                      setForm({ ...form, traits: { ...currentTraits, likes: newLikes } });
                      setNewLike('');
                    }
                  }}>Add</button>
                  {editing !== 'new' && <button type="button" onClick={() => { setRegenField('likes'); setShowFieldRegenDialog(true); }}>Generate</button>}
                </div>
              </fieldset>
              <fieldset style={{ marginBottom: 8 }}>
                <legend>Dislikes: Things the persona dislikes (merged dislikes/turn-offs)</legend>
                {((form.traits?.dislikes || []) as string[]).map((dislike, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <input
                      type="text"
                      value={dislike}
                      onChange={(e) => {
                        const currentTraits = form.traits || {};
                        const newDislikes = [...(currentTraits.dislikes || [])];
                        newDislikes[index] = e.target.value;
                        setForm({ ...form, traits: { ...currentTraits, dislikes: newDislikes } });
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => {
                      const currentTraits = form.traits || {};
                      const newDislikes = [...(currentTraits.dislikes || [])];
                      newDislikes.splice(index, 1);
                      setForm({ ...form, traits: { ...currentTraits, dislikes: newDislikes } });
                    }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    value={newDislike}
                    onChange={(e) => setNewDislike(e.target.value)}
                    placeholder="Enter dislike"
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <button type="button" onClick={() => {
                    if (newDislike.trim()) {
                      const currentTraits = form.traits || {};
                      const newDislikes = [...(currentTraits.dislikes || []), newDislike.trim()];
                      setForm({ ...form, traits: { ...currentTraits, dislikes: newDislikes } });
                      setNewDislike('');
                    }
                  }}>Add</button>
                  {editing !== 'new' && <button type="button" onClick={() => { setRegenField('dislikes'); setShowFieldRegenDialog(true); }}>Generate</button>}
                </div>
              </fieldset>
              <fieldset style={{ marginBottom: 8 }}>
                <legend>Kinks: Sexual preferences and fetishes</legend>
                {((form.traits?.kinks || []) as string[]).map((kink, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <input
                      type="text"
                      value={kink}
                      onChange={(e) => {
                        const currentTraits = form.traits || {};
                        const newKinks = [...(currentTraits.kinks || [])];
                        newKinks[index] = e.target.value;
                        setForm({ ...form, traits: { ...currentTraits, kinks: newKinks } });
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => {
                      const currentTraits = form.traits || {};
                      const newKinks = [...(currentTraits.kinks || [])];
                      newKinks.splice(index, 1);
                      setForm({ ...form, traits: { ...currentTraits, kinks: newKinks } });
                    }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    value={newKink}
                    onChange={(e) => setNewKink(e.target.value)}
                    placeholder="Enter kink"
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <button type="button" onClick={() => {
                    if (newKink.trim()) {
                      const currentTraits = form.traits || {};
                      const newKinks = [...(currentTraits.kinks || []), newKink.trim()];
                      setForm({ ...form, traits: { ...currentTraits, kinks: newKinks } });
                      setNewKink('');
                    }
                  }}>Add</button>
                  {editing !== 'new' && <button type="button" onClick={() => { setRegenField('kinks'); setShowFieldRegenDialog(true); }}>Generate</button>}
                </div>
              </fieldset>
            </fieldset>
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