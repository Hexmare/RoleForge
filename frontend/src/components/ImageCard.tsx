import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import Spinner from './Spinner';
import { useToast } from './Toast';

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  messageId?: number;
  selectedScene?: number | null;
  onUpdateMessage?: (id: number, content: string) => void;
}

const parseAlt = (alt: any, src: string) => {
  if (!alt) return { prompt: alt, urls: [src], current: 0 };
  try {
    const s = String(alt);
    try { return JSON.parse(s); } catch (e) { return { prompt: alt, urls: [src], current: 0 }; }
  } catch (e) { return { prompt: alt, urls: [src], current: 0 }; }
};

const ImageCard: React.FC<Props> = ({ src, alt, messageId, selectedScene, onUpdateMessage }) => {
  const [meta, setMeta] = useState<any>(() => parseAlt(alt, src as string));
  const [currentUrl, setCurrentUrl] = useState<string>(meta?.urls?.[meta.current] || (src as string));
  const [pending, setPending] = useState(false);
  const [hovered, setHovered] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [wrapperStyle, setWrapperStyle] = useState<React.CSSProperties | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const parsed = parseAlt(alt, src as string);
    setMeta(parsed);
    setCurrentUrl(parsed?.urls?.[parsed.current] || (src as string));
  }, [alt, src]);

  const updateSize = () => {
    const el = imgRef.current;
    if (el) {
      const w = el.clientWidth || el.naturalWidth || 0;
      const h = el.clientHeight || el.naturalHeight || 0;
      setWrapperStyle({ ['--img-w' as any]: `${w}px`, ['--img-h' as any]: `${h}px` });
    }
  };

  useEffect(() => {
    updateSize();
    const ro = (window as any).ResizeObserver ? new (window as any).ResizeObserver(() => updateSize()) : null;
    if (ro && imgRef.current) ro.observe(imgRef.current);
    window.addEventListener('resize', updateSize);
    return () => {
      if (ro && imgRef.current) try { ro.unobserve(imgRef.current); } catch (e) {}
      window.removeEventListener('resize', updateSize);
    };
  }, [currentUrl]);

  const toast = useToast();
  const callApi = async (action: 'next'|'prev'|'regen'|'deleteCurrent'|'deleteAll', extra: any = {}) => {
    if (!messageId) return null;
    setPending(true);
    try {
      const res = await fetch(`/api/messages/${messageId}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json && json.error ? json.error : 'API error');
      // server returns { success: true, metadata, newContent }
      if (json.metadata) {
        setMeta(json.metadata);
        setCurrentUrl(json.metadata.urls?.[json.metadata.current] || json.url || currentUrl);
      }
      if (json.newContent && onUpdateMessage) {
        onUpdateMessage(messageId, json.newContent);
      }
      if (action === 'deleteCurrent') toast.success('Image deleted');
      if (action === 'deleteAll') toast.success('All images deleted');
      if (action === 'regen') toast.success('Regeneration started');
      return json;
    } catch (e) {
      console.warn('ImageCard API error', e);
      const msg = (e && (e as any).message) ? (e as any).message : 'Image action failed';
      toast.error(msg);
      return null;
    } finally { if (mounted.current) setPending(false); }
  };

  const handleSaveImage = async () => {
    try {
      // Open image in a new tab for user to inspect/save
      window.open(currentUrl, '_blank', 'noopener,noreferrer');
      toast.success('Image opened in new tab');
    } catch (e) {
      console.warn('Open image failed', e);
      toast.error('Failed to open image');
    }
  };

  
  // If there are no images, don't render the ImageCard
  if (!meta || !meta.urls || meta.urls.length === 0) return null;

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const confirmDeleteCurrent = async () => {
    setShowDeleteModal(false);
    await callApi('deleteCurrent', { index: meta.current });
  };

  const confirmDeleteAll = async () => {
    setShowDeleteModal(false);
    await callApi('deleteAll');
  };

  return (
    <span className="image-card" style={{ display: 'inline-block', lineHeight: 0, position: 'relative', ...wrapperStyle } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <img ref={imgRef} className="image-card-img" src={currentUrl} alt={String(alt)} onLoad={updateSize} style={{ display: 'block', cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.6 : 1 }} />
      <span className="image-controls" aria-hidden>
        <span className="controls-left">
          <button className="icon small" onClick={() => callApi('prev')} title="Previous image" disabled={pending}>◀</button>
        </span>
        <span className="controls-center">
          <button className="icon regen" onClick={() => callApi('regen')} title="Regenerate image" disabled={pending}>🔁</button>
          {hovered && (
            <>
              <button className="icon" onClick={handleSaveImage} title="Open image in new tab" disabled={pending} style={{ marginLeft: 6 }}>🔍</button>
            </>
          )}
        </span>
        <span className="controls-right">
          <button className="icon small" onClick={() => callApi('next')} title="Next image" disabled={pending}>▶</button>
          <button className="icon trash" onClick={() => setShowDeleteModal(true)} title="Delete image" disabled={pending} style={{ marginLeft: 6 }}>🗑️</button>
        </span>
      </span>

      {pending && (
        <span role="status" aria-live="polite" className="regen-overlay" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)', zIndex: 25, borderRadius: 6 }}>
          <Spinner size={36} />
        </span>
      )}

      {showDeleteModal && typeof document !== 'undefined' && createPortal(
        <div className="modal-backdrop" style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div className="modal" role="dialog" aria-modal={true} style={{ background: '#fff', padding: 18, borderRadius: 8, minWidth: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Delete Image</strong>
              <button className="icon-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8 }}>Choose an option:</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={() => setShowDeleteModal(false)}>Cancel</button>
                <button className="btn danger" onClick={confirmDeleteCurrent} disabled={pending}>Delete current</button>
                <button className="btn danger" onClick={confirmDeleteAll} disabled={pending}>Delete all</button>
              </div>
            </div>
          </div>
        </div>, document.body)
      }
    </span>
  );
};

export default ImageCard;
