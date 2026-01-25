import { useState, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';

// UUID v4 generation function
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

interface Character {
  // Core Fields (identity)
  id: string;
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
    secrets?: string[];   // Hidden information
    goals?: string[];     // Objectives/motivations
  };

  // Abilities & Role (merged)
  abilities: string[];    // Combined skills/powers
  occupation: string;     // Include workplace if relevant

  // Relationships (consolidated)
  sexualOrientation: string;
  relationshipStatus: string;  // e.g., "single" or "partnered with [name]"

  // Optional/Extension
  avatar?: string;
  avatarUrl?: string;
  extensions?: Record<string, any>;
}

function CharacterManager({ onRefresh }: { onRefresh: () => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState<Character | 'new' | null>(null);
  const [form, setForm] = useState<Partial<Character>>({});
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [importCard, setImportCard] = useState<any>(null);
  const [importDirections, setImportDirections] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [generateName, setGenerateName] = useState('');
  const [generateDescription, setGenerateDescription] = useState('');
  const [generateInstructions, setGenerateInstructions] = useState('');
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copySource, setCopySource] = useState<Character | null>(null);
  const [copyName, setCopyName] = useState('');
  const [showRegenerateAll, setShowRegenerateAll] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [showFieldRegenDialog, setShowFieldRegenDialog] = useState(false);
  const [regenField, setRegenField] = useState<string | null>(null);
  const [regenInstructions, setRegenInstructions] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [newLike, setNewLike] = useState('');
  const [newDislike, setNewDislike] = useState('');
  const [newKink, setNewKink] = useState('');
  const [newAbility, setNewAbility] = useState('');

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
    if (editing && editing !== 'new') {
      await fetch(`/api/characters/${(editing as Character).id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await fetchCharacters();
      onRefresh();
      setEditing(null);
      setForm({});
    } else {
      // create - add UUID for new character
      const newCharData = {
        ...form,
        id: generateUUID()
      };
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCharData),
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
    setNewSecret('');
    setNewGoal('');
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
          // Assume it's a single character
          setImportCard(data);
          setImportDirections('');
          setShowImportModal(true);
        } catch (err) {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleApplyImport = async () => {
    if (!importCard) return;
    try {
      const res = await fetch('/api/characters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: importCard.name || 'Imported Character', 
          description: JSON.stringify(importCard), 
          instructions: importDirections 
        }),
      });
      if (res.ok) {
        fetchCharacters();
        onRefresh();
        setShowImportModal(false);
        setImportCard(null);
        setImportDirections('');
      } else {
        alert('Import failed');
      }
    } catch (err) {
      alert('Import error');
    }
  };

  const handleCancelImport = () => {
    setShowImportModal(false);
    setImportCard(null);
    setImportDirections('');
  };

  const handleGenerate = async () => {
    try {
      const res = await fetch('/api/characters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: generateName, description: generateDescription, instructions: generateInstructions }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchCharacters();
        onRefresh();
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
      const newChar = { ...copySource, name: copyName, id: generateUUID() };
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newChar),
      });
      if (res.ok) {
        await fetchCharacters();
        onRefresh();
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
      const res = await fetch(`/api/characters/${(editing as Character).id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: regenInstructions, selectedFields }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = await fetch(`/api/characters/${data.id}`).then(r => r.json());
        setEditing(updated);
        setForm(updated);
        await fetchCharacters();
        onRefresh();
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
      const res = await fetch(`/api/characters/${(editing as Character).id}/field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: regenField, instructions: regenInstructions }),
      });
      if (res.ok) {
        const data = await res.json();
        const generatedValue = data.value;
        
        // Update local form state
        if (regenField === 'secrets' || regenField === 'goals' || regenField === 'likes' || regenField === 'dislikes' || regenField === 'kinks') {
          // For trait array fields, add the generated value to the array within traits
          const currentTraits = form.traits || {};
          const currentArray = currentTraits[regenField] || [];
          setForm({ ...form, traits: { ...currentTraits, [regenField]: [...currentArray, generatedValue] } });
        } else if (regenField === 'abilities') {
          // For abilities array
          const currentArray = form.abilities || [];
          setForm({ ...form, abilities: [...currentArray, generatedValue] });
        } else {
          // For other fields, replace the value
          setForm({ ...form, [regenField]: generatedValue });
        }
        
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
    'name', 'species', 'race', 'gender', 'description', 'appearance', 'currentOutfit', 'personality', 'abilities', 'occupation', 'sexualOrientation', 'relationshipStatus', 'traits'
  ];

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
      await fetchCharacters();
      if (editing) {
        const updatedRes = await fetch(`/api/characters/${(editing as Character).id}`);
        const updated = await updatedRes.json();
        setEditing(updated);
        setForm(updated);
      }
      onRefresh();
      alert('Avatar uploaded');
    } else {
      alert('Upload failed');
    }
  };

  const handleRemoveAvatar = async (id: string) => {
    await fetch(`/api/characters/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarUrl: null }),
    });
    fetchCharacters();
    onRefresh();
  };

  return (
    <div className="manager">
      <h2>Character Manager</h2>
      {editing ? (
        // Edit/Create Form
        <>
          <button onClick={() => { setEditing(null); setForm({}); setNewSecret(''); setNewGoal(''); }}>Back to List</button>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 8 }}>
              <label>Upload Avatar: </label>
              <input type="file" accept="image/*" onChange={onFileChange} />
            </div>
            {editing !== 'new' && ((editing as Character).avatar || (editing as Character).avatarUrl) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <img src={(editing as Character).avatar || (editing as Character).avatarUrl} style={{ width: 64, height: 64, border: '1px solid black' }} alt="avatar" />
                <button type="button" onClick={() => handleRemoveAvatar((editing as Character).id)}>Remove Avatar</button>
              </div>
            )}
            {/* Form fields with labels and regen buttons */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Name: The character's full name</label>
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
              <label style={{ flex: 1 }}>Species: The character's species (e.g., human, elf)</label>
              <input
                type="text"
                value={form.species || ''}
                onChange={(e) => setForm({ ...form, species: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('species'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Race: The character's race or ethnicity</label>
              <input
                type="text"
                value={form.race || ''}
                onChange={(e) => setForm({ ...form, race: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('race'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Gender: The character's gender identity</label>
              <input
                type="text"
                value={form.gender || ''}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('gender'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Description: Short bio or summary of the character</label>
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
              <label style={{ flex: 1 }}>Current Outfit: What the character is currently wearing</label>
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
              <label style={{ flex: 1 }}>Occupation: The character's job or role (include workplace if relevant)</label>
              <input
                type="text"
                value={form.occupation || ''}
                onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                style={{ flex: 2 }}
              />
              {editing !== 'new' && <button type="button" onClick={() => { setRegenField('occupation'); setShowFieldRegenDialog(true); }}>Regenerate</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>Sexual Orientation: The character's sexual orientation</label>
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
                <legend>Likes: Things the character enjoys (merged likes/turn-ons)</legend>
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
                <legend>Dislikes: Things the character dislikes (merged dislikes/turn-offs)</legend>
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
              <fieldset style={{ marginBottom: 8 }}>
                <legend>Secrets: Hidden information about the character</legend>
                {((form.traits?.secrets || []) as string[]).map((secret, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <input
                      type="text"
                      value={secret}
                      onChange={(e) => {
                        const currentTraits = form.traits || {};
                        const newSecrets = [...(currentTraits.secrets || [])];
                        newSecrets[index] = e.target.value;
                        setForm({ ...form, traits: { ...currentTraits, secrets: newSecrets } });
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => {
                      const currentTraits = form.traits || {};
                      const newSecrets = [...(currentTraits.secrets || [])];
                      newSecrets.splice(index, 1);
                      setForm({ ...form, traits: { ...currentTraits, secrets: newSecrets } });
                    }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    placeholder="Enter secret"
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <button type="button" onClick={() => {
                    if (newSecret.trim()) {
                      const currentTraits = form.traits || {};
                      const newSecrets = [...(currentTraits.secrets || []), newSecret.trim()];
                      setForm({ ...form, traits: { ...currentTraits, secrets: newSecrets } });
                      setNewSecret('');
                    }
                  }}>Add</button>
                  {editing !== 'new' && <button type="button" onClick={() => { setRegenField('secrets'); setShowFieldRegenDialog(true); }}>Generate</button>}
                </div>
              </fieldset>
              <fieldset style={{ marginBottom: 8 }}>
                <legend>Goals: Objectives and motivations</legend>
                {((form.traits?.goals || []) as string[]).map((goal, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <input
                      type="text"
                      value={goal}
                      onChange={(e) => {
                        const currentTraits = form.traits || {};
                        const newGoals = [...(currentTraits.goals || [])];
                        newGoals[index] = e.target.value;
                        setForm({ ...form, traits: { ...currentTraits, goals: newGoals } });
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => {
                      const currentTraits = form.traits || {};
                      const newGoals = [...(currentTraits.goals || [])];
                      newGoals.splice(index, 1);
                      setForm({ ...form, traits: { ...currentTraits, goals: newGoals } });
                    }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    value={newGoal}
                    onChange={(e) => setNewGoal(e.target.value)}
                    placeholder="Enter goal"
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <button type="button" onClick={() => {
                    if (newGoal.trim()) {
                      const currentTraits = form.traits || {};
                      const newGoals = [...(currentTraits.goals || []), newGoal.trim()];
                      setForm({ ...form, traits: { ...currentTraits, goals: newGoals } });
                      setNewGoal('');
                    }
                  }}>Add</button>
                  {editing !== 'new' && <button type="button" onClick={() => { setRegenField('goals'); setShowFieldRegenDialog(true); }}>Generate</button>}
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
            <input type="file" accept=".json" onChange={handleImport} />
            <button onClick={() => { setEditing('new'); setForm({}); setNewSecret(''); setNewGoal(''); }}>New Character</button>
            <button onClick={() => setShowGenerateDialog(true)}>Generate Character</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {characters.map((char) => (
              <div key={char.id} style={{ border: '1px solid #ccc', padding: 16, borderRadius: 8 }}>
                {(char.avatar || char.avatarUrl) ? (
                  <img src={char.avatar || char.avatarUrl} style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', marginBottom: 8 }} alt="avatar" />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: 6, background: '#333', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>
                    {char.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <h3>{char.name}</h3>
                <p>{char.description || 'No description'}</p>
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => handleEdit(char)}>Edit</button>
                  <button onClick={() => { setCopySource(char); setShowCopyDialog(true); }}>Copy</button>
                  <button onClick={() => handleDelete(char.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
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
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 500 }}>
            <h3>Import Character Card</h3>
            <p>Card: {importCard?.name || 'Unknown'}</p>
            <textarea
              placeholder="Enter any directions or overrides for the CreatorAgent..."
              value={importDirections}
              onChange={(e) => setImportDirections(e.target.value)}
              rows={4}
              style={{ width: '100%', marginTop: 10, background: 'rgba(255,255,255,0.05)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 8 }}
            />
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button onClick={handleCancelImport}>Cancel</button>
              <button onClick={() => setImportDirections('')}>Reset Fields</button>
              <button onClick={handleApplyImport}>Apply</button>
            </div>
          </div>
        </div>
      )}
      {showGenerateDialog && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 500 }}>
            <h3>Generate New Character</h3>
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
            <h3>Copy Character</h3>
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

export default CharacterManager;